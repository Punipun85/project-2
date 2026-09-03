"""Normalize provider character data without touching Batch 1 content records."""

from __future__ import annotations

import html
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


WHITESPACE_RE = re.compile(r"\s+")
HTML_TAG_RE = re.compile(r"<[^>]+>")
INVALID_NAMES = {
    "",
    "\\n",
    "n/a",
    "none",
    "null",
    "self",
    "himself",
    "herself",
    "themselves",
    "unknown",
    "uncredited",
    "archive footage",
}
ROLE_MAP = {
    "main": "main",
    "lead": "main",
    "supporting": "supporting",
    "support": "supporting",
    "background": "background",
    "minor": "background",
}


class CharacterRecord(BaseModel):
    """One normalized content-to-character appearance ready for upload."""

    model_config = ConfigDict(str_strip_whitespace=True)

    content_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=500)
    normalized_name: str = Field(min_length=1, max_length=500)
    alternative_names: list[str] = Field(default_factory=list)
    description: str | None = None
    image_url: str | None = None
    role: str = "supporting"
    actor_name: str | None = None
    voice_actor: str | None = None
    importance_score: int = Field(default=0, ge=0, le=100)
    source: str = Field(min_length=1, max_length=50)

    @field_validator("source")
    @classmethod
    def uppercase_source(cls, value: str) -> str:
        return value.upper()

    def character_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": self.name,
            "normalized_name": self.normalized_name,
            "alternative_names": self.alternative_names,
            "source": self.source,
        }
        if self.description:
            payload["description"] = self.description
        if self.image_url:
            payload["image_url"] = self.image_url
        return payload

    def relationship_payload(self, character_id: int) -> dict[str, Any]:
        return {
            "content_id": self.content_id,
            "character_id": character_id,
            "role": self.role,
            "actor_name": self.actor_name,
            "voice_actor": self.voice_actor,
            "importance_score": self.importance_score,
            "source": self.source,
        }


def normalize_character_name(value: Any) -> str | None:
    """Return a stable display name, rejecting non-character placeholders."""

    if not isinstance(value, str):
        return None
    cleaned = WHITESPACE_RE.sub(" ", html.unescape(value)).strip(" \t\r\n\"'")
    if cleaned.casefold() in INVALID_NAMES or not any(character.isalpha() for character in cleaned):
        return None
    if cleaned.islower() or cleaned.isupper():
        cleaned = cleaned.title()
    return cleaned[:500]


def normalize_character_record(
    *,
    content_id: int,
    name: Any,
    source: str,
    alternative_names: list[Any] | None = None,
    description: Any = None,
    image_url: Any = None,
    role: Any = "supporting",
    actor_name: Any = None,
    voice_actor: Any = None,
    importance_score: Any = 0,
) -> CharacterRecord | None:
    canonical_name = normalize_character_name(name)
    if canonical_name is None:
        return None

    aliases: list[str] = []
    seen = {canonical_name.casefold()}
    for candidate in alternative_names or []:
        alias = normalize_character_name(candidate)
        if alias and alias.casefold() not in seen:
            aliases.append(alias)
            seen.add(alias.casefold())

    normalized_role = ROLE_MAP.get(str(role or "").strip().casefold(), "other")
    actor = _nullable_text(actor_name)
    voice = _nullable_text(voice_actor)
    score = _bounded_score(importance_score)
    return CharacterRecord(
        content_id=content_id,
        name=canonical_name,
        normalized_name=WHITESPACE_RE.sub(" ", canonical_name).strip().lower(),
        alternative_names=aliases,
        description=_clean_description(description),
        image_url=_nullable_text(image_url),
        role=normalized_role,
        actor_name=actor,
        voice_actor=voice,
        importance_score=score,
        source=source,
    )


def _nullable_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = WHITESPACE_RE.sub(" ", html.unescape(value)).strip()
    return cleaned or None


def _clean_description(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = HTML_TAG_RE.sub(" ", value.replace("<br>", " ").replace("<br />", " "))
    return _nullable_text(cleaned)


def _bounded_score(value: Any) -> int:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return 0
