"""Run NexaPlay AI Batch 2A as an isolated character enrichment pipeline."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from character_pipeline.anilist_character_importer import AniListCharacterImporter
from character_pipeline.character_normalizer import CharacterRecord
from character_pipeline.character_uploader import (
    CharacterUploadResult,
    CharacterUploader,
    create_character_uploader,
    deduplicate_character_payloads,
    deduplicate_relationship_payloads,
)
from character_pipeline.imdb_character_importer import ImdbCharacterImporter
from character_pipeline.tmdb_character_importer import TmdbCharacterImporter
from character_pipeline.tvmaze_character_importer import TvmazeCharacterImporter
from config.settings import PIPELINE_ROOT, Settings, get_settings


LOGGER = logging.getLogger("nexaplay.character_pipeline")
REPORT_FILE = PIPELINE_ROOT / "logs" / "character_report.json"


@dataclass
class CharacterReport:
    movies_processed: int = 0
    series_processed: int = 0
    anime_processed: int = 0
    characters_created: int = 0
    relationships_created: int = 0
    duplicate_count: int = 0
    skipped_records: int = 0
    errors: int = 0


def configure_logging(settings: Settings) -> Path:
    log_dir = PIPELINE_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "character_pipeline.log"
    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[logging.FileHandler(log_file, encoding="utf-8"), logging.StreamHandler(sys.stdout)],
        force=True,
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    return log_file


def partition_contents(contents: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    return {
        "movies": [
            item
            for item in contents
            if item.get("source") == "TMDB" and item.get("content_type") in {"movie", "documentary"}
        ],
        "series": [
            item
            for item in contents
            if item.get("source") == "TMDB" and item.get("content_type") == "series"
        ],
        "anime": [
            item
            for item in contents
            if item.get("source") in {"MAL", "JIKAN"} and item.get("content_type") == "anime"
        ],
    }


def process_series(
    contents: list[dict[str, Any]],
    settings: Settings,
    report: CharacterReport,
) -> list[CharacterRecord]:
    tmdb = TmdbCharacterImporter(settings)
    tvmaze = TvmazeCharacterImporter(settings)
    records: list[CharacterRecord] = []
    for content in contents:
        report.series_processed += 1
        try:
            content_records = tmdb.import_content(content)
        except Exception as error:
            LOGGER.error("TMDB series content=%s gagal: %s", content.get("id"), error)
            content_records = []
        if not content_records:
            try:
                content_records = tvmaze.import_content(content)
            except Exception as error:
                report.errors += 1
                LOGGER.error("TVMaze fallback content=%s gagal: %s", content.get("id"), error)
        if not content_records:
            report.skipped_records += 1
        records.extend(content_records)
    return records


def process_anime(
    contents: list[dict[str, Any]],
    settings: Settings,
    report: CharacterReport,
) -> list[CharacterRecord]:
    importer = AniListCharacterImporter(settings)
    records: list[CharacterRecord] = []
    for content in contents:
        report.anime_processed += 1
        try:
            content_records = importer.import_content(content)
            if not content_records:
                report.skipped_records += 1
            records.extend(content_records)
        except Exception as error:
            report.errors += 1
            LOGGER.error("AniList content=%s gagal; provider lain tetap lanjut: %s", content.get("id"), error)
    return records


def process_movies(
    contents: list[dict[str, Any]],
    settings: Settings,
    report: CharacterReport,
    *,
    principals_path: Path | None,
    names_path: Path | None,
) -> list[CharacterRecord]:
    report.movies_processed += len(contents)
    importer = ImdbCharacterImporter(settings)
    try:
        records = importer.import_contents(
            contents,
            principals_path=principals_path,
            names_path=names_path,
        )
        report.skipped_records += importer.skipped_count
        report.errors += importer.error_count
        return records
    except Exception as error:
        report.errors += 1
        LOGGER.error("IMDb movie enrichment gagal; provider lain tetap lanjut: %s", error)
        return []


def preview_upload(records: list[CharacterRecord]) -> CharacterUploadResult:
    characters = deduplicate_character_payloads(records)
    ids = {payload["normalized_name"]: index + 1 for index, payload in enumerate(characters)}
    relationships = deduplicate_relationship_payloads(records, ids)
    return CharacterUploadResult(
        characters_created=len(characters),
        relationships_created=len(relationships),
        duplicate_count=max(0, len(records) - len(characters)),
    )


def save_report(report: CharacterReport, path: Path = REPORT_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(report), indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Character report disimpan ke %s", path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        action="append",
        choices=("imdb-movies", "tmdb-series", "anilist-anime"),
        help="Batasi provider; opsi boleh diulang",
    )
    parser.add_argument("--limit", type=int, help="Batasi jumlah content per kategori")
    parser.add_argument("--dry-run", action="store_true", help="Proses tanpa menulis character data")
    parser.add_argument("--imdb-principals-path", type=Path)
    parser.add_argument("--imdb-names-path", type=Path)
    return parser.parse_args()


def _limit(items: list[dict[str, Any]], limit: int | None) -> list[dict[str, Any]]:
    return items[: max(0, limit)] if limit is not None else items


def print_report(report: CharacterReport) -> None:
    print("\n=================================")
    print("NEXAPLAY AI BATCH 2A REPORT")
    for key, value in asdict(report).items():
        print(f"{key}: {value}")
    print("=================================")


def main() -> int:
    started_at = time.monotonic()
    args = parse_args()
    if bool(args.imdb_principals_path) != bool(args.imdb_names_path):
        print("Kedua path IMDb harus diberikan bersama", file=sys.stderr)
        return 2

    settings = get_settings()
    configure_logging(settings)
    report = CharacterReport()
    selected = set(args.source or ("imdb-movies", "tmdb-series", "anilist-anime"))
    try:
        uploader: CharacterUploader = create_character_uploader(settings)
        groups = partition_contents(uploader.load_contents())
    except Exception as error:
        LOGGER.exception("Gagal memuat contents dari Supabase")
        report.errors += 1
        save_report(report)
        print_report(report)
        print(f"Pipeline dihentikan: {error}", file=sys.stderr)
        return 1

    records: list[CharacterRecord] = []
    if "imdb-movies" in selected:
        records.extend(
            process_movies(
                _limit(groups["movies"], args.limit),
                settings,
                report,
                principals_path=args.imdb_principals_path,
                names_path=args.imdb_names_path,
            )
        )
    if "tmdb-series" in selected:
        records.extend(process_series(_limit(groups["series"], args.limit), settings, report))
    if "anilist-anime" in selected:
        records.extend(process_anime(_limit(groups["anime"], args.limit), settings, report))

    try:
        upload_result = preview_upload(records) if args.dry_run else uploader.upload(records)
        report.characters_created = upload_result.characters_created
        report.relationships_created = upload_result.relationships_created
        report.duplicate_count = upload_result.duplicate_count
        report.errors += upload_result.failed_records
    except Exception as error:
        report.errors += 1
        LOGGER.exception("Upload character knowledge gagal: %s", error)

    save_report(report)
    LOGGER.info("Character pipeline selesai dalam %.2fs", time.monotonic() - started_at)
    print_report(report)
    if args.dry_run:
        print("Mode: dry run (tidak ada character data yang ditulis)")
    return 0 if report.errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
