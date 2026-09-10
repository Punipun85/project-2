from __future__ import annotations

import os

import numpy as np


os.environ.setdefault("EMBEDDING_API_KEY", "test-embedding-key")
os.environ.setdefault("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.embedding import EmbeddingService  # noqa: E402
from app.main import app  # noqa: E402


class FakeModel:
    def encode(self, texts, **_kwargs):
        return np.asarray([[0.01] * 384 for _ in texts], dtype=np.float32)


def successful_load(service: EmbeddingService) -> None:
    service._model = FakeModel()
    service._load_error = None


def test_health_and_embedding_contract(monkeypatch) -> None:
    monkeypatch.setattr(EmbeddingService, "load", successful_load)
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json() == {"status": "ok", "model_loaded": True}

        response = client.post(
            "/ai/embed",
            headers={"Authorization": "Bearer test-embedding-key"},
            json={"text": "An action anime with an overpowered main character"},
        )
        payload = response.json()
        assert response.status_code == 200
        assert payload["model"] == "sentence-transformers/all-MiniLM-L6-v2"
        assert payload["dimension"] == 384
        assert len(payload["embedding"]) == 384


def test_embedding_requires_valid_bearer_key(monkeypatch) -> None:
    monkeypatch.setattr(EmbeddingService, "load", successful_load)
    with TestClient(app) as client:
        assert client.post("/ai/embed", json={"text": "fantasy"}).status_code == 401
        assert (
            client.post(
                "/ai/embed",
                headers={"Authorization": "Bearer wrong-key"},
                json={"text": "fantasy"},
            ).status_code
            == 401
        )


def test_empty_text_is_rejected(monkeypatch) -> None:
    monkeypatch.setattr(EmbeddingService, "load", successful_load)
    with TestClient(app) as client:
        response = client.post(
            "/ai/embed",
            headers={"Authorization": "Bearer test-embedding-key"},
            json={"text": "   \n  "},
        )
        assert response.status_code == 422


def test_model_loading_failure_reports_degraded_health(monkeypatch) -> None:
    def failed_load(service: EmbeddingService) -> None:
        service._model = None
        service._load_error = "RuntimeError: model unavailable"

    monkeypatch.setattr(EmbeddingService, "load", failed_load)
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 503
        assert health.json()["model_loaded"] is False

        response = client.post(
            "/ai/embed",
            headers={"Authorization": "Bearer test-embedding-key"},
            json={"text": "fantasy"},
        )
        assert response.status_code == 503


def teardown_module() -> None:
    get_settings.cache_clear()
