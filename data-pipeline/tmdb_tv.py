"""Fetch and normalize TV, streaming-series, and K-Drama metadata from TMDB."""

import os
from collections.abc import Iterator

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from models import NormalizedContent
from tmdb_movie import TMDB_BACKDROP_URL, TMDB_BASE_URL, TMDB_IMAGE_URL


TV_GENRES = {
    16: "Animation",
    18: "Drama",
    35: "Comedy",
    37: "Western",
    80: "Crime",
    99: "Documentary",
    9648: "Mystery",
    10751: "Family",
    10759: "Action & Adventure",
    10762: "Kids",
    10763: "News",
    10764: "Reality",
    10765: "Sci-Fi & Fantasy",
    10766: "Soap",
    10767: "Talk",
    10768: "War & Politics",
}


def _session() -> requests.Session:
    session = requests.Session()
    retries = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))
    session.headers.update({"accept": "application/json", "User-Agent": "EntertainmentAI-Pipeline/1.0"})
    return session


def get_tv(
    *,
    pages: int = 1,
    list_type: str = "popular",
    api_key: str | None = None,
    timeout: float | None = None,
) -> Iterator[dict]:
    """Yield raw TMDB TV rows from popular or top-rated lists."""

    key = (api_key or os.getenv("TMDB_API_KEY") or "").strip()
    if not key or key.startswith("YOUR_"):
        raise RuntimeError("TMDB_API_KEY is not configured in data-pipeline/.env")
    if list_type not in {"popular", "top_rated"}:
        raise ValueError("list_type must be 'popular' or 'top_rated'")

    request_timeout = timeout or float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))
    session = _session()
    for page in range(1, max(1, pages) + 1):
        response = session.get(
            f"{TMDB_BASE_URL}/tv/{list_type}",
            params={"api_key": key, "language": "en-US", "page": page},
            timeout=request_timeout,
        )
        response.raise_for_status()
        yield from response.json().get("results", [])


def normalize(tv: dict) -> NormalizedContent:
    """Map one TMDB TV list row to series + series_type taxonomy."""

    title = tv.get("name") or tv.get("original_name") or "Untitled"
    release_date = tv.get("first_air_date") or None
    rating = float(tv["vote_average"]) if tv.get("vote_average") is not None else None
    countries = [str(code) for code in tv.get("origin_country", []) if code]
    genre_ids = tv.get("genre_ids", [])
    genres = [TV_GENRES[genre_id] for genre_id in genre_ids if genre_id in TV_GENRES]
    original_language = tv.get("original_language") or None
    series_type = "kdrama" if original_language == "ko" or "KR" in countries else "tv_series"
    content_type = "documentary" if 99 in genre_ids else "series"
    if content_type == "documentary":
        series_type = None

    return NormalizedContent(
        external_id=str(tv["id"]),
        source="TMDB",
        content_type=content_type,
        series_type=series_type,
        title=title,
        original_title=tv.get("original_name"),
        alternative_titles=list(dict.fromkeys(value for value in (title, tv.get("original_name")) if value)),
        overview=tv.get("overview") or None,
        genres=genres,
        original_language=original_language,
        country=countries,
        poster_url=f"{TMDB_IMAGE_URL}{tv['poster_path']}" if tv.get("poster_path") else None,
        backdrop_url=f"{TMDB_BACKDROP_URL}{tv['backdrop_path']}" if tv.get("backdrop_path") else None,
        release_date=release_date,
        release_year=int(release_date[:4]) if release_date and release_date[:4].isdigit() else None,
        rating_average=rating,
        rating_count=int(tv.get("vote_count") or 0),
        tmdb_rating=rating,
        popularity_score=max(0.0, float(tv.get("popularity") or 0)),
        keywords=genres,
    )
