"""TMDB series importer for TV, Asian dramas, and streaming series."""

from __future__ import annotations

from typing import Any

from config.settings import Settings, get_settings
from sources.http_client import JsonApiClient


TMDB_BASE_URL = "https://api.themoviedb.org/3"


def create_client(settings: Settings | None = None) -> JsonApiClient:
    config = settings or get_settings()
    return JsonApiClient(
        base_url=TMDB_BASE_URL,
        timeout=config.http_timeout_seconds,
        retries=config.request_retries,
        request_delay=config.tmdb_request_delay,
    )


def get_popular_series(
    page: int,
    *,
    settings: Settings | None = None,
    client: JsonApiClient | None = None,
) -> list[dict[str, Any]]:
    return _get_series_list("popular", page, settings=settings, client=client)


def get_top_rated_series(
    page: int,
    *,
    settings: Settings | None = None,
    client: JsonApiClient | None = None,
) -> list[dict[str, Any]]:
    return _get_series_list("top_rated", page, settings=settings, client=client)


def get_series_detail(
    series_id: int | str,
    *,
    settings: Settings | None = None,
    client: JsonApiClient | None = None,
) -> dict[str, Any]:
    config = settings or get_settings()
    api = client or create_client(config)
    return api.get(
        f"tv/{series_id}",
        params={
            "api_key": config.require_tmdb(),
            "language": "en-US",
            "append_to_response": "aggregate_credits,videos",
        },
    )


def _get_series_list(
    list_name: str,
    page: int,
    *,
    settings: Settings | None,
    client: JsonApiClient | None,
) -> list[dict[str, Any]]:
    if page < 1:
        raise ValueError("page harus bernilai minimal 1")
    config = settings or get_settings()
    api = client or create_client(config)
    payload = api.get(
        f"tv/{list_name}",
        params={"api_key": config.require_tmdb(), "language": "en-US", "page": page},
    )
    results = payload.get("results", [])
    return [item for item in results if isinstance(item, dict)]
