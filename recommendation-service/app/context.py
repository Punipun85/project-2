"""Short-term user context and viewing-time preference scoring."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .content_based import jaccard, terms


def time_bucket(hour: int) -> str:
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 22:
        return "evening"
    return "night"


@dataclass
class UserContext:
    recent_genres: set[str] = field(default_factory=set)
    search_terms: set[str] = field(default_factory=set)
    favorite_genres: set[str] = field(default_factory=set)
    favorite_types: set[str] = field(default_factory=set)
    completed_genres: set[str] = field(default_factory=set)
    time_types: dict[str, set[str]] = field(default_factory=dict)


def context_score(
    candidate: dict[str, Any], context: UserContext, request_hour: int | None = None
) -> float:
    genres = terms(candidate.get("genres"))
    metadata = terms(candidate.get("title")) | terms(candidate.get("overview"))
    content_type = str(candidate.get("content_type") or "").casefold()
    recent = jaccard(genres, context.recent_genres)
    search = jaccard(genres | metadata, context.search_terms)
    profile = max(
        jaccard(genres, context.favorite_genres),
        1.0 if content_type in context.favorite_types else 0.0,
    )
    completion = jaccard(genres, context.completed_genres)
    bucket = time_bucket(request_hour if request_hour is not None else datetime.now().hour)
    time_match = 1.0 if content_type in context.time_types.get(bucket, set()) else 0.0
    return min(0.30 * recent + 0.20 * search + 0.25 * profile + 0.15 * completion + 0.10 * time_match, 1)
