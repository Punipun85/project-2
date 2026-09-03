"""Explainable hybrid recommendation scoring for NexaPlay AI."""

from __future__ import annotations

import math
from collections import Counter
from typing import Any, Iterable

from .database import get_supabase, response_data
from .interactions import InteractionService
from .vector_search import VectorSearchService


EVENT_WEIGHTS = {
    "view": 0.15,
    "like": 0.90,
    "watchlist": 0.65,
    "complete": 0.80,
    "rating": 1.00,
    "search": 0.05,
}


def _terms(value: Any, key: str | None = None) -> set[str]:
    values = value if isinstance(value, list) else []
    result: set[str] = set()
    for item in values:
        if isinstance(item, dict):
            term = item.get(key or "name")
        else:
            term = item
        if term:
            result.add(str(term).casefold())
    return result


def jaccard(left: Iterable[str], right: Iterable[str]) -> float:
    a, b = set(left), set(right)
    return len(a & b) / len(a | b) if a or b else 0.0


def popularity_score(candidate: dict[str, Any], max_values: dict[str, float]) -> float:
    rating = float(candidate.get("rating_average") or 0) / 10.0
    votes = math.log1p(float(candidate.get("rating_count") or 0)) / max(
        math.log1p(max_values.get("rating_count", 0)), 1.0
    )
    popularity = float(candidate.get("popularity_score") or 0) / max(
        max_values.get("popularity_score", 0), 1.0
    )
    return min(max(0.5 * rating + 0.25 * votes + 0.25 * popularity, 0.0), 1.0)


def rank_candidates(
    candidates: list[dict[str, Any]],
    preferred_genres: Iterable[str] = (),
    preferred_characters: Iterable[str] = (),
    behavior_affinity: dict[int, float] | None = None,
) -> list[dict[str, Any]]:
    """Apply the required 0.5/0.3/0.2 hybrid formula."""
    if not candidates:
        return []
    behavior_affinity = behavior_affinity or {}
    preferred_genres = {value.casefold() for value in preferred_genres}
    preferred_characters = {value.casefold() for value in preferred_characters}
    max_values = {
        "rating_count": max(float(row.get("rating_count") or 0) for row in candidates),
        "popularity_score": max(
            float(row.get("popularity_score") or 0) for row in candidates
        ),
    }
    ranked: list[dict[str, Any]] = []
    for row in candidates:
        vector_similarity = min(max(float(row.get("similarity") or 0), 0.0), 1.0)
        genre_similarity = jaccard(_terms(row.get("genres")), preferred_genres)
        character_similarity = jaccard(
            _terms(row.get("characters"), "name"), preferred_characters
        )
        content_similarity = (
            0.65 * vector_similarity
            + 0.20 * genre_similarity
            + 0.15 * character_similarity
        )
        behavior = min(
            max(behavior_affinity.get(int(row["content_id"]), vector_similarity), 0.0),
            1.0,
        )
        popularity = popularity_score(row, max_values)
        final = 0.5 * content_similarity + 0.3 * behavior + 0.2 * popularity
        reason_parts = []
        if vector_similarity >= 0.6:
            reason_parts.append("semantic match")
        if genre_similarity:
            reason_parts.append("genre preference")
        if character_similarity:
            reason_parts.append("character preference")
        if popularity >= 0.7:
            reason_parts.append("strong audience reception")
        ranked.append(
            {
                **row,
                "content_score": round(content_similarity, 6),
                "behavior_score": round(behavior, 6),
                "popularity_component": round(popularity, 6),
                "final_score": round(final, 6),
                "reason": ", ".join(reason_parts) or "balanced catalog match",
            }
        )
    return sorted(ranked, key=lambda row: row["final_score"], reverse=True)


class RecommendationService:
    def __init__(self, client: Any = None, search: VectorSearchService | None = None) -> None:
        self.client = client or get_supabase()
        self.search = search or VectorSearchService(self.client)
        self.interactions = InteractionService(self.client)

    def _profile(self, user_id: str) -> tuple[str, set[str], set[str], set[int]]:
        events = self.interactions.for_user(user_id)
        content_weights: Counter[int] = Counter()
        excluded: set[int] = set()
        for event in events:
            content_id = event.get("content_id")
            if content_id is None:
                continue
            weight = EVENT_WEIGHTS.get(event["interaction_type"], 0)
            if event["interaction_type"] == "rating":
                weight *= float(event.get("rating") or 0) / 5.0
            content_weights[int(content_id)] += weight
            if event["interaction_type"] in {"complete", "like"}:
                excluded.add(int(content_id))

        if not content_weights:
            return "popular acclaimed entertainment", set(), set(), excluded
        ids = list(content_weights)
        rows = response_data(
            self.client.table("contents")
            .select("id,title,overview,genres,characters")
            .in_("id", ids)
            .execute()
        )
        genres: Counter[str] = Counter()
        characters: Counter[str] = Counter()
        titles: list[str] = []
        for row in rows:
            weight = content_weights[int(row["id"])]
            titles.extend([row["title"]] * max(1, round(weight * 3)))
            for genre in _terms(row.get("genres")):
                genres[genre] += weight
            for character in _terms(row.get("characters"), "name"):
                characters[character] += weight
        top_genres = {name for name, _ in genres.most_common(8)}
        top_characters = {name for name, _ in characters.most_common(8)}
        query = " ".join(titles[:12] + list(top_genres) + list(top_characters))
        return query, top_genres, top_characters, excluded

    def recommend(
        self, user_id: str | None = None, query: str | None = None, limit: int = 10
    ) -> list[dict[str, Any]]:
        preferred_genres: set[str] = set()
        preferred_characters: set[str] = set()
        excluded: set[int] = set()
        profile_query = query
        if user_id:
            generated, preferred_genres, preferred_characters, excluded = self._profile(user_id)
            profile_query = profile_query or generated
        profile_query = profile_query or "popular acclaimed entertainment"
        candidates = self.search.search_similar_content(profile_query, max(limit * 4, 20))
        candidates = [row for row in candidates if int(row["content_id"]) not in excluded]
        return rank_candidates(candidates, preferred_genres, preferred_characters)[:limit]
