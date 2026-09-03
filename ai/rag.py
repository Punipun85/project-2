"""Grounded retrieval-augmented assistant using local Ollama."""

from __future__ import annotations

from typing import Any

import httpx

from .config import OLLAMA_CHAT_URL, OLLAMA_MODEL
from .logging_config import get_logger
from .vector_search import VectorSearchService


logger = get_logger(__name__)


def _labels(value: Any, key: str = "name") -> str:
    if not isinstance(value, list):
        return ""
    labels = [item.get(key) if isinstance(item, dict) else item for item in value]
    return ", ".join(str(label) for label in labels if label)


def build_context(contents: list[dict[str, Any]]) -> str:
    blocks = []
    for index, item in enumerate(contents, start=1):
        blocks.append(
            "\n".join(
                (
                    f"[{index}] {item.get('title', 'Untitled')}",
                    f"Type: {item.get('content_type', 'unknown')}",
                    f"Overview: {item.get('overview') or 'Not available'}",
                    f"Genres: {_labels(item.get('genres')) or 'Not available'}",
                    f"Themes: {_labels(item.get('themes')) or 'Not available'}",
                    f"Characters: {_labels(item.get('characters')) or 'Not available'}",
                )
            )
        )
    return "\n\n".join(blocks)


class RAGService:
    def __init__(
        self,
        search: VectorSearchService | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.search = search or VectorSearchService()
        self.client = client

    def retrieve(self, question: str, limit: int = 5) -> list[dict[str, Any]]:
        return self.search.search_similar_content(question, limit)

    async def answer(self, question: str, limit: int = 5) -> dict[str, Any]:
        records = self.retrieve(question, limit)
        context = build_context(records)
        system = (
            "You are NexaPlay AI, an entertainment recommendation assistant. "
            "Answer only from the supplied catalog context. Clearly say when the "
            "context is insufficient. Give concise reasons and never invent titles."
        )
        prompt = f"CATALOG CONTEXT:\n{context}\n\nUSER QUESTION:\n{question}"
        payload = {
            "model": OLLAMA_MODEL,
            "stream": False,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }
        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(timeout=60)
        try:
            response = await client.post(OLLAMA_CHAT_URL, json=payload)
            response.raise_for_status()
            data = response.json()
            answer = (data.get("message") or {}).get("content", "").strip()
            if not answer:
                raise RuntimeError("Ollama returned an empty answer")
        except Exception as exc:
            logger.warning("Ollama unavailable; returning grounded retrieval: %s", exc)
            titles = ", ".join(item.get("title", "Untitled") for item in records)
            answer = (
                f"Model AI lokal sedang tidak tersedia. Hasil katalog paling relevan: {titles}."
                if titles
                else "Model AI lokal sedang tidak tersedia dan belum ada konteks yang relevan."
            )
        finally:
            if owns_client:
                await client.aclose()
        return {
            "answer": answer,
            "sources": [
                {
                    "content_id": item.get("content_id"),
                    "title": item.get("title"),
                    "similarity": item.get("similarity"),
                }
                for item in records
            ],
        }
