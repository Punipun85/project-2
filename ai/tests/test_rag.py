import asyncio

from ai.rag import RAGService, build_context


RECORDS = [
    {
        "content_id": 42,
        "title": "Death Note",
        "content_type": "anime",
        "overview": "A brilliant student finds a supernatural notebook.",
        "genres": ["Mystery", "Thriller"],
        "themes": ["justice", "strategy"],
        "characters": [{"name": "Light Yagami"}],
        "similarity": 0.93,
    }
]


class FakeSearch:
    def search_similar_content(self, question: str, limit: int):
        assert question == "anime with a genius strategist"
        assert limit == 5
        return RECORDS


class FakeResponse:
    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return {"message": {"content": "Death Note cocok karena strategi Light."}}


class FakeHTTPClient:
    def __init__(self) -> None:
        self.payload = None

    async def post(self, url: str, json: dict) -> FakeResponse:
        self.payload = json
        return FakeResponse()


def test_rag_context_is_grounded_in_retrieved_metadata() -> None:
    context = build_context(RECORDS)
    assert "Death Note" in context
    assert "Light Yagami" in context
    assert "justice" in context


def test_rag_sends_retrieved_context_to_ollama() -> None:
    http = FakeHTTPClient()
    service = RAGService(search=FakeSearch(), client=http)

    result = asyncio.run(service.answer("anime with a genius strategist"))

    assert result["sources"][0]["content_id"] == 42
    assert "Death Note" in http.payload["messages"][1]["content"]
    assert "Death Note" in result["answer"]
