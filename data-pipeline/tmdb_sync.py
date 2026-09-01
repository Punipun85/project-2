"""Backward-compatible NDJSON exporter for the TMDB pipeline."""

import argparse
import json

from tmdb_movie import get_movies, normalize as normalize_movie
from tmdb_tv import get_tv, normalize as normalize_tv


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--type", choices=("movie", "series", "kdrama", "documentary"), default="movie")
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--output", default="tmdb_contents.ndjson")
    args = parser.parse_args()

    if args.type in {"series", "kdrama"}:
        records = (normalize_tv(item) for item in get_tv(pages=max(1, args.pages)))
        if args.type == "kdrama":
            records = (record for record in records if record.series_type == "kdrama")
    else:
        records = (normalize_movie(item) for item in get_movies(pages=max(1, args.pages)))
        records = (record for record in records if record.content_type == args.type)

    with open(args.output, "w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
