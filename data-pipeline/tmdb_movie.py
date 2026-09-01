"""Fetch and normalize movie metadata from TMDB."""

import os
from collections.abc import Iterator

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from models import NormalizedContent


TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_URL = "https://image.tmdb.org/t/p/w500"
TMDB_BACKDROP_URL = "https://image.tmdb.org/t/p/original"

MOVIE_GENRES = {
    12: "Adventure",
    14: "Fantasy",
    16: "Animation",
    18: "Drama",
    27: "Horror",
    28: "Action",
    35: "Comedy",
    36: "History",
    37: "Western",
    53: "Thriller",
    80: "Crime",
    99: "Documentary",
    878: "Sci-Fi",
    9648: "Mystery",
    10402: "Music",
    10749: "Romance",
    10751: "Family",
    10752: "War",
    10770: "TV Movie",
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


def get_movies(
    *,
    pages: int = 1,
    list_type: str = "popular",
    api_key: str | None = None,
    timeout: float | None = None,
) -> Iterator[dict]:
    """Yield raw TMDB movie rows from popular or top-rated lists."""

    key = (api_key or os.getenv("TMDB_API_KEY") or "").strip()
    if not key or key.startswith("YOUR_"):
        raise RuntimeError("TMDB_API_KEY is not configured in data-pipeline/.env")
    if list_type not in {"popular", "top_rated"}:
        raise ValueError("list_type must be 'popular' or 'top_rated'")

    request_timeout = timeout or float(os.getenv("HTTP_TIMEOUT_SECONDS", "30"))
    session = _session()
    for page in range(1, max(1, pages) + 1):
        response = session.get(
            f"{TMDB_BASE_URL}/movie/{list_type}",
            params={"api_key": key, "language": "en-US", "page": page},
            timeout=request_timeout,
        )
        response.raise_for_status()
        yield from response.json().get("results", [])


def normalize(movie: dict) -> NormalizedContent:
    """Map one TMDB movie list row to the Supabase contents schema."""

    release_date = movie.get("release_date") or None
    rating = _optional_float(movie.get("vote_average"))
    title = movie.get("title") or movie.get("original_title") or "Untitled"
    genres = [MOVIE_GENRES[genre_id] for genre_id in movie.get("genre_ids", []) if genre_id in MOVIE_GENRES]
    content_type = "documentary" if 99 in movie.get("genre_ids", []) else "movie"

    return NormalizedContent(
        external_id=str(movie["id"]),
        source="TMDB",
        content_type=content_type,
        title=title,
        original_title=movie.get("original_title"),
        alternative_titles=_unique_titles(title, movie.get("original_title")),
        overview=movie.get("overview") or None,
        genres=genres,
        original_language=movie.get("original_language") or None,
        poster_url=_image_url(TMDB_IMAGE_URL, movie.get("poster_path")),
        backdrop_url=_image_url(TMDB_BACKDROP_URL, movie.get("backdrop_path")),
        release_date=release_date,
        release_year=_release_year(release_date),
        rating_average=rating,
        rating_count=int(movie.get("vote_count") or 0),
        tmdb_rating=rating,
        popularity_score=max(0.0, float(movie.get("popularity") or 0)),
        keywords=genres,
    )


def _image_url(base: str, path: str | None) -> str | None:
    return f"{base}{path}" if path else None


def _optional_float(value: object) -> float | None:
    return float(value) if value is not None else None


def _release_year(value: str | None) -> int | None:
    return int(value[:4]) if value and len(value) >= 4 and value[:4].isdigit() else None


def _unique_titles(*values: str | None) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))
