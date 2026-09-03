"""Resumable content and character embedding pipeline."""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Iterable, Protocol, Sequence

from .config import EMBEDDING_DIMENSIONS, MODEL_NAME
from .database import get_supabase, response_data
from .logging_config import get_logger


logger = get_logger(__name__)


class Encoder(Protocol):
    def encode_many(self, texts: Sequence[str]) -> list[list[float]]: ...


class SentenceTransformerEncoder:
    """Lazy model wrapper so the API can start without loading Torch eagerly."""

    def __init__(self, model_name: str = MODEL_NAME) -> None:
        self.model_name = model_name
        self._model: Any = None

    def _load(self) -> Any:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model %s", self.model_name)
            self._model = SentenceTransformer(self.model_name)
        return self._model

    def encode_many(self, texts: Sequence[str]) -> list[list[float]]:
        vectors = self._load().encode(
            list(texts),
            batch_size=min(64, max(1, len(texts))),
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        result = vectors.tolist()
        if any(len(vector) != EMBEDDING_DIMENSIONS for vector in result):
            raise ValueError(
                f"Model must emit {EMBEDDING_DIMENSIONS}-dimensional vectors"
            )
        return result

    def encode_one(self, text: str) -> list[float]:
        return self.encode_many([text])[0]


def _json_terms(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return [value]
    if isinstance(value, dict):
        return [str(item) for item in value.values() if item]
    if isinstance(value, list):
        terms: list[str] = []
        for item in value:
            if isinstance(item, dict):
                terms.extend(str(v) for v in item.values() if v)
            elif item:
                terms.append(str(item))
        return terms
    return [str(value)]


def build_search_document(
    content: dict[str, Any], characters: Iterable[dict[str, Any]] = ()
) -> str:
    """Build deterministic text from catalog and normalized character data."""
    parts = [content.get("title"), content.get("overview")]
    for field in ("genres", "themes", "moods", "keywords"):
        parts.extend(_json_terms(content.get(field)))
    for character in characters:
        parts.extend((character.get("name"), character.get("description")))
    return " ".join(" ".join(str(part).split()) for part in parts if part).strip()


def document_hash(document: str) -> str:
    return hashlib.sha256(document.encode("utf-8")).hexdigest()


@dataclass
class PipelineResult:
    discovered: int = 0
    embedded: int = 0
    skipped: int = 0
    failed: int = 0


class EmbeddingPipeline:
    def __init__(self, client: Any = None, encoder: Encoder | None = None) -> None:
        self.client = client or get_supabase()
        self.encoder = encoder or SentenceTransformerEncoder()

    def _load_contents(self, page_size: int = 500) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        start = 0
        columns = "id,title,overview,genres,themes,moods,keywords"
        while True:
            page = response_data(
                self.client.table("contents")
                .select(columns)
                .eq("is_active", True)
                .order("id")
                .range(start, start + page_size - 1)
                .execute()
            )
            records.extend(page)
            if len(page) < page_size:
                return records
            start += page_size

    def _load_characters(self) -> dict[int, list[dict[str, Any]]]:
        rows = response_data(
            self.client.table("content_characters")
            .select("content_id,characters(name,description)")
            .execute()
        )
        grouped: dict[int, list[dict[str, Any]]] = {}
        for row in rows:
            character = row.get("characters") or {}
            grouped.setdefault(int(row["content_id"]), []).append(character)
        return grouped

    def _existing_hashes(self) -> dict[int, str]:
        rows = response_data(
            self.client.table("content_embeddings")
            .select("content_id,document_hash")
            .eq("model", MODEL_NAME)
            .execute()
        )
        return {int(row["content_id"]): row["document_hash"] for row in rows}

    def run(self, batch_size: int = 32, limit: int | None = None) -> PipelineResult:
        result = PipelineResult()
        contents = self._load_contents()
        if limit is not None:
            contents = contents[: max(0, limit)]
        result.discovered = len(contents)
        characters = self._load_characters()
        existing = self._existing_hashes()

        pending: list[tuple[dict[str, Any], str, str]] = []
        for content in contents:
            document = build_search_document(
                content, characters.get(int(content["id"]), [])
            )
            if not document:
                logger.warning("Skipping content_id=%s: empty document", content["id"])
                result.failed += 1
                continue
            digest = document_hash(document)
            if existing.get(int(content["id"])) == digest:
                result.skipped += 1
                continue
            pending.append((content, document, digest))

        for start in range(0, len(pending), max(1, batch_size)):
            batch = pending[start : start + max(1, batch_size)]
            try:
                vectors = self.encoder.encode_many([item[1] for item in batch])
                payload = [
                    {
                        "content_id": item[0]["id"],
                        "embedding": vector,
                        "model": MODEL_NAME,
                        "search_document": item[1],
                        "document_hash": item[2],
                    }
                    for item, vector in zip(batch, vectors, strict=True)
                ]
                self.client.table("content_embeddings").upsert(
                    payload, on_conflict="content_id,model"
                ).execute()
                result.embedded += len(payload)
                logger.info("Embedded batch %s-%s", start + 1, start + len(batch))
            except Exception:
                result.failed += len(batch)
                logger.exception("Embedding batch failed at offset %s", start)

        logger.info("Embedding pipeline complete: %s", result)
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate NexaPlay content embeddings")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    result = EmbeddingPipeline().run(batch_size=args.batch_size, limit=args.limit)
    print(json.dumps(result.__dict__, indent=2))
    if result.failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
