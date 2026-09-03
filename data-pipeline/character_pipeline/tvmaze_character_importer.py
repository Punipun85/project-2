"""TVMaze fallback when TMDB series credits contain no usable characters."""

from __future__ import annotations

import logging
import time
from typing import Any

import requests
from tenacity import Retrying, retry_if_exception, stop_after_attempt, wait_exponential_jitter

from character_pipeline.character_normalizer import CharacterRecord, normalize_character_record
from config.settings import Settings, get_settings


LOGGER = logging.getLogger(__name__)
TVMAZE_BASE_URL = "https://api.tvmaze.com"


class TvmazeCharacterImporter:
    def __init__(self, settings: Settings | None = None, session: requests.Session | None = None) -> None:
        self.settings = settings or get_settings()
        self.session = session or requests.Session()
        self.session.headers.update({"Accept": "application/json", "User-Agent": "NexaPlayAI/1.0"})
        self._last_request = 0.0

    def import_content(self, content: dict[str, Any]) -> list[CharacterRecord]:
        results = self._get("search/shows", params={"q": content.get("title", "")})
        if not isinstance(results, list):
            return []
        show = select_tvmaze_show(results, content)
        if show is None:
            return []
        cast = self._get(f"shows/{show['id']}/cast")
        if not isinstance(cast, list):
            return []

        records: list[CharacterRecord] = []
        for index, item in enumerate(cast):
            if not isinstance(item, dict):
                continue
            person = item.get("person") if isinstance(item.get("person"), dict) else {}
            character = item.get("character") if isinstance(item.get("character"), dict) else {}
            image = character.get("image") if isinstance(character.get("image"), dict) else {}
            record = normalize_character_record(
                content_id=int(content["id"]),
                name=character.get("name"),
                source="TVMAZE",
                role="main" if index < 3 else "supporting",
                actor_name=person.get("name"),
                image_url=image.get("original") or image.get("medium"),
                importance_score=max(10, 100 - index * 5),
            )
            if record:
                records.append(record)
        LOGGER.info("TVMaze fallback content=%s records=%s", content.get("id"), len(records))
        return records

    def _get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        url = f"{TVMAZE_BASE_URL}/{path.lstrip('/')}"
        retrying = Retrying(
            stop=stop_after_attempt(self.settings.request_retries),
            wait=wait_exponential_jitter(initial=0.5, max=15),
            retry=retry_if_exception(_retryable_error),
            reraise=True,
        )
        for attempt in retrying:
            with attempt:
                remaining = 0.10 - (time.monotonic() - self._last_request)
                if remaining > 0:
                    time.sleep(remaining)
                response = self.session.get(url, params=params, timeout=self.settings.http_timeout_seconds)
                self._last_request = time.monotonic()
                response.raise_for_status()
                return response.json()
        raise RuntimeError(f"TVMaze gagal tanpa respons: {url}")


def select_tvmaze_show(results: list[Any], content: dict[str, Any]) -> dict[str, Any] | None:
    candidates = [item.get("show") for item in results if isinstance(item, dict)]
    candidates = [item for item in candidates if isinstance(item, dict)]
    title = str(content.get("title") or "").casefold()
    release_year = content.get("release_year")
    for show in candidates:
        premiered = str(show.get("premiered") or "")
        if str(show.get("name") or "").casefold() == title and (
            not release_year or premiered.startswith(str(release_year))
        ):
            return show
    for show in candidates:
        if str(show.get("name") or "").casefold() == title:
            return show
    return candidates[0] if candidates else None


def _retryable_error(error: BaseException) -> bool:
    if isinstance(error, (requests.Timeout, requests.ConnectionError)):
        return True
    return (
        isinstance(error, requests.HTTPError)
        and error.response is not None
        and (error.response.status_code == 429 or error.response.status_code >= 500)
    )
