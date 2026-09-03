"""Idempotent Supabase persistence for characters and their content links."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

import httpx
from postgrest.exceptions import APIError
from supabase import Client
from tenacity import Retrying, retry_if_exception, stop_after_attempt, wait_exponential_jitter

from character_pipeline.character_normalizer import CharacterRecord
from config.settings import Settings, get_settings
from database.supabase_client import get_supabase_client


LOGGER = logging.getLogger(__name__)
MAX_BATCH_SIZE = 100


@dataclass(frozen=True)
class CharacterUploadResult:
    characters_created: int = 0
    relationships_created: int = 0
    duplicate_count: int = 0
    failed_records: int = 0


class CharacterUploader:
    def __init__(self, client: Client, *, retries: int = 4, batch_size: int = 100) -> None:
        self.client = client
        self.retries = max(1, retries)
        self.batch_size = max(1, min(batch_size, MAX_BATCH_SIZE))
        self.failed_records = 0

    def load_contents(self) -> list[dict[str, Any]]:
        fields = "id,source,external_id,content_type,series_type,title,release_year"
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            response = (
                self.client.table("contents")
                .select(fields)
                .order("id")
                .range(offset, offset + 999)
                .execute()
            )
            page = response.data or []
            rows.extend(item for item in page if isinstance(item, dict))
            if len(page) < 1000:
                break
            offset += 1000
        return rows

    def upload(self, records: Iterable[CharacterRecord]) -> CharacterUploadResult:
        self.failed_records = 0
        appearances = list(records)
        character_payloads = deduplicate_character_payloads(appearances)
        duplicate_count = max(0, len(appearances) - len(character_payloads))
        if not character_payloads:
            return CharacterUploadResult(duplicate_count=duplicate_count)

        names = [item["normalized_name"] for item in character_payloads]
        existing_before = self._fetch_character_ids(names)
        self._upload_rows("characters", character_payloads, "normalized_name")
        character_ids = self._fetch_character_ids(names)

        relationship_payloads = deduplicate_relationship_payloads(appearances, character_ids)
        existing_relationships = self._fetch_relationship_identities(
            {item["content_id"] for item in relationship_payloads}
        )
        self._upload_rows(
            "content_characters",
            relationship_payloads,
            "content_id,character_id,actor_name,voice_actor,source",
        )
        relationships_after = self._fetch_relationship_identities(
            {item["content_id"] for item in relationship_payloads}
        )
        created_relationships = sum(
            1
            for item in relationship_payloads
            if relationship_identity(item) not in existing_relationships
            and relationship_identity(item) in relationships_after
        )
        created_characters = sum(
            1 for name in names if name not in existing_before and name in character_ids
        )
        LOGGER.info(
            "Character upload selesai: characters_created=%s relationships_created=%s duplicates=%s failed=%s",
            created_characters,
            created_relationships,
            duplicate_count,
            self.failed_records,
        )
        return CharacterUploadResult(
            characters_created=created_characters,
            relationships_created=created_relationships,
            duplicate_count=duplicate_count,
            failed_records=self.failed_records,
        )

    def _fetch_character_ids(self, normalized_names: list[str]) -> dict[str, int]:
        result: dict[str, int] = {}
        for batch in _chunks(sorted(set(normalized_names)), self.batch_size):
            response = (
                self.client.table("characters")
                .select("id,normalized_name")
                .in_("normalized_name", batch)
                .execute()
            )
            for row in response.data or []:
                if isinstance(row, dict) and row.get("id") is not None:
                    result[str(row["normalized_name"])] = int(row["id"])
        return result

    def _fetch_relationship_identities(self, content_ids: set[int]) -> set[tuple[Any, ...]]:
        identities: set[tuple[Any, ...]] = set()
        fields = "content_id,character_id,actor_name,voice_actor,source"
        for content_batch in _chunks(sorted(content_ids), self.batch_size):
            offset = 0
            while True:
                response = (
                    self.client.table("content_characters")
                    .select(fields)
                    .in_("content_id", content_batch)
                    .range(offset, offset + 999)
                    .execute()
                )
                page = response.data or []
                identities.update(
                    relationship_identity(item) for item in page if isinstance(item, dict)
                )
                if len(page) < 1000:
                    break
                offset += 1000
        return identities

    def _upload_rows(self, table: str, rows: list[dict[str, Any]], conflict: str) -> None:
        by_shape: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for row in rows:
            by_shape.setdefault(tuple(sorted(row)), []).append(row)
        for same_shape_rows in by_shape.values():
            for batch in _chunks(same_shape_rows, self.batch_size):
                self._upload_resilient(table, batch, conflict)

    def _upload_resilient(self, table: str, rows: list[dict[str, Any]], conflict: str) -> None:
        if not rows:
            return
        try:
            self._execute_upsert(table, rows, conflict)
        except APIError as error:
            if not _is_record_data_error(error):
                raise
            if len(rows) > 1:
                midpoint = len(rows) // 2
                self._upload_resilient(table, rows[:midpoint], conflict)
                self._upload_resilient(table, rows[midpoint:], conflict)
                return
            self.failed_records += 1
            LOGGER.error("Record %s gagal dan dilewati: %s", table, error)

    def _execute_upsert(self, table: str, rows: list[dict[str, Any]], conflict: str) -> None:
        retrying = Retrying(
            stop=stop_after_attempt(self.retries),
            wait=wait_exponential_jitter(initial=0.5, max=15),
            retry=retry_if_exception(_is_transient_upload_error),
            reraise=True,
        )
        for attempt in retrying:
            with attempt:
                self.client.table(table).upsert(
                    rows,
                    on_conflict=conflict,
                    default_to_null=False,
                ).execute()
                return


def create_character_uploader(
    settings: Settings | None = None,
    *,
    client: Client | None = None,
) -> CharacterUploader:
    config = settings or get_settings()
    return CharacterUploader(
        client or get_supabase_client(config),
        retries=config.request_retries,
        batch_size=config.import_batch_size,
    )


def deduplicate_character_payloads(records: Iterable[CharacterRecord]) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for record in records:
        payload = record.character_payload()
        key = record.normalized_name
        current = unique.get(key)
        if current is None:
            unique[key] = payload
            continue
        aliases = list(current.get("alternative_names", []))
        seen = {str(item).casefold() for item in aliases}
        for alias in payload.get("alternative_names", []):
            if str(alias).casefold() not in seen:
                aliases.append(alias)
                seen.add(str(alias).casefold())
        current["alternative_names"] = aliases
        for field in ("description", "image_url"):
            if not current.get(field) and payload.get(field):
                current[field] = payload[field]
    return list(unique.values())


def deduplicate_relationship_payloads(
    records: Iterable[CharacterRecord],
    character_ids: dict[str, int],
) -> list[dict[str, Any]]:
    unique: dict[tuple[Any, ...], dict[str, Any]] = {}
    for record in records:
        character_id = character_ids.get(record.normalized_name)
        if character_id is None:
            continue
        payload = record.relationship_payload(character_id)
        key = relationship_identity(payload)
        current = unique.get(key)
        if current is None or payload["importance_score"] > current["importance_score"]:
            unique[key] = payload
    return list(unique.values())


def relationship_identity(payload: dict[str, Any]) -> tuple[Any, ...]:
    return (
        int(payload["content_id"]),
        int(payload["character_id"]),
        payload.get("actor_name"),
        payload.get("voice_actor"),
        str(payload.get("source") or "").upper(),
    )


def _chunks(items: list[Any], size: int) -> list[list[Any]]:
    return [items[offset : offset + size] for offset in range(0, len(items), size)]


def _is_transient_upload_error(error: BaseException) -> bool:
    return isinstance(error, (httpx.TransportError, ConnectionError, TimeoutError))


def _is_record_data_error(error: APIError) -> bool:
    code = str(getattr(error, "code", "") or "")
    if not code and error.args and isinstance(error.args[0], dict):
        code = str(error.args[0].get("code") or "")
    return code.startswith(("22", "23"))
