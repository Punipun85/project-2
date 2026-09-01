from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class NormalizedContent:
    external_id: str
    source: str
    content_type: str
    title: str

    series_type: str | None = None
    original_title: str | None = None
    alternative_titles: list[str] = field(default_factory=list)
    overview: str | None = None
    tagline: str | None = None
    ai_summary: str | None = None

    genres: list[str] = field(default_factory=list)
    themes: list[str] = field(default_factory=list)
    moods: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)

    original_language: str | None = None
    country: list[str] = field(default_factory=list)

    poster_url: str | None = None
    backdrop_url: str | None = None
    trailer_url: str | None = None

    release_date: str | None = None
    release_year: int | None = None
    status: str | None = None

    duration_minutes: int | None = None
    number_of_seasons: int | None = None
    number_of_episodes: int | None = None
    episode_duration_minutes: int | None = None
    season_number: int | None = None

    studio: list[dict[str, Any] | str] = field(default_factory=list)
    network: str | None = None
    platform: str | None = None
    director: list[dict[str, Any] | str] = field(default_factory=list)
    creator: list[dict[str, Any] | str] = field(default_factory=list)
    cast: list[dict[str, Any] | str] = field(default_factory=list)
    characters: list[dict[str, Any] | str] = field(default_factory=list)

    rating_average: float | None = None
    rating_count: int = 0
    tmdb_rating: float | None = None
    imdb_rating: float | None = None
    mal_rating: float | None = None
    popularity_score: float = 0

    embedding: list[float] | None = None
    ai_tags: list[str] = field(default_factory=list)
    is_active: bool = True

    def to_dict(
        self,
        *,
        exclude_none: bool = True,
        exclude_empty: bool = True,
    ) -> dict[str, Any]:
        data = asdict(self)
        return {
            key: value
            for key, value in data.items()
            if not (exclude_none and value is None)
            and not (exclude_empty and value in ([], {}))
        }

    def embedding_text(self) -> str:
        features = [
            self.title,
            self.overview or "",
            self.ai_summary or "",
            " ".join(self.genres),
            " ".join(self.themes),
            " ".join(self.moods),
            " ".join(self.keywords),
            self.original_language or "",
            " ".join(self.country),
            " ".join(_item_name(item) for item in self.studio),
        ]
        return " | ".join(feature for feature in features if feature)


def _item_name(item: dict[str, Any] | str) -> str:
    if isinstance(item, str):
        return item
    return str(item.get("name") or "")
