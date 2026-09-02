"""Live validation for the TMDB movie credits endpoint."""

from __future__ import annotations

try:
    from ._common import ApiCheckResult, failure_from_exception, print_result, validate_tmdb_cast
except ImportError:
    from _common import ApiCheckResult, failure_from_exception, print_result, validate_tmdb_cast

from config.settings import get_settings
from sources.tmdb_movie import create_client


LABEL = "TMDB MOVIE CHARACTER TEST"
INTERSTELLAR_TMDB_ID = 157336


def run_check() -> ApiCheckResult:
    try:
        settings = get_settings()
        payload = create_client(settings).get(
            f"movie/{INTERSTELLAR_TMDB_ID}/credits",
            params={"api_key": settings.require_tmdb(), "language": "en-US"},
        )
        count, validation_error = validate_tmdb_cast(payload)
        if validation_error:
            return ApiCheckResult(LABEL, False, count, validation_error)

        cooper_found = any(
            item.get("name") == "Matthew McConaughey" and "Cooper" in item.get("character", "")
            for item in payload["cast"]
            if isinstance(item, dict)
        )
        if not cooper_found:
            return ApiCheckResult(LABEL, False, count, "Expected Interstellar cast example not found")
        return ApiCheckResult(LABEL, True, count)
    except Exception as error:  # Each provider must report failure without stopping the runner.
        return failure_from_exception(LABEL, error)


if __name__ == "__main__":
    result = run_check()
    print_result(result)
    raise SystemExit(0 if result.success else 1)
