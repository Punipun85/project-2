"""Live validation for TMDB TV search and credits endpoints."""

from __future__ import annotations

from typing import Any

try:
    from ._common import ApiCheckResult, failure_from_exception, print_result, validate_tmdb_cast
except ImportError:
    from _common import ApiCheckResult, failure_from_exception, print_result, validate_tmdb_cast

from config.settings import get_settings
from sources.tmdb_series import create_client


LABEL = "TMDB TV CHARACTER TEST"
SAMPLE_TITLE = "Moving"


def _select_moving(results: list[Any]) -> dict[str, Any] | None:
    valid_results = [item for item in results if isinstance(item, dict)]
    for item in valid_results:
        names = (item.get("name"), item.get("original_name"))
        if any(isinstance(name, str) and name.casefold() == SAMPLE_TITLE.casefold() for name in names):
            return item
    return valid_results[0] if valid_results else None


def run_check() -> ApiCheckResult:
    try:
        settings = get_settings()
        client = create_client(settings)
        api_key = settings.require_tmdb()
        search_payload = client.get(
            "search/tv",
            params={
                "api_key": api_key,
                "query": SAMPLE_TITLE,
                "language": "en-US",
                "include_adult": "false",
            },
        )
        results = search_payload.get("results")
        if not isinstance(results, list):
            return ApiCheckResult(LABEL, False, detail="TV search response has no results list")
        selected = _select_moving(results)
        if selected is None or selected.get("id") is None:
            return ApiCheckResult(LABEL, False, detail="Moving was not found by TMDB TV search")

        payload = client.get(
            f"tv/{selected['id']}/credits",
            params={"api_key": api_key, "language": "en-US"},
        )
        count, validation_error = validate_tmdb_cast(payload)
        if validation_error:
            return ApiCheckResult(LABEL, False, count, validation_error)
        return ApiCheckResult(
            LABEL,
            True,
            count,
            f"Resolved Moving to TMDB TV ID {selected['id']}",
        )
    except Exception as error:  # Each provider must report failure without stopping the runner.
        return failure_from_exception(LABEL, error)


if __name__ == "__main__":
    result = run_check()
    print_result(result)
    raise SystemExit(0 if result.success else 1)
