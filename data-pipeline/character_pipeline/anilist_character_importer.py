"""AniList GraphQL importer for anime characters and Japanese voice actors."""

from __future__ import annotations

import logging
import time
from typing import Any

import requests
from tenacity import Retrying, retry_if_exception, stop_after_attempt, wait_exponential_jitter

from character_pipeline.character_normalizer import CharacterRecord, normalize_character_record
from config.settings import Settings, get_settings


LOGGER = logging.getLogger(__name__)
ANILIST_URL = "https://graphql.anilist.co"
ANILIST_QUERY = """
query CharacterKnowledge($malId: Int!, $page: Int!) {
  Media(idMal: $malId, type: ANIME) {
    id
    characters(page: $page, perPage: 50, sort: [ROLE, RELEVANCE, ID]) {
      pageInfo { hasNextPage }
      edges {
        role
        node {
          id
          name { full alternative }
          image { large }
          description
        }
        voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) {
          name { full }
        }
      }
    }
  }
}
""".strip()


class AniListCharacterImporter:
    def __init__(self, settings: Settings | None = None, session: requests.Session | None = None) -> None:
        self.settings = settings or get_settings()
        self.session = session or requests.Session()
        self.session.headers.update(
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "NexaPlayAI-CharacterPipeline/1.0",
            }
        )
        self._last_request = 0.0

    def import_content(self, content: dict[str, Any]) -> list[CharacterRecord]:
        page = 1
        records: list[CharacterRecord] = []
        while True:
            payload = self._post(int(content["external_id"]), page)
            page_records, has_next_page = parse_anilist_response(payload, int(content["id"]))
            records.extend(page_records)
            if not has_next_page:
                break
            page += 1
        LOGGER.info("AniList content=%s records=%s", content.get("id"), len(records))
        return records

    def _post(self, mal_id: int, page: int) -> dict[str, Any]:
        retrying = Retrying(
            stop=stop_after_attempt(self.settings.request_retries),
            wait=wait_exponential_jitter(initial=0.5, max=30),
            retry=retry_if_exception(_retryable_error),
            reraise=True,
        )
        for attempt in retrying:
            with attempt:
                remaining = 2.1 - (time.monotonic() - self._last_request)
                if remaining > 0:
                    time.sleep(remaining)
                response = self.session.post(
                    ANILIST_URL,
                    json={"query": ANILIST_QUERY, "variables": {"malId": mal_id, "page": page}},
                    timeout=self.settings.http_timeout_seconds,
                )
                self._last_request = time.monotonic()
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise RuntimeError("Respons AniList bukan object JSON")
                errors = payload.get("errors")
                if errors:
                    raise RuntimeError(f"AniList GraphQL error: {errors}")
                return payload
        raise RuntimeError("AniList gagal tanpa respons")


def parse_anilist_response(
    payload: dict[str, Any],
    content_id: int,
) -> tuple[list[CharacterRecord], bool]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    media = data.get("Media") if isinstance(data.get("Media"), dict) else {}
    characters = media.get("characters") if isinstance(media.get("characters"), dict) else {}
    edges = characters.get("edges") if isinstance(characters.get("edges"), list) else []
    page_info = characters.get("pageInfo") if isinstance(characters.get("pageInfo"), dict) else {}

    records: list[CharacterRecord] = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        node = edge.get("node") if isinstance(edge.get("node"), dict) else {}
        names = node.get("name") if isinstance(node.get("name"), dict) else {}
        image = node.get("image") if isinstance(node.get("image"), dict) else {}
        voice_actors = edge.get("voiceActors") if isinstance(edge.get("voiceActors"), list) else []
        voice_names = [
            actor.get("name", {}).get("full")
            for actor in voice_actors
            if isinstance(actor, dict) and isinstance(actor.get("name"), dict)
        ]
        voice_names = [name for name in voice_names if isinstance(name, str) and name.strip()]
        if not voice_names:
            voice_names = [None]

        for voice_actor in voice_names:
            record = normalize_character_record(
                content_id=content_id,
                name=names.get("full"),
                alternative_names=names.get("alternative") if isinstance(names.get("alternative"), list) else [],
                description=node.get("description"),
                image_url=image.get("large"),
                role=edge.get("role"),
                voice_actor=voice_actor,
                importance_score=_role_score(edge.get("role")),
                source="ANILIST",
            )
            if record:
                records.append(record)
    return records, bool(page_info.get("hasNextPage"))


def _role_score(role: Any) -> int:
    return {"MAIN": 100, "SUPPORTING": 60, "BACKGROUND": 20}.get(str(role or "").upper(), 10)


def _retryable_error(error: BaseException) -> bool:
    if isinstance(error, (requests.Timeout, requests.ConnectionError)):
        return True
    return (
        isinstance(error, requests.HTTPError)
        and error.response is not None
        and (error.response.status_code == 429 or error.response.status_code >= 500)
    )
