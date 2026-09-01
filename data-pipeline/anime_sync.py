"""Backward-compatible NDJSON exporter for the Jikan pipeline."""

import argparse
import json

from jikan_anime import get_anime, normalize


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--output", default="anime_contents.ndjson")
    args = parser.parse_args()

    with open(args.output, "w", encoding="utf-8") as output:
        for item in get_anime(pages=max(1, args.pages)):
            output.write(json.dumps(normalize(item).to_dict(), ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
