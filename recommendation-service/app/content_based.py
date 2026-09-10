"""Content retrieval and normalized metadata similarity scoring."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable

import httpx

from .config import Settings


def terms(value: Any, key: str | None = None) -> set[str]:
    if isinstance(value, str):
        return {item.casefold() for item in value.split() if item.strip()}
    if not isinstance(value, list):
        return set()
    result: set[str] = set()
    for item in value:
        candidate = item.get(key or "name") if isinstance(item, dict) else item
        if candidate:
            result.add(str(candidate).strip().casefold())
    return {item for item in result if item}


def jaccard(left: Iterable[str], right: Iterable[str]) -> float:
    a, b = set(left), set(right)
    return len(a & b) / len(a | b) if a or b else 0.0


@dataclass
class ContentPreferences:
    genres: set[str] = field(default_factory=set)
    metadata: set[str] = field(default_factory=set)
    content_types: set[str] = field(default_factory=set)


class EmbeddingClient:
    """Calls Batch 1's external model; it never loads an embedding model."""

    def __init__(self, settings: Settings, client: httpx.Client | None = None) -> None:
        self.settings = settings
        self.client = client or httpx.Client(timeout=settings.request_timeout_seconds)

    def embed(self, text: str) -> list[float]:
        response = self.client.post(
            self.settings.embedding_api_url,
            headers={"Authorization": f"Bearer {self.settings.embedding_api_key}"},
            json={"text": " ".join(text.split())},
        )
        response.raise_for_status()
        payload = response.json()
        vector = payload.get("embedding")
        if (
            payload.get("model") != self.settings.embedding_model
            or payload.get("dimension") != 384
            or not isinstance(vector, list)
            or len(vector) != 384
            or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector)
        ):
            raise RuntimeError("Embedding service returned an invalid response")
        return [float(value) for value in vector]


def content_score(candidate: dict[str, Any], preferences: ContentPreferences) -> float:
    vector = min(max(float(candidate.get("similarity") or 0), 0.0), 1.0)
    genres = terms(candidate.get("genres"))
    metadata = (
        terms(candidate.get("themes"))
        | terms(candidate.get("moods"))
        | terms(candidate.get("keywords"))
        | terms(candidate.get("characters"), "name")
    )
    genre = jaccard(genres, preferences.genres)
    metadata_match = jaccard(metadata, preferences.metadata)
    type_match = (
        1.0
        if str(candidate.get("content_type") or "").casefold() in preferences.content_types
        else 0.0
    )
    return min(max(0.55 * vector + 0.25 * genre + 0.10 * type_match + 0.10 * metadata_match, 0), 1)
