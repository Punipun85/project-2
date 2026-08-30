from pydantic import BaseModel, ConfigDict, Field

from .models import ContentType


class ContentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    external_id: str
    provider: str
    type: ContentType
    title: str
    original_title: str | None = None
    description: str
    poster_url: str | None = None
    backdrop_url: str | None = None
    genre: list[str] = []
    themes: list[str] = []
    language: str | None = None
    country: str | None = None
    release_date: str | None = None
    duration: int | None = None
    episodes: int | None = None
    season: str | None = None
    studio: str | None = None
    source_material: str | None = None
    director: str | None = None
    cast: list[str] = []
    rating: float
    popularity: float


class RecommendationRead(BaseModel):
    content: ContentRead
    content_score: float
    collaborative_score: float
    final_score: float
    reason: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=2, max_length=1000)
    user_id: str = "demo-user"


class ChatResponse(BaseModel):
    answer: str
    detected_types: list[ContentType]
    recommendations: list[RecommendationRead]


class PreferenceUpsert(BaseModel):
    favorite_content_types: list[ContentType] = []
    preferred_languages: list[str] = []
    favorite_genres: list[str] = []
    favorite_countries: list[str] = []
    disliked_genres: list[str] = []
    mood_profile: dict = {}


class PreferenceRead(PreferenceUpsert):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: str
