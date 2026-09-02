# Character API endpoint validation

This directory contains opt-in live checks for character data providers. The
checks make read-only HTTP requests and never connect to Supabase, create a
migration, or modify the `contents` table.

## Endpoints

- TMDB movie: `GET /movie/157336/credits` (Interstellar)
- TMDB series: `GET /search/tv?query=Moving`, followed by `GET /tv/{id}/credits`
- MyAnimeList official API: `GET /v2/anime/16498/characters` (Attack on Titan)

The MAL check intentionally does not fall back to Jikan. A missing or
unauthorized official endpoint must remain visible as a failed readiness check.

## Run all checks

From `data-pipeline`:

```powershell
python tests/api_character_check/run_checks.py
```

The command executes every provider even if another provider fails. It returns
exit code `0` only when all three checks pass. The normal unit-test command does
not discover this directory, keeping CI deterministic and offline-safe.

Run an individual provider check with, for example:

```powershell
python tests/api_character_check/test_tmdb_movie_credits.py
```

Required environment variables are loaded from `data-pipeline/.env` through the
existing settings module:

- `TMDB_API_KEY`
- `MAL_CLIENT_ID`
- Optional existing MAL OAuth values: `MAL_ACCESS_TOKEN`, `MAL_REFRESH_TOKEN`,
  `MAL_CLIENT_SECRET`, and `MAL_REDIRECT_URI`

HTTP failures are reported explicitly for invalid authentication (`401`),
permission issues (`403`), unavailable endpoints (`404`), rate limits (`429`),
and provider errors (`500+`).

## Latest live result

Validation on 2026-09-02 found that both TMDB credits endpoints satisfy the
requested contract. The official MAL endpoint is reachable and returns
character identity and role data, but it omits the required `voice_actors`
field even when that field is requested. Character ingestion therefore remains
not ready under the current all-providers-must-pass rule. No database work
should begin until the anime voice-actor source contract is resolved.
