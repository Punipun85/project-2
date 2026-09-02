"""Shared primitives for opt-in, live character API validation."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


PIPELINE_ROOT = Path(__file__).resolve().parents[2]
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))


HTTP_ERROR_MESSAGES = {
    401: "Invalid authentication",
    403: "Permission issue",
    404: "Endpoint unavailable",
    429: "Rate limit",
}


@dataclass(frozen=True)
class ApiCheckResult:
    """Normalized result so every provider can fail independently."""

    label: str
    success: bool
    characters_found: int = 0
    detail: str | None = None

    @property
    def status(self) -> str:
        return "SUCCESS" if self.success else "FAILED"


def failure_from_exception(label: str, error: BaseException) -> ApiCheckResult:
    """Translate provider and transport exceptions into actionable failures."""

    if isinstance(error, requests.HTTPError) and error.response is not None:
        status_code = error.response.status_code
        if status_code >= 500:
            message = "Provider error"
        else:
            message = HTTP_ERROR_MESSAGES.get(status_code, "HTTP error")
        detail = f"{status_code}: {message}"
    elif isinstance(error, requests.Timeout):
        detail = "Request timeout"
    elif isinstance(error, requests.ConnectionError):
        detail = "Connection error"
    elif isinstance(error, requests.JSONDecodeError):
        detail = "Invalid JSON response"
    else:
        detail = str(error) or error.__class__.__name__

    return ApiCheckResult(label=label, success=False, detail=detail)


def validate_tmdb_cast(payload: dict[str, Any]) -> tuple[int, str | None]:
    """Require a non-empty TMDB cast and all requested character fields."""

    cast = payload.get("cast")
    if not isinstance(cast, list) or not cast:
        return 0, "Response does not contain a non-empty cast list"

    invalid_rows = []
    for index, item in enumerate(cast):
        if not isinstance(item, dict):
            invalid_rows.append(index)
            continue
        if not item.get("name") or not item.get("character") or "profile_path" not in item:
            invalid_rows.append(index)

    if invalid_rows:
        preview = ", ".join(str(index) for index in invalid_rows[:5])
        suffix = "..." if len(invalid_rows) > 5 else ""
        return len(cast), f"Cast rows missing required fields at indexes: {preview}{suffix}"
    return len(cast), None


def print_result(result: ApiCheckResult) -> None:
    print(result.label)
    print()
    print("Status:")
    print(result.status)
    print()
    print("Characters found:")
    print(result.characters_found)
    if result.detail:
        print()
        print(f"Detail: {result.detail}")
