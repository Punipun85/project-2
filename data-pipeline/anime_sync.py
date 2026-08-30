"""Fetch and normalize anime metadata from Jikan."""

import argparse
import json
import time
from collections.abc import Iterator

import requests

from models import NormalizedContent


class JikanClient:
    base_url = "https://api.jikan.moe/v4"

    def __init__(self, delay_seconds: float = 0.4) -> None:
        self.session = requests.Session()
        self.delay_seconds = delay_seconds

    def top_anime(self, pages: int = 1) -> Iterator[NormalizedContent]:
        for page in range(1, pages + 1):
            response = self.session.get(f"{self.base_url}/top/anime", params={"page": page, "filter": "bypopularity"}, timeout=30)
            response.raise_for_status()
            for item in response.json().get("data", []):
                yield self._normalize(item)
            time.sleep(self.delay_seconds)

    @staticmethod
    def _normalize(item: dict) -> NormalizedContent:
        images = item.get("images", {}).get("jpg", {})
        studios = item.get("studios") or []
        themes = [theme.get("name", "") for theme in item.get("themes", []) if theme.get("name")]
        return NormalizedContent(
            external_id=str(item["mal_id"]),
            provider="jikan",
            type="anime",
            title=item.get("title_english") or item.get("title") or "Untitled",
            original_title=item.get("title_japanese"),
            description=item.get("synopsis") or "",
            poster_url=images.get("large_image_url") or images.get("image_url"),
            backdrop_url=item.get("trailer", {}).get("images", {}).get("maximum_image_url"),
            genre=[genre["name"] for genre in item.get("genres", [])],
            themes=themes,
            language="Japanese",
            country="Japan",
            release_date=item.get("aired", {}).get("from"),
            duration=_duration_minutes(item.get("duration")),
            episodes=item.get("episodes"),
            season=" ".join(str(value) for value in (item.get("season"), item.get("year")) if value),
            studio=studios[0]["name"] if studios else None,
            source_material=item.get("source"),
            rating=float(item.get("score") or 0),
            popularity=max(0.0, 100.0 - min(float(item.get("popularity") or 10000) / 100, 100.0)),
            metadata={"mal_rank": item.get("rank"), "status": item.get("status"), "anime_type": item.get("type")},
        )


def _duration_minutes(value: str | None) -> int | None:
    if not value:
        return None
    total = 0
    parts = value.lower().replace("per ep", "").split()
    for index, part in enumerate(parts):
        if part.startswith("hr") and index:
            total += int(parts[index - 1]) * 60
        if part.startswith("min") and index:
            total += int(parts[index - 1])
    return total or None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--output", default="anime_contents.ndjson")
    args = parser.parse_args()
    with open(args.output, "w", encoding="utf-8") as output:
        for content in JikanClient().top_anime(max(1, args.pages)):
            output.write(json.dumps(content.to_dict(), ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
