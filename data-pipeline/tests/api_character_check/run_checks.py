"""Run all character API checks and print the requested readiness summary."""

from __future__ import annotations

from _common import ApiCheckResult, failure_from_exception, print_result
from test_mal_characters import run_check as check_mal
from test_tmdb_movie_credits import run_check as check_tmdb_movie
from test_tmdb_tv_credits import run_check as check_tmdb_tv


def _run_safely(label: str, check: object) -> ApiCheckResult:
    try:
        return check()  # type: ignore[operator]
    except Exception as error:
        return failure_from_exception(label, error)


def main() -> int:
    results = [
        _run_safely("TMDB MOVIE CHARACTER TEST", check_tmdb_movie),
        _run_safely("TMDB TV CHARACTER TEST", check_tmdb_tv),
        _run_safely("MAL CHARACTER TEST", check_mal),
    ]

    for index, result in enumerate(results):
        if index:
            print("\n" + "-" * 33 + "\n")
        print_result(result)

    ready = all(result.success for result in results)
    print("\n" + "=" * 33)
    print("NEXAPLAY AI CHARACTER API CHECK")
    print()
    print(f"TMDB MOVIE: {results[0].status}")
    print()
    print(f"TMDB SERIES: {results[1].status}")
    print()
    print(f"MAL ANIME: {results[2].status}")
    print()
    print(f"Ready for character ingestion: {'YES' if ready else 'NO'}")
    print("=" * 33)
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
