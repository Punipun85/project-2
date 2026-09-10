"""Single-instance sentence-transformer model wrapper."""

from __future__ import annotations

import logging
from threading import Lock
from typing import Any


logger = logging.getLogger(__name__)


class EmbeddingService:
    def __init__(self, model_name: str, expected_dimension: int = 384) -> None:
        self.model_name = model_name
        self.expected_dimension = expected_dimension
        self._model: Any | None = None
        self._load_error: str | None = None
        self._encode_lock = Lock()

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def load(self) -> None:
        """Load the model once during the FastAPI lifespan startup phase."""
        if self._model is not None:
            return
        try:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model %s", self.model_name)
            self._model = SentenceTransformer(self.model_name)
            probe = self._model.encode(
                ["NexaPlay startup health check"],
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            dimension = int(probe.shape[1])
            if dimension != self.expected_dimension:
                raise RuntimeError(
                    f"Model dimension {dimension} does not match expected {self.expected_dimension}"
                )
            self._load_error = None
            logger.info("Embedding model loaded dimension=%s", dimension)
        except Exception as exc:
            self._model = None
            self._load_error = f"{type(exc).__name__}: {exc}"
            logger.exception("Embedding model failed to load")

    def encode(self, text: str) -> list[float]:
        if self._model is None:
            raise RuntimeError(self._load_error or "Embedding model is not loaded")
        # SentenceTransformer inference is synchronous and model instances are
        # safest behind a short critical section when several requests arrive.
        with self._encode_lock:
            vectors = self._model.encode(
                [text],
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        vector = vectors[0].tolist()
        if len(vector) != self.expected_dimension:
            raise RuntimeError(
                f"Model returned {len(vector)} values; expected {self.expected_dimension}"
            )
        return [float(value) for value in vector]
