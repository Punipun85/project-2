"""Normalize TMDB and MAL payloads into the Supabase ``contents`` schema."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w500"
TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/original"
STREAMING_NETWORKS = {
    "netflix",
    "amazon",
    "amazon prime video",
    "prime video",
    "hulu",
    "disney+",
    "disney plus",
    "apple tv+",
    "apple tv plus",
    "max",
    "hbo max",
    "paramount+",
    "peacock",
}


class ContentRecord(BaseModel):
    """Only columns owned by Batch 1; database timestamps remain server-managed."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    external_id: str
    source: Literal["TMDB", "MAL"]
    content_type: Literal["movie", "series", "anime"]
    series_type: str | None = None
    title: str
    original_title: str | None = None
    alternative_titles: list[str] = Field(default_factory=list)
    overview: str | None = None
    poster_url: str | None = None
    backdrop_url: str | None = None
    genres: list[str] = Field(default_factory=list)
    original_language: str | None = None
    country: list[str] = Field(default_factory=list)
    release_date: str | None = None
    release_year: int | None = None
    duration_minutes: int | None = None
    number_of_seasons: int | None = None
    number_of_episodes: int | None = None
    studio: list[dict[str, Any]] = Field(default_factory=list)
    network: str | None = None
    platform: str | None = None
    director: list[dict[str, Any]] = Field(default_factory=list)
    creator: list[dict[str, Any]] = Field(default_factory=list)
    cast: list[dict[str, Any]] = Field(default_factory=list)
    characters: list[dict[str, Any]] = Field(default_factory=list)
    rating_average: float | None = None
    rating_count: int = Field(default=0, ge=0)
    popularity_score: float = Field(default=0, ge=0)

    @field_validator("external_id", "title")
    @classmethod
    def required_text_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("nilai wajib tidak boleh kosong")
        return value

    @field_validator("release_date")
    @classmethod
    def normalize_release_date(cls, value: str | None) -> str | None:
        if not value:
            return None
        candidate = value[:10]
        return candidate if len(candidate) == 10 else None

    @model_validator(mode="after")
    def validate_classification(self) -> "ContentRecord":
        anime_types = {"anime_series", "anime_movie", "ova"}
        series_types = {"tv_series", "streaming_series", "kdrama", "jdrama", "cdrama"}
        if self.content_type == "anime" and self.series_type not in anime_types:
            raise ValueError("anime harus memakai series_type anime_series, anime_movie, atau ova")
        if self.content_type == "series" and self.series_type not in series_types:
            raise ValueError("series_type tidak valid untuk konten series")
        if self.content_type == "movie" and self.series_type is not None:
            raise ValueError("movie tidak boleh memiliki series_type")
        return self

    def to_supabase(self) -> dict[str, Any]:
        """Return a sparse payload so absent scalar metadata does not overwrite richer rows."""

        return self.model_dump(exclude_none=True)


def normalize_tmdb_movie(movie: dict[str, Any], *, cast_limit: int = 20) -> ContentRecord:
    external_id = _required_id(movie)
    title = _required_title(movie.get("title"), movie.get("original_title"))
    credits = movie.get("credits") if isinstance(movie.get("credits"), dict) else {}
    cast = _tmdb_cast(credits.get("cast"), cast_limit)
    release_date = _date(movie.get("release_date"))
    genres = _tmdb_names(movie.get("genres"))
    companies = _named_objects(movie.get("production_companies"))
    countries = _country_names(movie.get("production_countries"))

    return ContentRecord(
        external_id=external_id,
        source="TMDB",
        content_type="movie",
        title=title,
        original_title=_nullable_text(movie.get("original_title")),
        alternative_titles=_unique_strings(title, movie.get("original_title")),
        overview=_nullable_text(movie.get("overview")),
        poster_url=_tmdb_image(TMDB_POSTER_BASE, movie.get("poster_path")),
        backdrop_url=_tmdb_image(TMDB_BACKDROP_BASE, movie.get("backdrop_path")),
        genres=genres,
        original_language=_nullable_text(movie.get("original_language")),
        country=countries,
        release_date=release_date,
        release_year=_release_year(release_date),
        duration_minutes=_positive_int(movie.get("runtime")),
        studio=companies,
        director=_tmdb_directors(credits.get("crew")),
        cast=cast,
        characters=[
            {"name": item["character"], "performer": item["name"]}
            for item in cast
            if item.get("character")
        ],
        rating_average=_optional_float(movie.get("vote_average")),
        rating_count=_nonnegative_int(movie.get("vote_count")),
        popularity_score=_nonnegative_float(movie.get("popularity")),
    )


