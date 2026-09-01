"""Fetch and normalize anime metadata from the public Jikan API."""

import os
import re
import time
from collections.abc import Iterator

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from models import NormalizedContent


JIKAN_BASE_URL = "https://api.jikan.moe/v4"


def _session() -> requests.Session:
    session = requests.Session()
    retries = Retry(
        total=4,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))
    session.headers.update({"accept": "application/json", "User-Agent": "EntertainmentAI-Pipeline/1.0"})
    return session


def get_anime(
    *,
    pages: int = 1,
    request_delay: float | None = None,
    timeout: float | None = None,
) -> Iterator[dict]:
    """Yield top anime while respecting Jikan's public rate limits."""

    delay = request_delay if request_delay is not None else float(os.getenv("JIKAN_REQUEST_DELAY", "0.45"))
    request_timeout = timeout or float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))
    session = _session()
    for page in range(1, max(1, pages) + 1):
        response = session.get(
            f"{JIKAN_BASE_URL}/top/anime",
            params={"page": page},
            timeout=request_timeout,
        )
        response.raise_for_status()
        yield from response.json().get("data", [])
        if page < max(1, pages):
            time.sleep(max(0, delay))


def normalize(anime: dict) -> NormalizedContent:
    """Map one Jikan anime row to the Supabase contents schema."""

    title = anime.get("title_english") or anime.get("title") or "Untitled"
    anime_type = (anime.get("type") or "").lower()
    series_type = {
        "movie": "anime_movie",
        "ova": "ova",
    }.get(anime_type, "anime_series")
    genres = _names(anime.get("genres")) + _names(anime.get("explicit_genres"))
    themes = _names(anime.get("themes"))
    demographics = _names(anime.get("demographics"))
    studios = [{"name": name} for name in _names(anime.get("studios"))]
    aired = anime.get("aired") or {}
    release_date = _date_only(aired.get("from"))
    release_year = (
        ((aired.get("prop") or {}).get("from") or {}).get("year")
        or anime.get("year")
        or (int(release_date[:4]) if release_date else None)
    )
    images = (anime.get("images") or {}).get("jpg") or {}
    trailer = anime.get("trailer") or {}
    rating = float(anime["score"]) if anime.get("score") is not None else None

    return NormalizedContent(
        external_id=str(anime["mal_id"]),
        source="JIKAN",
        content_type="anime",
        series_type=series_type,
        title=title,
        original_title=anime.get("title_japanese") or anime.get("title"),
        alternative_titles=_alternative_titles(anime),
        overview=anime.get("synopsis") or None,
        genres=list(dict.fromkeys(genres)),
        themes=list(dict.fromkeys(themes)),
        keywords=list(dict.fromkeys(themes + demographics + [anime.get("source") or ""])),
        original_language="ja",
        country=["Japan"],
        poster_url=images.get("large_image_url") or images.get("image_url"),
        backdrop_url=(trailer.get("images") or {}).get("maximum_image_url"),
        trailer_url=trailer.get("url") or trailer.get("embed_url"),
        release_date=release_date,
        release_year=int(release_year) if release_year else None,
        status=_status(anime.get("status")),
        number_of_episodes=_optional_int(anime.get("episodes")),
        episode_duration_minutes=_duration_minutes(anime.get("duration")),
        studio=studios,
        rating_average=rating,
        rating_count=int(anime.get("scored_by") or 0),
        mal_rating=rating,
        popularity_score=max(0.0, float(anime.get("members") or 0)),
        ai_tags=list(dict.fromkeys(themes + demographics)),
    )


def _names(items: list[dict] | None) -> list[str]:
    return [str(item["name"]) for item in (items or []) if item.get("name")]


def _alternative_titles(anime: dict) -> list[str]:
    values = [
        anime.get("title"),
        anime.get("title_english"),
        anime.get("title_japanese"),
        *(anime.get("title_synonyms") or []),
    ]
    return list(dict.fromkeys(str(value) for value in values if value))


def _date_only(value: str | None) -> str | None:
    return value[:10] if value and len(value) >= 10 else None


def _duration_minutes(value: str | None) -> int | None:
    if not value:
        return None
    hours = re.search(r"(\d+)\s*hr", value, re.IGNORECASE)
    minutes = re.search(r"(\d+)\s*min", value, re.IGNORECASE)
    total = (int(hours.group(1)) * 60 if hours else 0) + (int(minutes.group(1)) if minutes else 0)
    return total or None


def _status(value: str | None) -> str | None:
    normalized = (value or "").lower()
    if "currently airing" in normalized:
        return "ongoing"
    if "finished" in normalized:
        return "completed"
    if "not yet aired" in normalized:
        return "upcoming"
    return None


def _optional_int(value: object) -> int | None:
    return int(value) if value is not None else None
