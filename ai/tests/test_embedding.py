from ai.embedding import build_search_document, document_hash


def test_build_search_document_includes_content_and_character_knowledge() -> None:
    content = {
        "title": "Interstellar",
        "overview": "Explorers cross a wormhole.",
        "genres": ["Science Fiction", "Drama"],
        "themes": ["space exploration", "family"],
        "moods": ["emotional"],
        "keywords": [{"name": "time dilation"}],
    }
    characters = [{"name": "Cooper", "description": "A pilot and father."}]

    document = build_search_document(content, characters)

    assert "Interstellar" in document
    assert "space exploration" in document
    assert "time dilation" in document
    assert "Cooper" in document
    assert document_hash(document) == document_hash(document)
    assert len(document_hash(document)) == 64
