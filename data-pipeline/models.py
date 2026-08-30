from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class NormalizedContent:
    external_id: str
    provider: str
    type: str
    title: str
    original_title: str | None
    description: str
    poster_url: str | None
    backdrop_url: str | None
    genre: list[str] = field(default_factory=list)
    themes: list[str] = field(default_factory=list)
    language: str | None = None
    country: str | None = None
    release_date: str | None = None
    duration: int | None = None
    episodes: int | None = None
    season: str | None = None
    studio: str | None = None
    source_material: str | None = None
    director: str | None = None
    cast: list[str] = field(default_factory=list)
    rating: float = 0
    popularity: float = 0
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: list[float] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def embedding_text(self) -> str:
        features = [
            self.title,
            self.description,
            " ".join(self.genre),
            " ".join(self.themes),
            self.language or "",
            self.country or "",
            self.studio or "",
            self.source_material or "",
        ]
        return " | ".join(feature for feature in features if feature)
