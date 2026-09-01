import unittest
from unittest.mock import patch

from jikan_anime import normalize as normalize_anime
from supabase_client import upsert_contents
from tmdb_movie import normalize as normalize_movie
from tmdb_tv import normalize as normalize_tv


class NormalizerTests(unittest.TestCase):
    def test_tmdb_movie_matches_contents_schema(self) -> None:
        record = normalize_movie(
            {
                "id": 157336,
                "title": "Interstellar",
                "original_title": "Interstellar",
                "overview": "Explorers travel through a wormhole.",
                "poster_path": "/poster.jpg",
                "backdrop_path": "/backdrop.jpg",
                "genre_ids": [12, 18, 878],
                "original_language": "en",
                "release_date": "2014-11-05",
                "vote_average": 8.7,
                "vote_count": 2300000,
                "popularity": 98.4,
            }
        )
        data = record.to_dict()
        self.assertEqual(data["source"], "TMDB")
        self.assertEqual(data["content_type"], "movie")
        self.assertEqual(data["release_year"], 2014)
        self.assertEqual(data["rating_average"], 8.7)
        self.assertNotIn("type", data)
        self.assertNotIn("rating", data)
        self.assertNotIn("themes", data)

    def test_tmdb_tv_detects_kdrama(self) -> None:
        record = normalize_tv(
            {
                "id": 126485,
                "name": "Moving",
                "original_name": "무빙",
                "overview": "A family superhero drama.",
                "genre_ids": [18, 10759],
                "origin_country": ["KR"],
                "original_language": "ko",
                "first_air_date": "2023-08-09",
                "vote_average": 8.5,
                "vote_count": 45000,
                "popularity": 92.3,
            }
        )
        self.assertEqual(record.content_type, "series")
        self.assertEqual(record.series_type, "kdrama")
        self.assertEqual(record.country, ["KR"])

    def test_jikan_anime_matches_anime_taxonomy(self) -> None:
        record = normalize_anime(
            {
                "mal_id": 16498,
                "title": "Shingeki no Kyojin",
                "title_english": "Attack on Titan",
                "title_japanese": "進撃の巨人",
                "title_synonyms": ["AoT"],
                "synopsis": "Humanity fights for survival.",
                "type": "TV",
                "episodes": 25,
                "duration": "24 min per ep",
                "status": "Finished Airing",
                "aired": {"from": "2013-04-07T00:00:00+00:00", "prop": {"from": {"year": 2013}}},
                "images": {"jpg": {"large_image_url": "https://example.com/aot.jpg"}},
                "trailer": {},
                "genres": [{"name": "Action"}, {"name": "Fantasy"}],
                "explicit_genres": [],
                "themes": [{"name": "Military"}],
                "demographics": [{"name": "Shounen"}],
                "studios": [{"name": "Wit Studio"}],
                "source": "Manga",
                "score": 8.6,
                "scored_by": 3900000,
                "members": 4000000,
            }
        )
        self.assertEqual(record.content_type, "anime")
        self.assertEqual(record.series_type, "anime_series")
        self.assertEqual(record.status, "completed")
        self.assertEqual(record.episode_duration_minutes, 24)
        self.assertEqual(record.mal_rating, 8.6)

    def test_sparse_upserts_are_grouped_without_defaulting_to_null(self) -> None:
        class FakeQuery:
            def execute(self):
                return self

        class FakeTable:
            def __init__(self) -> None:
                self.calls = []

            def upsert(self, rows, **options):
                self.calls.append((rows, options))
                return FakeQuery()

        class FakeClient:
            def __init__(self) -> None:
                self.contents = FakeTable()

            def table(self, name):
                self.assert_table = name
                return self.contents

        client = FakeClient()
        records = [
            {"source": "TMDB", "external_id": "1", "title": "One"},
            {"source": "TMDB", "external_id": "2", "title": "Two", "poster_url": "https://example.com/two.jpg"},
        ]
        with patch("supabase_client.get_supabase_client", return_value=client):
            imported = upsert_contents(records, batch_size=100)

        self.assertEqual(imported, 2)
        self.assertEqual(client.assert_table, "contents")
        self.assertEqual(len(client.contents.calls), 2)
        for _, options in client.contents.calls:
            self.assertEqual(options["on_conflict"], "source,external_id")
            self.assertFalse(options["default_to_null"])


if __name__ == "__main__":
    unittest.main()
