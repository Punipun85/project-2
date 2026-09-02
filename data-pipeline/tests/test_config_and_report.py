from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from config.settings import Settings
from main import ImportResult, build_import_report, save_import_report
from sources.mal_anime import get_access_token


class ConfigurationAndReportTests(unittest.TestCase):
    def test_provider_page_and_batch_environment_variables(self) -> None:
        with patch.dict(
            os.environ,
            {
                "BATCH_SIZE": "75",
                "MOVIE_PAGES": "50",
                "SERIES_PAGES": "40",
                "ANIME_PAGES": "10",
            },
        ):
            settings = Settings.from_environment()

        self.assertEqual(settings.import_batch_size, 75)
        self.assertEqual(settings.movie_pages, 50)
        self.assertEqual(settings.series_pages, 40)
        self.assertEqual(settings.anime_pages, 10)

    def test_get_access_token_uses_configured_token_without_network(self) -> None:
        settings = Settings(mal_client_id="client-id", mal_access_token="access-token")
        self.assertEqual(get_access_token(settings), "access-token")

    def test_import_report_counts_provider_errors_and_failed_records(self) -> None:
        results = [
            ImportResult("Movies", imported=100, failed=2),
            ImportResult("Series", imported=80),
            ImportResult("Anime", provider_error="provider unavailable"),
        ]

        report = build_import_report(results)

        self.assertEqual(
            report,
            {
                "tmdb_movies": 100,
                "tmdb_series": 80,
                "mal_anime": 0,
                "failed": 3,
                "total_imported": 180,
            },
        )

    def test_import_report_is_saved_as_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "import_report.json"
            expected = save_import_report(
                [ImportResult("Anime", imported=25)],
                path=report_path,
            )
            saved = json.loads(report_path.read_text(encoding="utf-8"))

        self.assertEqual(saved, expected)


if __name__ == "__main__":
    unittest.main()
