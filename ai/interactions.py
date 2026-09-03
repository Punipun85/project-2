"""User behavior event validation and persistence."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from .database import get_supabase, response_data


INTERACTION_TYPES = {"view", "like", "watchlist", "complete", "rating", "search"}


class InteractionService:
    def __init__(self, client: Any = None) -> None:
        self.client = client or get_supabase()

    def track(
        self,
        user_id: UUID | str,
        interaction_type: str,
        content_id: int | None = None,
        rating: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        interaction_type = interaction_type.lower().strip()
        if interaction_type not in INTERACTION_TYPES:
            raise ValueError(f"Unsupported interaction_type: {interaction_type}")
        if interaction_type == "rating" and (rating is None or not 1 <= rating <= 5):
            raise ValueError("rating interactions require a rating from 1 to 5")
        if interaction_type != "rating" and rating is not None:
            raise ValueError("rating is only valid for rating interactions")
        if interaction_type != "search" and content_id is None:
            raise ValueError("content_id is required except for search interactions")
        if interaction_type == "search" and not (metadata or {}).get("query"):
            raise ValueError("search interactions require metadata.query")

        payload = {
            "user_id": str(user_id),
            "content_id": content_id,
            "interaction_type": interaction_type,
            "rating": rating,
            "metadata": metadata or {},
        }
        rows = response_data(
            self.client.table("user_interactions").insert(payload).execute()
        )
        return rows[0] if rows else payload

    def for_user(self, user_id: UUID | str, limit: int = 500) -> list[dict[str, Any]]:
        return response_data(
            self.client.table("user_interactions")
            .select("id,user_id,content_id,interaction_type,rating,metadata,created_at")
            .eq("user_id", str(user_id))
            .order("created_at", desc=True)
            .limit(min(max(limit, 1), 2000))
            .execute()
        )
