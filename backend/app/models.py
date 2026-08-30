from datetime import datetime
from enum import Enum

from sqlalchemy import DateTime, Enum as SqlEnum, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class ContentType(str, Enum):
    MOVIE = "movie"
    ANIME = "anime"
    KDRAMA = "kdrama"
    SERIES = "series"
    DOCUMENTARY = "documentary"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Content(Base):
    __tablename__ = "contents"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", "type", name="uq_content_provider_external_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    external_id: Mapped[str] = mapped_column(String(80), index=True)
    provider: Mapped[str] = mapped_column(String(30))
    type: Mapped[ContentType] = mapped_column(SqlEnum(ContentType, name="content_type_enum"), index=True)
    title: Mapped[str] = mapped_column(String(320), index=True)
    original_title: Mapped[str | None] = mapped_column(String(320))
    description: Mapped[str] = mapped_column(Text, default="")
    poster_url: Mapped[str | None] = mapped_column(Text)
    backdrop_url: Mapped[str | None] = mapped_column(Text)
    genre: Mapped[list[str]] = mapped_column(JSON, default=list)
    themes: Mapped[list[str]] = mapped_column(JSON, default=list)
    language: Mapped[str | None] = mapped_column(String(80), index=True)
    country: Mapped[str | None] = mapped_column(String(120), index=True)
    release_date: Mapped[str | None] = mapped_column(String(32))
    duration: Mapped[int | None] = mapped_column(Integer)
    episodes: Mapped[int | None] = mapped_column(Integer)
    season: Mapped[str | None] = mapped_column(String(80))
    studio: Mapped[str | None] = mapped_column(String(200))
    source_material: Mapped[str | None] = mapped_column(String(120))
    director: Mapped[str | None] = mapped_column(String(200))
    cast: Mapped[list[str]] = mapped_column(JSON, default=list)
    rating: Mapped[float] = mapped_column(Float, default=0)
    popularity: Mapped[float] = mapped_column(Float, default=0, index=True)
    embedding: Mapped[list[float] | None] = mapped_column(JSON)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    favorite_content_types: Mapped[list[str]] = mapped_column(JSON, default=list)
    preferred_languages: Mapped[list[str]] = mapped_column(JSON, default=list)
    favorite_genres: Mapped[list[str]] = mapped_column(JSON, default=list)
    favorite_countries: Mapped[list[str]] = mapped_column(JSON, default=list)
    disliked_genres: Mapped[list[str]] = mapped_column(JSON, default=list)
    mood_profile: Mapped[dict] = mapped_column(JSON, default=dict)
    user: Mapped[User] = relationship()


class ContentRating(Base):
    __tablename__ = "content_ratings"
    __table_args__ = (UniqueConstraint("user_id", "content_id", name="uq_rating_user_content"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content_id: Mapped[int] = mapped_column(ForeignKey("contents.id", ondelete="CASCADE"), index=True)
    rating: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WatchHistory(Base):
    __tablename__ = "watch_history"
    __table_args__ = (UniqueConstraint("user_id", "content_id", name="uq_history_user_content"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content_id: Mapped[int] = mapped_column(ForeignKey("contents.id", ondelete="CASCADE"), index=True)
    progress: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(30), default="planned")
    watched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AiMemory(Base):
    __tablename__ = "ai_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    memory: Mapped[str] = mapped_column(Text)
    memory_type: Mapped[str] = mapped_column(String(60), default="preference")
    embedding: Mapped[list[float] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
