"""Import TMDB movies/TV and Jikan anime into Supabase contents."""

import argparse
import json
import os
import sys
from collections.abc import Iterable
from pathlib import Path

import requests
from dotenv import load_dotenv

from jikan_anime import get_anime, normalize as normalize_anime
from models import NormalizedContent
from supabase_client import upsert_contents
from tmdb_movie import get_movies, normalize as normalize_movie
from tmdb_tv import get_tv, normalize as normalize_tv


ENV_FILE = Path(__file__).with_name(".env")
load_dotenv(ENV_FILE)


def collect_contents(
    *,
    pages: int,
    sources: set[str],
    strict: bool = False,
) -> tuple[list[NormalizedContent], dict[str, str]]:
    records: dict[tuple[str, str], NormalizedContent] = {}
    failures: dict[str, str] = {}

    if "tmdb-movies" in sources:
        _collect_source(
            "tmdb-movies",
            records,
            failures,
            lambda: (
                normalize_movie(item)
                for list_type in ("popular", "top_rated")
                for item in get_movies(pages=pages, list_type=list_type)
            ),
            strict=strict,
        )

    if "tmdb-tv" in sources:
        _collect_source(
            "tmdb-tv",
            records,
            failures,
            lambda: (
                normalize_tv(item)
                for list_type in ("popular", "top_rated")
                for item in get_tv(pages=pages, list_type=list_type)
            ),
            strict=strict,
        )

    if "jikan-anime" in sources:
        _collect_source(
            "jikan-anime",
            records,
            failures,
            lambda: (normalize_anime(item) for item in get_anime(pages=pages)),
            strict=strict,
        )

    return list(records.values()), failures


def _collect_source(
    name: str,
    target: dict[tuple[str, str], NormalizedContent],
    failures: dict[str, str],
    loader,
    *,
    strict: bool,
) -> None:
    try:
        _merge(target, loader())
    except (requests.RequestException, RuntimeError) as error:
        if strict:
            raise
        failures[name] = str(error)


def _merge(
    target: dict[tuple[str, str], NormalizedContent],
    values: Iterable[NormalizedContent],
) -> None:
    for content in values:
        target[(content.source, content.external_id)] = content


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pages",
        type=int,
        default=int(os.getenv("IMPORT_PAGES", "1")),
        help="Number of pages per external endpoint (default: 1)",
    )
    parser.add_argument(
        "--source",
        action="append",
        choices=("tmdb-movies", "tmdb-tv", "jikan-anime"),
        dest="sources",
        help="Import only selected sources; repeat the option to select multiple",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.getenv("IMPORT_BATCH_SIZE", "100")),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and normalize records without writing to Supabase",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Stop immediately if one provider fails instead of importing healthy providers",
    )
    parser.add_argument(
        "--output",
        help="Optional NDJSON output path for auditing normalized records",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pages = max(1, args.pages)
    sources = set(args.sources or ("tmdb-movies", "tmdb-tv", "jikan-anime"))
    records, failures = collect_contents(pages=pages, sources=sources, strict=args.strict)

    for source, message in failures.items():
        print(f"Provider failed [{source}]: {message}", file=sys.stderr)

    if not records:
        raise SystemExit("Import stopped: no provider returned usable content")

    if args.output:
        output_path = Path(args.output)
        with output_path.open("w", encoding="utf-8") as output:
            for record in records:
                output.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")

    if args.dry_run:
        print(f"Dry run completed: {len(records)} normalized contents")
        return

    imported = upsert_contents(
        [record.to_dict() for record in records],
        batch_size=max(1, args.batch_size),
    )
    print(f"Import completed: {imported} contents upserted")


if __name__ == "__main__":
    main()
