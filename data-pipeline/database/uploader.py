"""Idempotent Supabase batch uploads for normalized content records."""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from supabase import Client
from tenacity import Retrying, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from config.settings import Settings, get_settings
from database.supabase_client import get_supabase_client
from processors.normalizer import ContentRecord


LOGGER = logging.getLogger(__name__)
CONFLICT_COLUMNS = "source,external_id"
MAX_BATCH_SIZE = 100


class SupabaseUploader:
    """Upload records in bounded batches using the source/external ID natural key."""

    def __init__(self, client: Client, *, retries: int = 4, batch_size: int = 100) -> None:
        self.client = client
        self.retries = max(1, retries)
        self.batch_size = max(1, min(batch_size, MAX_BATCH_SIZE))

    def upload_content(self, record: ContentRecord | dict[str, Any]) -> int:
        return self.upload_batch([record])

    def upload_batch(self, records: Iterable[ContentRecord | dict[str, Any]]) -> int:
        payloads = _deduplicate(records)
        if not payloads:
            return 0

        uploaded = 0
        by_shape: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
        for payload in payloads:
            by_shape[tuple(sorted(payload))].append(payload)

        # Grouping sparse rows by shape keeps omitted fields from becoming null
        # when PostgREST performs a bulk upsert.
        for group in by_shape.values():
            for offset in range(0, len(group), self.batch_size):
                batch = group[offset : offset + self.batch_size]
                self._execute_upsert(batch)
                uploaded += len(batch)
        return uploaded

    def _execute_upsert(self, batch: list[dict[str, Any]]) -> None:
        retrying = Retrying(
            stop=stop_after_attempt(self.retries),
            wait=wait_exponential_jitter(initial=0.5, max=15),
            retry=retry_if_exception_type(Exception),
            reraise=True,
            before_sleep=lambda state: LOGGER.warning(
                "Retry upload Supabase setelah error: %s",
                state.outcome.exception() if state.outcome else "unknown",
            ),
        )
        for attempt in retrying:
            with attempt:
                self.client.table("contents").upsert(
                    batch,
                    on_conflict=CONFLICT_COLUMNS,
                    default_to_null=False,
                ).execute()
                return


def upload_content(
    record: ContentRecord | dict[str, Any],
    *,
    client: Client | None = None,
    settings: Settings | None = None,
) -> int:
    config = settings or get_settings()
    uploader = SupabaseUploader(
        client or get_supabase_client(config),
        retries=config.request_retries,
        batch_size=config.import_batch_size,
    )
    return uploader.upload_content(record)


def upload_batch(
    records: Iterable[ContentRecord | dict[str, Any]],
    *,
    client: Client | None = None,
    settings: Settings | None = None,
) -> int:
    config = settings or get_settings()
    uploader = SupabaseUploader(
        client or get_supabase_client(config),
        retries=config.request_retries,
        batch_size=config.import_batch_size,
    )
    return uploader.upload_batch(records)


def _deduplicate(records: Iterable[ContentRecord | dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        payload = record.to_supabase() if isinstance(record, ContentRecord) else dict(record)
        source = str(payload.get("source") or "").strip().upper()
        external_id = str(payload.get("external_id") or "").strip()
        title = str(payload.get("title") or "").strip()
        if not source or not external_id or not title:
            raise ValueError("Record upload wajib memiliki source, external_id, dan title")
        payload["source"] = source
        payload["external_id"] = external_id
        payload["title"] = title
        unique[(source, external_id)] = payload
    return list(unique.values())
