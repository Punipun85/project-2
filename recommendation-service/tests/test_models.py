from app.collaborative import build_affinity, collaborative_scores
from app.content_based import ContentPreferences
from app.context import UserContext
from app.ranking import rank


def candidate(
    content_id: int,
    title: str,
    genres: list[str],
    *,
    similarity: float = 0.5,
    rating: float = 8.0,
    votes: int = 1000,
    popularity: float = 50,
    content_type: str = "anime",
) -> dict:
    return {
        "id": content_id,
        "content_id": content_id,
        "title": title,
        "genres": genres,
        "themes": [],
        "moods": [],
        "keywords": [],
        "characters": [],
        "content_type": content_type,
        "similarity": similarity,
        "rating_average": rating,
        "rating_count": votes,
        "popularity_score": popularity,
    }


def test_new_user_receives_popular_cold_start_order() -> None:
    rows = [
        candidate(1, "Quiet Title", ["Drama"], rating=6.0, votes=10, popularity=5),
        candidate(2, "Trending Title", ["Action"], rating=9.2, votes=50000, popularity=500),
    ]
    ranked = rank(rows, ContentPreferences(), UserContext(), {}, cold_start=True)

    assert ranked[0]["title"] == "Trending Title"
    assert ranked[0]["strategy"] == "cold_start_trending"


def test_fantasy_anime_preference_increases_matching_content() -> None:
    rows = [
        candidate(1, "Fantasy Journey", ["Fantasy", "Adventure"]),
        candidate(2, "Crime Story", ["Crime", "Thriller"]),
    ]
    preferences = ContentPreferences(genres={"fantasy"}, content_types={"anime"})
    context = UserContext(favorite_genres={"fantasy"}, favorite_types={"anime"})
    ranked = rank(rows, preferences, context, {}, cold_start=False)

    assert ranked[0]["title"] == "Fantasy Journey"
    assert ranked[0]["content_score"] > ranked[1]["content_score"]


def test_similar_user_adds_unseen_collaborative_candidate() -> None:
    target = {10: 1.0, 11: 0.8}
    peers = [
        {"user_id": "peer-a", "content_id": 10, "interaction_type": "like"},
        {"user_id": "peer-a", "content_id": 11, "interaction_type": "complete"},
        {"user_id": "peer-a", "content_id": 99, "interaction_type": "like"},
    ]

    scores = collaborative_scores(target, peers, {98, 99})

    assert scores[99] == 1.0
    assert 98 not in scores


def test_recent_viewing_pattern_changes_context_ranking() -> None:
    rows = [
        candidate(1, "Space Film", ["Science Fiction"], content_type="movie"),
        candidate(2, "Fantasy Anime", ["Fantasy"], content_type="anime"),
    ]
    preferences = ContentPreferences()
    fantasy_context = UserContext(recent_genres={"fantasy"})
    scifi_context = UserContext(recent_genres={"science fiction"})

    fantasy_ranked = rank(rows, preferences, fantasy_context, {}, cold_start=False)
    scifi_ranked = rank(rows, preferences, scifi_context, {}, cold_start=False)

    assert fantasy_ranked[0]["title"] == "Fantasy Anime"
    assert scifi_ranked[0]["title"] == "Space Film"


def test_final_score_uses_exact_batch_two_weights() -> None:
    row = candidate(7, "Weighted", ["Fantasy"], similarity=0.8)
    result = rank(
        [row],
        ContentPreferences(genres={"fantasy"}, content_types={"anime"}),
        UserContext(recent_genres={"fantasy"}),
        {7: 0.6},
        cold_start=False,
    )[0]
    expected = (
        result["content_score"] * 0.5
        + result["collaborative_score"] * 0.3
        + result["context_score"] * 0.2
    )
    assert abs(result["final_score"] - expected) < 0.000002


def test_not_interested_creates_a_negative_affinity_signal() -> None:
    affinity = build_affinity([
        {"content_id": 42, "interaction_type": "not_interested"},
        {"content_id": 7, "interaction_type": "like"},
    ])
    assert affinity[42] < 0
    assert affinity[7] > 0
