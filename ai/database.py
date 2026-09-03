"""Supabase client factory for server-side Batch 3 operations."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from .config import require_supabase


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    url, key = require_supabase()
    return create_client(url, key)


def response_data(response: Any) -> list[dict[str, Any]]:
    """Normalize Supabase API responses for production and test doubles."""
    data = getattr(response, "data", response)
    return list(data or [])
