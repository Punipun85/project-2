"""TMDB TV credits importer for series character enrichment."""

from __future__ import annotations

import logging
from typing import Any

from character_pipeline.character_normalizer import CharacterRecord, normalize_character_record
from config.settings import Settings, get_settings
from sources.tmdb_series import create_client


LOGGER = logging.getLogger(__name__)
class TmdbCharacterImporter:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.client = create_client(self.settings)

    def import_content(self, content: dict[str, Any]) -> list[CharacterRecord]:
        payload = self.client.get(
            f"tv/{content['external_id']}/credits",
            params={"api_key": self.settings.require_tmdb(), "language": "en-US"},
        )
        cast = payload.get("cast")
        if not isinstance(cast, list):
            return []

        records: list[CharacterRecord] = []
        for index, item in enumerate(cast):
            if not isinstance(item, dict):
                continue
            order = item.get("order", index)
            try:
                numeric_order = int(order)
            except (TypeError, ValueError):
                numeric_order = index
            record = normalize_character_record(
                content_id=int(content["id"]),
                name=item.get("character"),
                source="TMDB",
                role="main" if numeric_order < 3 else "supporting",
                actor_name=item.get("name"),
                importance_score=max(10, 100 - numeric_order * 5),
            )
            if record:
                records.append(record)
        LOGGER.info("TMDB credits content=%s records=%s", content.get("id"), len(records))
        return records
