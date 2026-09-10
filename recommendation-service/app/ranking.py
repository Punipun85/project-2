"""Exact Batch 2 score composition and explainable ranking."""

from __future__ import annotations

import math
from typing import Any

from .content_based import ContentPreferences, content_score, terms
from .context import UserContext, context_score


CONTENT_WEIGHT = 0.5
COLLABORATIVE_WEIGHT = 0.3
CONTEXT_WEIGHT = 0.2


def popularity_score(candidate: dict[str, Any], maxima: dict[str, float]) -> float:
    rating = float(candidate.get("rating_average") or 0) / 10
    votes = math.log1p(float(candidate.get("rating_count") or 0)) / max(
        math.log1p(maxima["rating_count"]), 1
    )
    popularity = float(candidate.get("popularity_score") or 0) / max(
        maxima["popularity_score"], 1
    )
    return min(max(0.50 * rating + 0.25 * votes + 0.25 * popularity, 0), 1)


def rank(
    candidates: list[dict[str, Any]],
    preferences: ContentPreferences,
    context: UserContext,
    collaborative: dict[int, float],
    *,
    cold_start: bool,
    request_hour: int | None = None,
) -> list[dict[str, Any]]:
    if not candidates:
        return []
    maxima = {
        "rating_count": max(float(row.get("rating_count") or 0) for row in candidates),
        "popularity_score": max(float(row.get("popularity_score") or 0) for row in candidates),
    }
    has_peers = bool(collaborative)
    ranked = []
    for candidate in candidates:
        content_id = int(candidate.get("content_id") or candidate["id"])
        content = content_score(candidate, preferences)
        popularity = popularity_score(candidate, maxima)
        collab = min(max(collaborative.get(content_id, 0), 0), 1) if has_peers else popularity
        current_context = context_score(candidate, context, request_hour)
        final = CONTENT_WEIGHT * content + COLLABORATIVE_WEIGHT * collab + CONTEXT_WEIGHT * current_context
        matched = sorted(terms(candidate.get("genres")) & (preferences.genres | context.recent_genres))
        if matched:
            reason = f"Recommended because you enjoy {', '.join(matched[:3])} stories"
        elif has_peers and collab >= 0.35:
            reason = "Recommended because viewers with similar taste enjoyed it"
        elif cold_start:
            reason = "Recommended because it is popular, highly rated, and trending"
        else:
            reason = "Recommended from your semantic preferences and recent viewing context"
        ranked.append(
            {
                **candidate,
                "content_id": content_id,
                "content_score": round(content, 6),
                "collaborative_score": round(collab, 6),
                "context_score": round(current_context, 6),
                "final_score": round(final, 6),
                "reason": reason,
                "strategy": "cold_start_trending" if cold_start else "personalized_hybrid",
            }
        )
    return sorted(ranked, key=lambda item: item["final_score"], reverse=True)