def normalize_tmdb_series(series: dict[str, Any], *, cast_limit: int = 20) -> ContentRecord:
    external_id = _required_id(series)
    title = _required_title(series.get("name"), series.get("original_name"))
    countries = _series_countries(series)
    networks = _named_objects(series.get("networks"))
    network_names = [item["name"] for item in networks]
    series_type, platform = detect_series_type(countries, network_names)
    credits = series.get("aggregate_credits") if isinstance(series.get("aggregate_credits"), dict) else {}
    cast = _tmdb_series_cast(credits.get("cast"), cast_limit)
    release_date = _date(series.get("first_air_date"))
    episode_runtimes = series.get("episode_run_time") or []

    return ContentRecord(
        external_id=external_id,
        source="TMDB",
        content_type="series",
        series_type=series_type,
        title=title,
        original_title=_nullable_text(series.get("original_name")),
        alternative_titles=_unique_strings(title, series.get("original_name")),
        overview=_nullable_text(series.get("overview")),
        poster_url=_tmdb_image(TMDB_POSTER_BASE, series.get("poster_path")),
        backdrop_url=_tmdb_image(TMDB_BACKDROP_BASE, series.get("backdrop_path")),
        genres=_tmdb_names(series.get("genres")),
        original_language=_nullable_text(series.get("original_language")),
        country=countries,
        release_date=release_date,
        release_year=_release_year(release_date),
        duration_minutes=_positive_int(episode_runtimes[0]) if episode_runtimes else None,
        number_of_seasons=_nonnegative_optional_int(series.get("number_of_seasons")),
        number_of_episodes=_nonnegative_optional_int(series.get("number_of_episodes")),
        studio=_named_objects(series.get("production_companies")),
        network=", ".join(network_names) or None,
        platform=platform,
        director=_tmdb_series_directors(credits.get("crew")),
        creator=_people_with_role(series.get("created_by"), "Creator"),
        cast=cast,
        characters=[
            {"name": item["character"], "performer": item["name"]}
            for item in cast
            if item.get("character")
        ],
        rating_average=_optional_float(series.get("vote_average")),
        rating_count=_nonnegative_int(series.get("vote_count")),
        popularity_score=_nonnegative_float(series.get("popularity")),
    )


def normalize_mal_anime(anime: dict[str, Any]) -> ContentRecord:
    external_id = _required_id(anime)
    alternatives = anime.get("alternative_titles") if isinstance(anime.get("alternative_titles"), dict) else {}
    title = _required_title(alternatives.get("en"), anime.get("title"))
    original_title = _nullable_text(alternatives.get("ja")) or _nullable_text(anime.get("title"))
    release_date = _date(anime.get("start_date"))
    media_type = str(anime.get("media_type") or "").lower()
    series_type = "anime_movie" if media_type == "movie" else "ova" if media_type == "ova" else "anime_series"
    picture = anime.get("main_picture") if isinstance(anime.get("main_picture"), dict) else {}
    duration_seconds = _nonnegative_optional_int(anime.get("average_episode_duration"))
    num_list_users = _nonnegative_float(anime.get("num_list_users"))
    popularity_rank = _nonnegative_float(anime.get("popularity"))
    popularity_score = num_list_users or popularity_rank

    return ContentRecord(
        external_id=external_id,
        source="MAL",
        content_type="anime",
        series_type=series_type,
        title=title,
        original_title=original_title,
        alternative_titles=_mal_alternative_titles(anime),
        overview=_nullable_text(anime.get("synopsis")),
        poster_url=_nullable_text(picture.get("large")) or _nullable_text(picture.get("medium")),
        genres=_tmdb_names(anime.get("genres")),
        original_language="ja",
        country=["Japan"],
        release_date=release_date,
        release_year=_mal_release_year(anime, release_date),
        duration_minutes=_seconds_to_positive_minutes(duration_seconds),
        number_of_episodes=_nonnegative_optional_int(anime.get("num_episodes")),
        studio=_named_objects(anime.get("studios")),
        characters=_normalize_people(anime.get("characters")),
        rating_average=_optional_float(anime.get("mean")),
        rating_count=_nonnegative_int(anime.get("num_scoring_users")),
        popularity_score=popularity_score,
    )


def detect_series_type(countries: list[str], network_names: list[str]) -> tuple[str, str | None]:
    normalized_countries = {value.casefold() for value in countries}
    if normalized_countries & {"kr", "south korea", "korea, republic of"}:
        return "kdrama", _streaming_platform(network_names)
    if normalized_countries & {"jp", "japan"}:
        return "jdrama", _streaming_platform(network_names)
    if normalized_countries & {"cn", "china", "mainland china"}:
        return "cdrama", _streaming_platform(network_names)
    platform = _streaming_platform(network_names)
    if platform:
        return "streaming_series", platform
    return "tv_series", None


def _required_id(value: dict[str, Any]) -> str:
    external_id = value.get("id")
    if external_id is None or not str(external_id).strip():
        raise ValueError("Record provider tidak memiliki id")
    return str(external_id)


def _required_title(*values: object) -> str:
    for value in values:
        text = _nullable_text(value)
        if text:
            return text
    raise ValueError("Record provider tidak memiliki title")


