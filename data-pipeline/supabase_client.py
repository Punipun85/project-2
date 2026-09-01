"""Create the trusted Supabase client used by the ingestion pipeline."""

import os
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client


ENV_FILE = Path(__file__).with_name(".env")
load_dotenv(ENV_FILE)


def require_environment(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value or value.startswith("YOUR_") or "xxxx.supabase.co" in value:
        raise RuntimeError(f"{name} is not configured in {ENV_FILE}")
    return value


@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    """Return one service-role client for idempotent catalog upserts."""

    url = require_environment("SUPABASE_URL")
    key = require_environment("SUPABASE_KEY")
    return create_client(url, key)


def upsert_contents(records: list[dict[str, Any]], *, batch_size: int = 100) -> int:
    """Upsert normalized rows in bounded batches and return the row count."""

    if not records:
        return 0
    client = get_supabase_client()
    safe_batch_size = max(1, min(batch_size, 500))
    imported = 0
    groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        groups[tuple(sorted(record))].append(record)

    # Identical payload shapes prevent sparse provider rows from nulling richer
    # metadata during a PostgREST bulk upsert.
    for group in groups.values():
        for offset in range(0, len(group), safe_batch_size):
            batch = group[offset : offset + safe_batch_size]
            client.table("contents").upsert(
                batch,
                on_conflict="source,external_id",
                default_to_null=False,
            ).execute()
            imported += len(batch)
    return imported
