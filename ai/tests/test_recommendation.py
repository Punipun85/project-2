from ai.recommendation import rank_candidates


def test_hybrid_ranking_uses_content_behavior_and_popularity() -> None:
    candidates = [
        {
            "content_id": 1,
            "title": "Strong Match",
            "similarity": 0.95,
            "genres": ["Sci-Fi"],
            "characters": [{"name": "Cooper"}],
            "rating_average": 8.5,
            "rating_count": 2000,
            "popularity_score": 80,
        },
        {
            "content_id": 2,
            "title": "Popular But Weak",
            "similarity": 0.20,
            "genres": ["Comedy"],
            "characters": [],
            "rating_average": 9.5,
            "rating_count": 10000,
            "popularity_score": 100,
        },
    ]

    ranked = rank_candidates(
        candidates,
        preferred_genres={"sci-fi"},
        preferred_characters={"cooper"},
        behavior_affinity={1: 0.9, 2: 0.1},
    )

    assert ranked[0]["title"] == "Strong Match"
    first = ranked[0]
    expected = (
        0.5 * first["content_score"]
        + 0.3 * first["behavior_score"]
        + 0.2 * first["popularity_component"]
    )
    assert abs(first["final_score"] - expected) < 0.000002
