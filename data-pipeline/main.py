"""Run the NexaPlay AI Batch 1 entertainment metadata pipeline."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from pydantic import ValidationError

from config.settings import PIPELINE_ROOT, Settings, get_settings
from database.supabase_client import get_supabase_client
from database.uploader import SupabaseUploader
from processors.normalizer import (
    ContentRecord,
    normalize_mal_anime,
    normalize_tmdb_movie,
    normalize_tmdb_series,
)
from sources.mal_anime import MalAnimeClient, get_seasonal_anime, get_top_anime
from sources.tmdb_movie import (
    create_client as create_tmdb_movie_client,
    get_movie_detail,
    get_popular_movies,
    get_top_rated_movies,
)
from sources.tmdb_series import (
    create_client as create_tmdb_series_client,
    get_popular_series,
    get_series_detail,
    get_top_rated_series,
)


LOGGER = logging.getLogger("nexaplay.pipeline")
REPORT_FILE = PIPELINE_ROOT / "logs" / "import_report.json"


@dataclass
class ImportResult:
    label: str
    imported: int = 0
    normalized: int = 0
    failed: int = 0
    provider_error: str | None = None


def configure_logging(settings: Settings) -> Path:
    log_dir = PIPELINE_ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "pipeline.log"
    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )
    return log_file


def import_tmdb_movies(
    settings: Settings,
    *,
    pages: int,
    uploader: SupabaseUploader | None,
) -> ImportResult:
    result = ImportResult("Movies")
    try:
        settings.require_tmdb()
        client = create_tmdb_movie_client(settings)
        raw = _collect_lists(
            pages,
            (
                ("popular", lambda page: get_popular_movies(page, settings=settings, client=client)),
                ("top_rated", lambda page: get_top_rated_movies(page, settings=settings, client=client)),
            ),
            result,
        )
        records = _normalize_details(
            raw,
            lambda content_id: get_movie_detail(content_id, settings=settings, client=client),
            lambda item: normalize_tmdb_movie(item, cast_limit=settings.cast_limit),
            result,
        )
        result.normalized = len(records)
        result.imported = uploader.upload_batch(records) if uploader else len(records)
        if uploader:
            result.failed += uploader.failed_count
    except Exception as error:
        result.provider_error = str(error)
        LOGGER.exception("TMDB Movie gagal; pipeline melanjutkan provider berikutnya")
    return result


def import_tmdb_series(
    settings: Settings,
    *,
    pages: int,
    uploader: SupabaseUploader | None,
) -> ImportResult:
    result = ImportResult("Series")
    try:
        settings.require_tmdb()
        client = create_tmdb_series_client(settings)
        raw = _collect_lists(
            pages,
            (
                ("popular", lambda page: get_popular_series(page, settings=settings, client=client)),
                ("top_rated", lambda page: get_top_rated_series(page, settings=settings, client=client)),
            ),
            result,
        )
        records = _normalize_details(
            raw,
            lambda content_id: get_series_detail(content_id, settings=settings, client=client),
            lambda item: normalize_tmdb_series(item, cast_limit=settings.cast_limit),
            result,
        )
        result.normalized = len(records)
        result.imported = uploader.upload_batch(records) if uploader else len(records)
        if uploader:
            result.failed += uploader.failed_count
    except Exception as error:
        result.provider_error = str(error)
        LOGGER.exception("TMDB Series gagal; pipeline melanjutkan provider berikutnya")
    return result


def import_mal_anime(
    settings: Settings,
    *,
    pages: int,
    uploader: SupabaseUploader | None,
) -> ImportResult:
    result = ImportResult("Anime")
    try:
        settings.require_mal()
        client = MalAnimeClient(settings)
        raw = _collect_lists(
            pages,
            (
                ("top", lambda page: get_top_anime(page, client=client)),
                ("seasonal", lambda page: get_seasonal_anime(page=page, client=client)),
            ),
            result,
        )
        # Ranking and seasonal calls already request MAL_DETAIL_FIELDS, so they
        # can be normalized directly without one extra API call per anime.
        records = _normalize_records(raw, normalize_mal_anime, result)
        result.normalized = len(records)
        result.imported = uploader.upload_batch(records) if uploader else len(records)
        if uploader:
            result.failed += uploader.failed_count
    except Exception as error:
        result.provider_error = str(error)
        LOGGER.exception("MyAnimeList gagal; pipeline provider lain tetap dipertahankan")
    return result


def _collect_lists(
    pages: int,
    loaders: tuple[tuple[str, Callable[[int], list[dict[str, Any]]]], ...],
    result: ImportResult,
) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for list_name, loader in loaders:
        for page in range(1, pages + 1):
            try:
                for item in loader(page):
                    if item.get("id") is not None:
                        records[str(item["id"])] = item
            except (requests.RequestException, RuntimeError, ValueError) as error:
                result.failed += 1
                LOGGER.error("Gagal mengambil list %s halaman %s: %s", list_name, page, error)
    return records


def _normalize_details(
    summaries: dict[str, dict[str, Any]],
    detail_loader: Callable[[str], dict[str, Any]],
    normalizer: Callable[[dict[str, Any]], ContentRecord],
    result: ImportResult,
) -> list[ContentRecord]:
    normalized: list[ContentRecord] = []
    for content_id, summary in summaries.items():
        try:
            try:
                raw = detail_loader(content_id)
            except requests.RequestException as error:
                LOGGER.warning("Detail %s gagal, memakai data list: %s", content_id, error)
                raw = summary
            normalized.append(normalizer(raw))
        except (ValidationError, ValueError, TypeError) as error:
            result.failed += 1
            LOGGER.error("Record %s tidak valid dan dilewati: %s", content_id, error)
        except Exception as error:
            result.failed += 1
            LOGGER.error("Record %s gagal diproses dan dilewati: %s", content_id, error)
    return normalized


def _normalize_records(
    raw_records: dict[str, dict[str, Any]],
    normalizer: Callable[[dict[str, Any]], ContentRecord],
    result: ImportResult,
) -> list[ContentRecord]:
    normalized: list[ContentRecord] = []
    for content_id, raw in raw_records.items():
        try:
            normalized.append(normalizer(raw))
        except (ValidationError, ValueError, TypeError) as error:
            result.failed += 1
            LOGGER.error("Record %s tidak valid dan dilewati: %s", content_id, error)
        except Exception as error:
            result.failed += 1
            LOGGER.error("Record %s gagal diproses dan dilewati: %s", content_id, error)
    return normalized


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages", type=int, help="Override jumlah halaman untuk semua provider")
    parser.add_argument("--movie-pages", type=int, help="Override MOVIE_PAGES")
    parser.add_argument("--series-pages", type=int, help="Override SERIES_PAGES")
    parser.add_argument("--anime-pages", type=int, help="Override ANIME_PAGES")
    parser.add_argument(
        "--source",
        action="append",
        choices=("tmdb-movies", "tmdb-series", "mal-anime"),
        help="Batasi provider; opsi boleh diulang",
    )
    parser.add_argument("--dry-run", action="store_true", help="Ambil dan validasi tanpa upload")
    return parser.parse_args()


def build_import_report(
    results: list[ImportResult],
    *,
    additional_failures: int = 0,
) -> dict[str, int]:
    counts = {result.label: result.imported for result in results}
    failed = additional_failures + sum(
        result.failed + (1 if result.provider_error else 0) for result in results
    )
    total = sum(counts.values())
    return {
        "tmdb_movies": counts.get("Movies", 0),
        "tmdb_series": counts.get("Series", 0),
        "mal_anime": counts.get("Anime", 0),
        "failed": failed,
        "total_imported": total,
    }


def save_import_report(
    results: list[ImportResult],
    *,
    path: Path = REPORT_FILE,
    additional_failures: int = 0,
) -> dict[str, int]:
    report = build_import_report(results, additional_failures=additional_failures)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("Import report disimpan ke %s", path)
    return report


def print_import_report(report: dict[str, int]) -> None:
    print("\n============================")
    print("NEXAPLAY AI BATCH 1 REPORT")
    print(f"\nTMDB MOVIES:\n{report['tmdb_movies']}")
    print(f"\nTMDB SERIES:\n{report['tmdb_series']}")
    print(f"\nMAL ANIME:\n{report['mal_anime']}")
    print(f"\nFAILED:\n{report['failed']}")
    print(f"\nTOTAL IMPORTED:\n{report['total_imported']}")
    print("\n============================")


def main() -> int:
    started_at = time.monotonic()
    args = parse_args()
    settings = get_settings()
    configure_logging(settings)
    movie_pages = max(1, args.movie_pages or args.pages or settings.movie_pages)
    series_pages = max(1, args.series_pages or args.pages or settings.series_pages)
    anime_pages = max(1, args.anime_pages or args.pages or settings.anime_pages)
    selected = set(args.source or ("tmdb-movies", "tmdb-series", "mal-anime"))
    print("Pipeline Batch 1 started")
    LOGGER.info(
        "Pipeline Batch 1 dimulai: movie_pages=%s series_pages=%s anime_pages=%s",
        movie_pages,
        series_pages,
        anime_pages,
    )

    try:
        uploader = None
        if not args.dry_run:
            client = get_supabase_client(settings)
            uploader = SupabaseUploader(
                client,
                retries=settings.request_retries,
                batch_size=settings.import_batch_size,
            )
    except Exception as error:
        LOGGER.exception("Inisialisasi Supabase gagal")
        print(f"Pipeline dihentikan: {error}", file=sys.stderr)
        report = save_import_report([], additional_failures=1)
        print_import_report(report)
        return 1

    results: list[ImportResult] = []
    if "tmdb-movies" in selected:
        print("Importing TMDB movies...")
        results.append(import_tmdb_movies(settings, pages=movie_pages, uploader=uploader))
    if "tmdb-series" in selected:
        print("Importing TMDB series...")
        results.append(import_tmdb_series(settings, pages=series_pages, uploader=uploader))
    if "mal-anime" in selected:
        print("Importing MyAnimeList anime...")
        results.append(import_mal_anime(settings, pages=anime_pages, uploader=uploader))

    report = save_import_report(results)
    total = report["total_imported"]
    elapsed = time.monotonic() - started_at
    for result in results:
        LOGGER.info(
            "%s selesai: imported=%s normalized=%s failed=%s provider_error=%s",
            result.label,
            result.imported,
            result.normalized,
            result.failed,
            result.provider_error or "none",
        )
    LOGGER.info("Pipeline selesai: total=%s durasi=%.2fs", total, elapsed)

    print_import_report(report)
    print(f"Execution time: {elapsed:.2f}s")
    if args.dry_run:
        print("Mode: dry run (tidak ada data yang ditulis)")
    return 0 if total > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
