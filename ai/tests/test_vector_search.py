from ai.vector_search import VectorSearchService


class FakeEncoder:
    def encode_one(self, text: str) -> list[float]:
        assert text == "genius strategist anime"
        return [0.25] * 384


class FakeResponse:
    data = [{"content_id": 7, "title": "Code Geass", "similarity": 0.91}]


class FakeRPC:
    def execute(self) -> FakeResponse:
        return FakeResponse()


class FakeClient:
    def __init__(self) -> None:
        self.params = None

    def rpc(self, name: str, params: dict) -> FakeRPC:
        assert name == "match_content_embeddings"
        self.params = params
        return FakeRPC()


def test_vector_search_embeds_query_and_calls_pgvector_rpc() -> None:
    client = FakeClient()
    service = VectorSearchService(client=client, encoder=FakeEncoder())

    results = service.search_similar_content("genius strategist anime", limit=3)

    assert results[0]["title"] == "Code Geass"
    assert client.params["match_count"] == 3
    assert len(client.params["query_embedding"]) == 384
