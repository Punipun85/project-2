import pytest

from ai.interactions import InteractionService


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self):
        self.payload = None

    def insert(self, payload):
        self.payload = payload
        return self

    def execute(self):
        return FakeResponse([self.payload])


class FakeClient:
    def __init__(self):
        self.query = FakeQuery()

    def table(self, name):
        assert name == "user_interactions"
        return self.query


def test_track_rating_event() -> None:
    service = InteractionService(FakeClient())
    row = service.track(
        "04dbceba-4c12-4e7f-b3a2-b29d06d96b8f", "rating", 12, 4.5
    )
    assert row["rating"] == 4.5


def test_search_requires_query_metadata() -> None:
    service = InteractionService(FakeClient())
    with pytest.raises(ValueError, match="metadata.query"):
        service.track(
            "04dbceba-4c12-4e7f-b3a2-b29d06d96b8f", "search", metadata={}
        )
