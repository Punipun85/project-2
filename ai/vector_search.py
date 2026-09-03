"""Semantic retrieval backed by the Batch 3 pgvector RPC."""

from __future__ import annotations

from typing import Any, Protocol

from .config import MODEL_NAME
from .database import get_supabase, response_data
from .embedding import SentenceTransformerEncoder


class SingleEncoder(Protocol):
    def encode_one(self, text: str) -> list[float]: ...


class VectorSearchService:
    def __init__(self, client: Any = None, encoder: SingleEncoder | None = None) -> None:
        self.client = client or get_supabase()
        self.encoder = encoder or SentenceTransformerEncoder()

    def search_by_vector(
        self,
        vector: list[float],
        limit: int = 10,
        content_type: str | None = None,
        min_similarity: float = 0.0,
    ) -> list[dict[str, Any]]:
        params = {
            "query_embedding": vector,
            "match_count": min(max(limit, 1), 100),
            "match_model": MODEL_NAME,
            "filter_content_type": content_type,
            "min_similarity": min(max(min_similarity, -1.0), 1.0),
        }
        return response_data(
            self.client.rpc("match_content_embeddings", params).execute()
        )

    def search_similar_content(
        self,
        query: str,
        limit: int = 10,
        content_type: str | None = None,
        min_similarity: float = 0.0,
    ) -> list[dict[str, Any]]:
        query = " ".join(query.split())
        if not query:
            raise ValueError("query must not be blank")
        return self.search_by_vector(
            self.encoder.encode_one(query), limit, content_type, min_similarity
        )


def search_similar_content(query: str, limit: int = 10) -> list[dict[str, Any]]:
    return VectorSearchService().search_similar_content(query, limit)