def _nullable_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _unique_strings(*values: object) -> list[str]:
    result: list[str] = []
    for value in values:
        if isinstance(value, list):
            candidates = value
        else:
            candidates = [value]
        for candidate in candidates:
            text = _nullable_text(candidate)
            if text and text not in result:
                result.append(text)
    return result


def _mal_alternative_titles(anime: dict[str, Any]) -> list[str]:
    alternatives = anime.get("alternative_titles") if isinstance(anime.get("alternative_titles"), dict) else {}
    return _unique_strings(
        anime.get("title"),
        alternatives.get("en"),
        alternatives.get("ja"),
        alternatives.get("synonyms") or [],
    )


def _tmdb_names(items: object) -> list[str]:
    if not isinstance(items, list):
        return []
    return _unique_strings(*[item.get("name") for item in items if isinstance(item, dict)])


def _named_objects(items: object) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    result: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict) or not _nullable_text(item.get("name")):
            continue
        normalized: dict[str, Any] = {"name": str(item["name"]).strip()}
        if item.get("id") is not None:
            normalized["id"] = item["id"]
        result.append(normalized)
    return result


def _country_names(items: object) -> list[str]:
    if not isinstance(items, list):
        return []
    return _unique_strings(
        *[
            item.get("name") or item.get("iso_3166_1")
            for item in items
            if isinstance(item, dict)
        ]
    )


def _series_countries(series: dict[str, Any]) -> list[str]:
    production = _country_names(series.get("production_countries"))
    origins = _unique_strings(series.get("origin_country") or [])
    return _unique_strings(production, origins)


def _tmdb_cast(items: object, limit: int) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    result: list[dict[str, Any]] = []
    for item in items[:limit]:
        if not isinstance(item, dict) or not _nullable_text(item.get("name")):
            continue
        row: dict[str, Any] = {"name": str(item["name"]).strip()}
        if _nullable_text(item.get("character")):
            row["character"] = str(item["character"]).strip()
        result.append(row)
    return result


def _tmdb_series_cast(items: object, limit: int) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    result: list[dict[str, Any]] = []
    for item in items[:limit]:
        if not isinstance(item, dict) or not _nullable_text(item.get("name")):
            continue
        roles = item.get("roles") if isinstance(item.get("roles"), list) else []
        character = next(
            (_nullable_text(role.get("character")) for role in roles if isinstance(role, dict)),
            None,
        )
        row: dict[str, Any] = {"name": str(item["name"]).strip()}
        if character:
            row["character"] = character
        result.append(row)
    return result


def _tmdb_directors(items: object) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    return [
        {"name": str(item["name"]).strip(), "role": "Director"}
        for item in items
        if isinstance(item, dict)
        and item.get("job") == "Director"
        and _nullable_text(item.get("name"))
    ]


def _tmdb_series_directors(items: object) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    directors: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict) or not _nullable_text(item.get("name")):
            continue
        jobs = item.get("jobs") if isinstance(item.get("jobs"), list) else []
        if any(isinstance(job, dict) and job.get("job") == "Director" for job in jobs):
            directors.append({"name": str(item["name"]).strip(), "role": "Director"})
    return directors


def _people_with_role(items: object, role: str) -> list[dict[str, Any]]:
    return [{**item, "role": role} for item in _named_objects(items)]


def _normalize_people(items: object) -> list[dict[str, Any]]:
    return _named_objects(items)


def _streaming_platform(network_names: list[str]) -> str | None:
    for name in network_names:
        if name.casefold() in STREAMING_NETWORKS:
            return name
    return None


def _tmdb_image(base: str, path: object) -> str | None:
    normalized = _nullable_text(path)
    return f"{base}{normalized}" if normalized else None


def _date(value: object) -> str | None:
    text = _nullable_text(value)
    return text[:10] if text and len(text) >= 10 else None


def _release_year(release_date: str | None) -> int | None:
    return int(release_date[:4]) if release_date and release_date[:4].isdigit() else None


def _mal_release_year(anime: dict[str, Any], release_date: str | None) -> int | None:
    # Supabase requires release_year to match release_date. MAL occasionally
    # labels a December premiere as the following winter season, so the actual
    # start date must take precedence over start_season.year.
    date_year = _release_year(release_date)
    if date_year is not None:
        return date_year
    start_season = anime.get("start_season") if isinstance(anime.get("start_season"), dict) else {}
    year = start_season.get("year")
    if isinstance(year, int):
        return year
    return None


def _optional_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _nonnegative_float(value: object) -> float:
    parsed = _optional_float(value)
    return max(parsed or 0.0, 0.0)


def _nonnegative_int(value: object) -> int:
    parsed = _nonnegative_optional_int(value)
    return parsed or 0


def _nonnegative_optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    return max(int(value), 0)


def _positive_int(value: object) -> int | None:
    parsed = _nonnegative_optional_int(value)
    return parsed if parsed and parsed > 0 else None


def _seconds_to_positive_minutes(seconds: int | None) -> int | None:
    if not seconds or seconds <= 0:
        return None
    return max(1, (seconds + 59) // 60)
