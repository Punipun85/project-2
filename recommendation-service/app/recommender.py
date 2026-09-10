"""Supabase orchestration for personalized recommendation generation."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from typing import Any

from supabase import Client, create_client

from .collaborative import build_affinity, collaborative_scores
from .config import Settings
from .content_based import ContentPreferences, EmbeddingClient, terms
from .context import UserContext, time_bucket
from .ranking import rank


CONTENT_COLUMNS = (
    "id,external_id,source,title,original_title,content_type,series_type,overview,"
    "genres,themes,moods,keywords,poster_url,backdrop_url,original_language,country,"
    "release_year,director,cast,characters,rating_average,rating_count,popularity_score"
)


def data(response: Any) -> list[dict[str, Any]]:
    value = getattr(response, "data", None)
    return value if isinstance(value, list) else []


class RecommendationEngine:
    def __init__(
        self,
        settings: Settings,
        client: Client | None = None,
        embeddings: EmbeddingClient | None = None,
    ) -> None:
        self.settings = settings
        self.client = client or create_client(settings.supabase_url, settings.supabase_key)
        self.embeddings = embeddings or EmbeddingClient(settings)

    def _user_rows(self, table: str, columns: str, user_id: str) -> list[dict[str, Any]]:
        identity_column = "id" if table in {"profiles", "user_profiles"} else "user_id"
        try:
            return data(
                self.client.table(table)
                .select(columns)
                .eq(identity_column, user_id)
                .execute()
            )
        except Exception:
            return []

    def _popular(
        self, limit: int, content_type: str | None, series_type: str | None
    ) -> list[dict[str, Any]]:
        query = (
            self.client.table("contents")
            .select(CONTENT_COLUMNS)
            .eq("is_active", True)
            .order("popularity_score", desc=True)
            .limit(min(max(limit, 1), 100))
        )
        if content_type:
            query = query.eq("content_type", content_type)
        if series_type:
            query = query.eq("series_type", series_type)
        rows = data(query.execute())
        for row in rows:
            row["content_id"] = int(row["id"])
            row["similarity"] = 0.5
        return rows

    def _signals(
        self, user_id: str
    ) -> tuple[
        ContentPreferences,
        UserContext,
        dict[int, float],
        set[int],
        str,
        list[float] | None,
    ]:
        preferences = ContentPreferences()
        context = UserContext()
        profile = self._user_rows(
            "user_preferences", "favorite_genres,favorite_types,favorite_moods", user_id
        )
        if not profile:
            profile = self._user_rows(
                "user_profiles", "favorite_genres,favorite_types,favorite_moods", user_id
            )
        if profile:
            preferences.genres |= terms(profile[0].get("favorite_genres"))
            preferences.content_types |= terms(profile[0].get("favorite_types"))
            preferences.metadata |= terms(profile[0].get("favorite_moods"))
            context.favorite_genres |= preferences.genres
            context.favorite_types |= preferences.content_types

        interactions = self._user_rows(
            "user_interactions",
            "content_id,interaction_type,rating,metadata,created_at",
            user_id,
        )
        histories = self._user_rows(
            "watch_history", "content_id,progress,status,watched_at,updated_at", user_id
        )
        watchlists = self._user_rows("watchlists", "content_id,created_at", user_id)
        ratings = self._user_rows("ratings", "content_id,rating,updated_at", user_id)
        favorites = self._user_rows("favorites", "content_id,created_at", user_id)
        taste_rows = self._user_rows(
            "user_taste_profiles", "genre_scores,styles", user_id
        )
        if taste_rows:
            scores = taste_rows[0].get("genre_scores") or {}
            if isinstance(scores, dict):
                preferences.genres |= {
                    str(genre).casefold()
                    for genre, score in scores.items()
                    if float(score or 0) > 0
                }
            preferences.metadata |= terms(taste_rows[0].get("styles"))
        embedding_rows = self._user_rows(
            "user_embeddings", "embedding,status", user_id
        )
        user_vector: list[float] | None = None
        if embedding_rows and embedding_rows[0].get("status") == "completed":
            value = embedding_rows[0].get("embedding")
            try:
                parsed = json.loads(value) if isinstance(value, str) else value
                if isinstance(parsed, list) and len(parsed) == 384:
                    user_vector = [float(item) for item in parsed]
            except (TypeError, ValueError, json.JSONDecodeError):
                user_vector = None
        canonical_rating_ids = {
            int(row["content_id"])
            for row in ratings
            if row.get("content_id") is not None
        }
        canonical_favorite_ids = {
            int(row["content_id"])
            for row in favorites
            if row.get("content_id") is not None
        }
        events = [
            event
            for event in interactions
            if not (
                event.get("content_id") is not None
                and (
                    (
                        event.get("interaction_type") == "rating"
                        and int(event["content_id"]) in canonical_rating_ids
                    )
                    or (
                        event.get("interaction_type") in {"like", "favorite"}
                        and int(event["content_id"]) in canonical_favorite_ids
                    )
                )
            )
        ]
        events.extend(
            {
                "content_id": row.get("content_id"),
                "interaction_type": "rating",
                "rating": row.get("rating"),
                "created_at": row.get("updated_at"),
            }
            for row in ratings
        )
        events.extend(
            {
                "content_id": row.get("content_id"),
                "interaction_type": "favorite",
                "created_at": row.get("created_at"),
            }
            for row in favorites
        )
        events.extend(
            {
                "content_id": row.get("content_id"),
                "interaction_type": "complete" if row.get("status") == "completed" else "view",
                "created_at": row.get("updated_at") or row.get("watched_at"),
                "progress": row.get("progress"),
            }
            for row in histories
        )
        events.extend(
            {
                "content_id": row.get("content_id"),
                "interaction_type": "watchlist",
                "created_at": row.get("created_at"),
            }
            for row in watchlists
        )
        for event in events:
            if event.get("interaction_type") == "search":
                query = (event.get("metadata") or {}).get("query")
                context.search_terms |= terms(query)

        affinity = build_affinity(events)
        excluded = {
            int(event["content_id"])
            for event in events
            if event.get("content_id") is not None
            and event.get("interaction_type") in {"like", "favorite", "watchlist", "complete", "rating", "not_interested"}
        }
        positive_ids = [item for item, score in affinity.items() if score > 0]
        titles: list[str] = []
        if positive_ids:
            rows = data(
                self.client.table("contents")
                .select("id,title,content_type,genres,themes,moods,keywords,characters")
                .in_("id", positive_ids)
                .execute()
            )
            by_id = {int(row["id"]): row for row in rows}
            genre_weights: Counter[str] = Counter()
            for item, score in affinity.items():
                row = by_id.get(item)
                if not row or score <= 0:
                    continue
                titles.append(str(row.get("title") or ""))
                content_type = str(row.get("content_type") or "").casefold()
                preferences.content_types.add(content_type)
                row_genres = terms(row.get("genres"))
                for genre in row_genres:
                    genre_weights[genre] += score
                preferences.metadata |= (
                    terms(row.get("themes"))
                    | terms(row.get("moods"))
                    | terms(row.get("keywords"))
                    | terms(row.get("characters"), "name")
                )
            preferences.genres |= {item for item, _ in genre_weights.most_common(10)}
            context.recent_genres |= {item for item, _ in genre_weights.most_common(6)}
            for row in histories:
                content = by_id.get(int(row.get("content_id") or 0))
                if content and (row.get("status") == "completed" or float(row.get("progress") or 0) >= 90):
                    context.completed_genres |= terms(content.get("genres"))
            for event in events:
                content = by_id.get(int(event.get("content_id") or 0))
                if not content:
                    continue
                metadata = event.get("metadata") or {}
                local_hour = metadata.get("local_hour") if isinstance(metadata, dict) else None
                if local_hour is None and event.get("created_at"):
                    try:
                        local_hour = datetime.fromisoformat(
                            str(event["created_at"]).replace("Z", "+00:00")
                        ).hour
                    except ValueError:
                        local_hour = None
                if local_hour is not None:
                    bucket = time_bucket(int(local_hour) % 24)
                    context.time_types.setdefault(bucket, set()).add(
                        str(content.get("content_type") or "").casefold()
                    )
        query = " ".join(
            [
                *titles[:8],
                *sorted(preferences.genres),
                *sorted(preferences.metadata),
                *sorted(preferences.content_types),
                *sorted(context.search_terms),
            ]
        )
        return preferences, context, affinity, excluded, query, user_vector

    def _semantic_candidates(
        self,
        query: str,
        limit: int,
        content_type: str | None,
        series_type: str | None,
    ) -> list[dict[str, Any]]:
        vector = self.embeddings.embed(query)
        return self._vector_candidates(vector, limit, content_type, series_type)

    def _vector_candidates(
        self,
        vector: list[float],
        limit: int,
        content_type: str | None,
        series_type: str | None,
    ) -> list[dict[str, Any]]:
        return data(
            self.client.rpc(
                "match_contents",
                {
                    "query_embedding": vector,
                    "match_threshold": 0.05,
                    "match_count": min(max(limit, 1), 100),
                    "filter_content_type": content_type,
                    "filter_series_type": series_type,
                },
            ).execute()
        )

    def _peer_events(self, user_id: str, affinity_ids: list[int]) -> list[dict[str, Any]]:
        if not affinity_ids:
            return []
        try:
            interaction_overlap = data(
                self.client.table("user_interactions")
                .select("user_id")
                .in_("content_id", affinity_ids)
                .neq("user_id", user_id)
                .limit(5000)
                .execute()
            )
            history_overlap = data(
                self.client.table("watch_history")
                .select("user_id")
                .in_("content_id", affinity_ids)
                .neq("user_id", user_id)
                .limit(5000)
                .execute()
            )
            watchlist_overlap = data(
                self.client.table("watchlists")
                .select("user_id")
                .in_("content_id", affinity_ids)
                .neq("user_id", user_id)
                .limit(5000)
                .execute()
            )
            peer_ids = list(
                {
                    str(row["user_id"])
                    for row in interaction_overlap + history_overlap + watchlist_overlap
                }
            )[:100]
            if not peer_ids:
                return []
            events = data(
                self.client.table("user_interactions")
                .select("user_id,content_id,interaction_type,rating,created_at")
                .in_("user_id", peer_ids)
                .limit(20000)
                .execute()
            )
            histories = data(
                self.client.table("watch_history")
                .select("user_id,content_id,status,progress,updated_at")
                .in_("user_id", peer_ids)
                .limit(20000)
                .execute()
            )
            watchlists = data(
                self.client.table("watchlists")
                .select("user_id,content_id,created_at")
                .in_("user_id", peer_ids)
                .limit(20000)
                .execute()
            )
            events.extend(
                {
                    "user_id": row["user_id"],
                    "content_id": row["content_id"],
                    "interaction_type": "complete" if row.get("status") == "completed" else "view",
                    "created_at": row.get("updated_at"),
                }
                for row in histories
            )
            events.extend(
                {
                    "user_id": row["user_id"],
                    "content_id": row["content_id"],
                    "interaction_type": "watchlist",
                    "created_at": row.get("created_at"),
                }
                for row in watchlists
            )
            return events
        except Exception:
            return []

    def recommend(
        self,
        user_id: str | None,
        limit: int = 20,
        query: str | None = None,
        content_type: str | None = None,
        series_type: str | None = None,
        request_hour: int | None = None,
    ) -> list[dict[str, Any]]:
        limit = min(max(limit, 1), 50)
        if user_id:
            preferences, context, affinity, excluded, profile_query, user_vector = self._signals(user_id)
        else:
            preferences, context, affinity, excluded, profile_query, user_vector = (
                ContentPreferences(), UserContext(), {}, set(), "", None
            )
        cold_start = not affinity and not preferences.genres and not query
        if cold_start:
            candidates = self._popular(limit * 4, content_type, series_type)
        else:
            semantic_query = query or profile_query or "popular trending entertainment"
            try:
                candidates = (
                    self._vector_candidates(user_vector, limit * 4, content_type, series_type)
                    if user_vector is not None and not query
                    else self._semantic_candidates(
                        semantic_query, limit * 4, content_type, series_type
                    )
                )
            except Exception:
                candidates = self._popular(limit * 4, content_type, series_type)
        candidates = [
            row
            for row in candidates
            if int(row.get("content_id") or row["id"]) not in excluded
        ]
        candidate_ids = {int(row.get("content_id") or row["id"]) for row in candidates}
        peers = self._peer_events(user_id, list(affinity)) if user_id else []
        collaborative = collaborative_scores(affinity, peers, candidate_ids)
        return rank(
            candidates,
            preferences,
            context,
            collaborative,
            cold_start=cold_start,
            request_hour=request_hour,
        )[:limit]
