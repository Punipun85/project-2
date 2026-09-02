"""Live validation for the requested official MAL anime characters endpoint."""

from __future__ import annotations

from typing import Any

try:
    from ._common import ApiCheckResult, failure_from_exception, print_result
except ImportError:
    from _common import ApiCheckResult, failure_from_exception, print_result

from config.settings import get_settings
from sources.mal_anime import MalAnimeClient


LABEL = "MAL CHARACTER TEST"
ATTACK_ON_TITAN_MAL_ID = 16498
MAL_CHARACTER_FIELDS = ",".join(
    (
        "id",
        "first_name",
        "last_name",
        "alternative_name",
        "main_picture",
        "voice_actors",
    )
)


def _extract_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    characters = payload.get("characters")
    if isinstance(characters, list):
        return [item for item in characters if isinstance(item, dict)]
    return []


def _character(item: dict[str, Any]) -> dict[str, Any] | None:
    character = item.get("character")
    if isinstance(character, dict):
        return character
    node = item.get("node")
    return node if isinstance(node, dict) else None


def _character_name(character: dict[str, Any]) -> str:
    name = character.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return " ".join(
        value.strip()
        for value in (character.get("first_name"), character.get("last_name"))
        if isinstance(value, str) and value.strip()
    )


def run_check() -> ApiCheckResult:
    try:
        settings = get_settings()
        payload = MalAnimeClient(settings).get(
            f"anime/{ATTACK_ON_TITAN_MAL_ID}/characters",
            params={"limit": 100, "fields": MAL_CHARACTER_FIELDS},
        )
        rows = _extract_rows(payload)
        if not rows:
            return ApiCheckResult(LABEL, False, detail="Response has no character data")

        missing_name_or_role = []
        missing_voice_actors = []
        for index, item in enumerate(rows):
            character = _character(item)
            if not character or not _character_name(character) or not item.get("role"):
                missing_name_or_role.append(index)
            if not isinstance(item.get("voice_actors"), list):
                missing_voice_actors.append(index)
        if missing_name_or_role:
            preview = ", ".join(str(index) for index in missing_name_or_role[:5])
            return ApiCheckResult(
                LABEL,
                False,
                len(rows),
                f"Character rows missing name or role at indexes: {preview}",
            )

        eren_found = any(
            _character_name(_character(item) or {}) == "Eren Yeager" and item.get("role") == "Main"
            for item in rows
        )
        if not eren_found:
            return ApiCheckResult(LABEL, False, len(rows), "Expected Eren Yeager example not found")
        if missing_voice_actors:
            return ApiCheckResult(
                LABEL,
                False,
                len(rows),
                "Official MAL response omits the required voice_actors field",
            )
        return ApiCheckResult(LABEL, True, len(rows))
    except Exception as error:  # Each provider must report failure without stopping the runner.
        return failure_from_exception(LABEL, error)


if __name__ == "__main__":
    result = run_check()
    print_result(result)
    raise SystemExit(0 if result.success else 1)
