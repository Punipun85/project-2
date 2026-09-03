"""Stream IMDb non-commercial TSV datasets for movie character credits."""

from __future__ import annotations

import csv
import gzip
import json
import logging
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any, TextIO

import requests
from tenacity import Retrying, retry_if_exception, stop_after_attempt, wait_exponential_jitter

from character_pipeline.character_normalizer import CharacterRecord, normalize_character_record
from config.settings import PIPELINE_ROOT, Settings, get_settings
from sources.tmdb_movie import create_client


LOGGER = logging.getLogger(__name__)
IMDB_PRINCIPALS_URL = "https://datasets.imdbws.com/title.principals.tsv.gz"
IMDB_NAMES_URL = "https://datasets.imdbws.com/name.basics.tsv.gz"
DEFAULT_IMDB_DATA_DIR = PIPELINE_ROOT / "data" / "imdb"
ALLOWED_CATEGORIES = {"actor", "actress"}


class ImdbCharacterImporter:
    """Match TMDB movie records to IMDb principals without loading full TSVs."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.tmdb = create_client(self.settings)
        self.skipped_count = 0
        self.error_count = 0

    def import_contents(
        self,
        contents: list[dict[str, Any]],
        *,
        principals_path: Path | None = None,
        names_path: Path | None = None,
    ) -> list[CharacterRecord]:
        if principals_path is None or names_path is None:
            downloaded_principals, downloaded_names = ensure_imdb_datasets(self.settings)
            principals_path = principals_path or downloaded_principals
            names_path = names_path or downloaded_names

        imdb_to_content = self._resolve_imdb_ids(contents)
        if not imdb_to_content:
            return []

        with open_tsv(principals_path) as handle:
            credits = parse_principals_tsv(handle, set(imdb_to_content))
        nconsts = {credit["nconst"] for credit in credits}
        with open_tsv(names_path) as handle:
            actors = parse_name_basics_tsv(handle, nconsts)

        records: list[CharacterRecord] = []
        for credit in credits:
            content = imdb_to_content[credit["tconst"]]
            actor_name = actors.get(credit["nconst"])
            if not actor_name:
                self.skipped_count += 1
                continue
            importance = max(10, 100 - (int(credit["ordering"]) - 1) * 8)
            role = "main" if int(credit["ordering"]) <= 3 else "supporting"
            for character_name in credit["characters"]:
                record = normalize_character_record(
                    content_id=int(content["id"]),
                    name=character_name,
                    source="IMDB",
                    role=role,
                    actor_name=actor_name,
                    importance_score=importance,
                )
                if record:
                    records.append(record)
                else:
                    self.skipped_count += 1
        return records

    def _resolve_imdb_ids(self, contents: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        resolved: dict[str, dict[str, Any]] = {}
        api_key = self.settings.require_tmdb()
        for content in contents:
            try:
                payload = self.tmdb.get(
                    f"movie/{content['external_id']}/external_ids",
                    params={"api_key": api_key},
                )
                imdb_id = payload.get("imdb_id")
                if isinstance(imdb_id, str) and imdb_id.startswith("tt"):
                    resolved[imdb_id] = content
                else:
                    self.skipped_count += 1
            except Exception as error:
                self.error_count += 1
                LOGGER.error("IMDb mapping gagal untuk content %s: %s", content.get("id"), error)
        return resolved


def parse_imdb_characters(value: Any) -> list[str]:
    if not isinstance(value, str) or value in {"", "\\N"}:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, str) and item.strip()]


def parse_principals_tsv(
    lines: Iterable[str],
    target_tconsts: set[str],
) -> list[dict[str, Any]]:
    credits: list[dict[str, Any]] = []
    for row in csv.DictReader(lines, delimiter="\t"):
        if row.get("tconst") not in target_tconsts or row.get("category") not in ALLOWED_CATEGORIES:
            continue
        characters = parse_imdb_characters(row.get("characters"))
        if not characters:
            continue
        try:
            ordering = int(row.get("ordering") or 999)
        except ValueError:
            ordering = 999
        credits.append(
            {
                "tconst": row["tconst"],
                "nconst": row.get("nconst", ""),
                "category": row["category"],
                "ordering": ordering,
                "characters": characters,
            }
        )
    return credits


def parse_name_basics_tsv(lines: Iterable[str], target_nconsts: set[str]) -> dict[str, str]:
    actors: dict[str, str] = {}
    for row in csv.DictReader(lines, delimiter="\t"):
        nconst = row.get("nconst")
        name = row.get("primaryName")
        if nconst in target_nconsts and name and name != "\\N":
            actors[nconst] = name
            if len(actors) == len(target_nconsts):
                break
    return actors


def ensure_imdb_datasets(
    settings: Settings | None = None,
    *,
    data_dir: Path = DEFAULT_IMDB_DATA_DIR,
) -> tuple[Path, Path]:
    config = settings or get_settings()
    data_dir.mkdir(parents=True, exist_ok=True)
    principals = data_dir / "title.principals.tsv.gz"
    names = data_dir / "name.basics.tsv.gz"
    _download_if_missing(IMDB_PRINCIPALS_URL, principals, config)
    _download_if_missing(IMDB_NAMES_URL, names, config)
    return principals, names


def open_tsv(path: Path) -> Iterator[TextIO]:
    if path.suffix == ".gz":
        return gzip.open(path, mode="rt", encoding="utf-8", newline="")
    return path.open(mode="r", encoding="utf-8", newline="")


def _download_if_missing(url: str, destination: Path, settings: Settings) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        LOGGER.info("Menggunakan cache IMDb: %s", destination)
        return
    temporary = destination.with_suffix(destination.suffix + ".part")
    retrying = Retrying(
        stop=stop_after_attempt(settings.request_retries),
        wait=wait_exponential_jitter(initial=1, max=30),
        retry=retry_if_exception(_retryable_download_error),
        reraise=True,
    )
    for attempt in retrying:
        with attempt:
            LOGGER.info("Mengunduh dataset IMDb ke %s", destination)
            with requests.get(
                url,
                stream=True,
                timeout=settings.http_timeout_seconds,
                headers={"User-Agent": "NexaPlayAI-CharacterPipeline/1.0"},
            ) as response:
                response.raise_for_status()
                with temporary.open("wb") as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            output.write(chunk)
            temporary.replace(destination)
            return


def _retryable_download_error(error: BaseException) -> bool:
    if isinstance(error, (requests.Timeout, requests.ConnectionError)):
        return True
    return (
        isinstance(error, requests.HTTPError)
        and error.response is not None
        and (error.response.status_code == 429 or error.response.status_code >= 500)
    )
