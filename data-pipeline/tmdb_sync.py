"""Fetch and normalize movies, TV series, K-drama, and documentaries from TMDB."""

import argparse
import json
import os
from collections.abc import Iterator

import requests

from models import NormalizedContent


class TMDBClient:
    base_url = "https://api.themoviedb.org/3"
    image_url = "https://image.tmdb.org/t/p/original"

    def __init__(self, token: str) -> None:
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}", "accept": "application/json"})

    def discover(self, content_type: str, pages: int = 1) -> Iterator[NormalizedContent]:
        if content_type == "movie":
            endpoint, params = "/discover/movie", {"sort_by": "popularity.desc"}
        elif content_type == "documentary":
            endpoint, params = "/discover/movie", {"with_genres": "99", "sort_by": "popularity.desc"}
        elif content_type == "kdrama":
            endpoint, params = "/discover/tv", {"with_origin_country": "KR", "with_original_language": "ko", "sort_by": "popularity.desc"}
        else:
            endpoint, params = "/discover/tv", {"sort_by": "popularity.desc"}
        for page in range(1, pages + 1):
            response = self.session.get(f"{self.base_url}{endpoint}", params={**params, "page": page}, timeout=30)
            response.raise_for_status()
            for item in response.json().get("results", []):
                yield self._normalize(item, content_type)

    def _normalize(self, item: dict, content_type: str) -> NormalizedContent:
        title = item.get("title") or item.get("name") or "Untitled"
        original_title = item.get("original_title") or item.get("original_name")
        release_date = item.get("release_date") or item.get("first_air_date")
        return NormalizedContent(
            external_id=str(item["id"]),
            provider="tmdb",
            type="series" if content_type == "series" else content_type,
            title=title,
            original_title=original_title,
            description=item.get("overview") or "",
            poster_url=f"{self.image_url}{item['poster_path']}" if item.get("poster_path") else None,
            backdrop_url=f"{self.image_url}{item['backdrop_path']}" if item.get("backdrop_path") else None,
            language=item.get("original_language"),
            release_date=release_date,
            rating=float(item.get("vote_average") or 0),
            popularity=float(item.get("popularity") or 0),
            metadata={"genre_ids": item.get("genre_ids", []), "vote_count": item.get("vote_count", 0)},
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--type", choices=["movie", "series", "kdrama", "documentary"], default="movie")
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--output", default="tmdb_contents.ndjson")
    args = parser.parse_args()
    token = os.environ.get("TMDB_API_TOKEN")
    if not token:
        raise SystemExit("TMDB_API_TOKEN is required")
    with open(args.output, "w", encoding="utf-8") as output:
        for content in TMDBClient(token).discover(args.type, max(1, args.pages)):
            output.write(json.dumps(content.to_dict(), ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
