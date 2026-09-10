import os

os.environ.setdefault("SUPABASE_URL", "https://project.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service-role-test")
os.environ.setdefault("RECOMMENDATION_API_KEY", "recommendation-test-key")
os.environ.setdefault("EMBEDDING_API_URL", "https://embedding.example/ai/embed")
os.environ.setdefault("EMBEDDING_API_KEY", "embedding-test-key")

from fastapi.testclient import TestClient

from app.main import app, engine


class FakeEngine:
    def recommend(self, user_id, limit, query, content_type, series_type, request_hour):
        return [
            {
                "content_id": 1,
                "title": "Frieren",
                "content_score": 0.9,
                "collaborative_score": 0.7,
                "context_score": 0.8,
                "final_score": 0.82,
                "reason": "Recommended because you enjoy fantasy stories",
            }
        ][:limit]


app.dependency_overrides[engine] = lambda: FakeEngine()
client = TestClient(app)


def test_recommendations_requires_bearer_key() -> None:
    response = client.post("/recommendations", json={"limit": 20})
    assert response.status_code == 401


def test_recommendations_returns_ranked_contract(monkeypatch) -> None:
    monkeypatch.setattr("app.main.engine", lambda: FakeEngine())
    response = client.post(
        "/recommendations",
        headers={"Authorization": "Bearer recommendation-test-key"},
        json={"user_id": "13dd748e-4df8-4b73-88c7-d5fa705e3b2d", "limit": 20},
    )
    assert response.status_code == 200
    assert response.json()[0]["title"] == "Frieren"
    assert response.json()[0]["final_score"] == 0.82
