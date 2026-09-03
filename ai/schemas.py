"""FastAPI request and response contracts."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=100)
    content_type: str | None = None


class RecommendRequest(BaseModel):
    user_id: UUID | None = None
    query: str | None = Field(default=None, min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=50)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=5, ge=1, le=10)


class InteractionRequest(BaseModel):
    user_id: UUID
    interaction_type: Literal["view", "like", "watchlist", "complete", "rating", "search"]
    content_id: int | None = Field(default=None, gt=0)
    rating: float | None = Field(default=None, ge=1, le=5)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_event(self) -> "InteractionRequest":
        if self.interaction_type == "rating" and self.rating is None:
            raise ValueError("rating is required for rating interactions")
        if self.interaction_type != "rating" and self.rating is not None:
            raise ValueError("rating is only valid for rating interactions")
        if self.interaction_type != "search" and self.content_id is None:
            raise ValueError("content_id is required except for search interactions")
        if self.interaction_type == "search" and not self.metadata.get("query"):
            raise ValueError("metadata.query is required for search interactions")
        return self
