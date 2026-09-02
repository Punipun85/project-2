from __future__ import annotations

import unittest

from processors.normalizer import normalize_mal_anime, normalize_tmdb_movie, normalize_tmdb_series


class NormalizerTests(unittest.TestCase):
    def test_tmdb_movie_normalization(self) -> None:
        record = normalize_tmdb_movie(
            {
                "id": 157336,
                "title": "Interstellar",
                "original_title": "Interstellar",
                "overview": "Explorers travel through a wormhole.",
                "poster_path": "/poster.jpg",
                "backdrop_path": "/backdrop.jpg",
                "genres": [{"id": 878, "name": "Science Fiction"}],
                "original_language": "en",
                "production_countries": [{"iso_3166_1": "US", "name": "United States"}],
                "production_companies": [{"id": 923, "name": "Legendary Pictures"}],
                "release_date": "2014-11-05",
                "runtime": 169,
                "vote_average": 8.7,
                "vote_count": 2300000,
                "popularity": 98.4,
                "credits": {
                    "crew": [{"name": "Christopher Nolan", "job": "Director"}],
                    "cast": [{"name": "Matthew McConaughey", "character": "Cooper"}],
                },
            }
        )

        data = record.to_supabase()
        self.assertEqual(data["source"], "TMDB")
        self.assertEqual(data["content_type"], "movie")
        self.assertEqual(data["release_year"], 2014)
        self.assertEqual(data["duration_minutes"], 169)
        self.assertEqual(data["director"][0]["name"], "Christopher Nolan")
        self.assertEqual(data["cast"][0]["character"], "Cooper")

    def test_tmdb_series_normalization_and_kdrama_detection(self) -> None:
        record = normalize_tmdb_series(
            {
                "id": 126485,
                "name": "Moving",
                "original_name": "무빙",
                "overview": "A family superhero drama.",
                "genres": [{"id": 18, "name": "Drama"}],
                "origin_country": ["KR"],
                "production_countries": [{"iso_3166_1": "KR", "name": "South Korea"}],
                "original_language": "ko",
                "first_air_date": "2023-08-09",
                "number_of_seasons": 1,
                "number_of_episodes": 20,
                "episode_run_time": [50],
                "networks": [{"id": 2739, "name": "Disney+"}],
                "created_by": [{"id": 1, "name": "Kang Full"}],
                "production_companies": [{"id": 2, "name": "Studio&NEW"}],
                "vote_average": 8.5,
                "vote_count": 45000,
                "popularity": 92.3,
                "aggregate_credits": {
                    "cast": [
                        {
                            "name": "Han Hyo-joo",
                            "roles": [{"character": "Lee Mi-hyun", "episode_count": 20}],
                        }
                    ],
                    "crew": [
                        {"name": "Park In-je", "jobs": [{"job": "Director", "episode_count": 20}]}
                    ],
                },
            }
        )

        self.assertEqual(record.content_type, "series")
        self.assertEqual(record.series_type, "kdrama")
        self.assertEqual(record.country, ["South Korea", "KR"])
        self.assertEqual(record.platform, "Disney+")
        self.assertEqual(record.number_of_episodes, 20)
        self.assertEqual(record.creator[0]["role"], "Creator")

    def test_mal_anime_normalization(self) -> None:
        record = normalize_mal_anime(
            {
                "id": 16498,
                "title": "Shingeki no Kyojin",
                "alternative_titles": {
                    "en": "Attack on Titan",
                    "ja": "進撃の巨人",
                    "synonyms": ["AoT"],
                },
                "synopsis": "Humanity fights for survival.",
                "main_picture": {"large": "https://example.com/aot.jpg"},
                "genres": [{"id": 1, "name": "Action"}, {"id": 10, "name": "Fantasy"}],
                "studios": [{"id": 858, "name": "Wit Studio"}],
                "num_episodes": 25,
                "average_episode_duration": 1440,
                "start_date": "2020-12-07",
                "start_season": {"year": 2021, "season": "winter"},
                "media_type": "tv",
                "mean": 8.6,
                "num_scoring_users": 3900000,
                "num_list_users": 4000000,
                "popularity": 1,
            }
        )

        self.assertEqual(record.source, "MAL")
        self.assertEqual(record.content_type, "anime")
        self.assertEqual(record.series_type, "anime_series")
        self.assertEqual(record.title, "Attack on Titan")
        self.assertEqual(record.duration_minutes, 24)
        self.assertEqual(record.release_year, 2020)
        self.assertEqual(record.rating_average, 8.6)
        self.assertEqual(record.characters, [])

    def test_mal_short_duration_is_rounded_to_one_minute(self) -> None:
        record = normalize_mal_anime(
            {
                "id": 48442,
                "title": "Shikaru Neko",
                "media_type": "tv",
                "average_episode_duration": 30,
            }
        )

        self.assertEqual(record.duration_minutes, 1)


if __name__ == "__main__":
    unittest.main()
