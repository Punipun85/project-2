"""TMDB movie importer for popular, top-rated, and detailed metadata."""

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


def get_popular_movies(
    page: int,
    *,
    settings: Settings | None = None,
    client: JsonApiClient | None = None,
) -> list[dict[str, Any]]:
    return _get_movie_list("popular", page, settings=settings, client=client)


def get_top_rated_movies(
    page: int,
    *,
    settings: Settings | None = None,
    client: JsonApiClient | None = None,
) -> list[dict[str, Any]]:
    return _get_movie_list("top_rated", page, settings=settings, client=client)


def get_movie_detail(
    movie_id: int | str,
    *,
    settings: Settings | None = None,
    client: JsonApiClient | None = None,
) -> dict[str, Any]:
    config = settings or get_settings()
    api = client or create_client(config)
    return api.get(
        f"movie/{movie_id}",
        params={
            "api_key": config.require_tmdb(),
            "language": "en-US",
            "append_to_response": "credits",
        },
    )


def _get_movie_list(
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
        f"movie/{list_name}",
        params={"api_key": config.require_tmdb(), "language": "en-US", "page": page},
    )
    results = payload.get("results", [])
    return [item for item in results if isinstance(item, dict)]
