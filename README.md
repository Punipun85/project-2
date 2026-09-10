# EntertainmentAI

EntertainmentAI extends MovieRecs AI into a universal entertainment recommendation platform for movies, anime, K-drama, TV series, and documentaries.

## Run the web application

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Local development uses `.env` as the only active environment file. Vercel
production uses dashboard environment variables.

Lumi uses a resilient provider chain: Ollama first, then an optional
OpenAI-compatible remote API, then deterministic hybrid explanations. Configure
the remote provider with `REMOTE_AI_BASE_URL`, `REMOTE_AI_API_KEY`,
`REMOTE_AI_DEFAULT_MODEL`, `REMOTE_AI_REASONING_MODEL`, and
`REMOTE_AI_FALLBACK_MODEL`. Set `NEXT_PUBLIC_SITE_URL` to the final production
domain so metadata and link previews use the custom domain correctly.

```bash
npm run build
npm test
npm run lint
```

## Data synchronization

```bash
pip install -r data-pipeline/requirements.txt
copy data-pipeline\.env.example data-pipeline\.env
python data-pipeline/main.py --pages 1 --dry-run
python data-pipeline/main.py --pages 1
```

The pipeline imports TMDB popular/top-rated movies and TV series plus top and
seasonal anime from the official MyAnimeList API, normalizes every item to the
Supabase `contents` schema, deduplicates by
`(source, external_id)`, and performs bounded service-role upserts. Use repeated
`--source` flags to run only `tmdb-movies`, `tmdb-series`, or `mal-anime`.

TMDB synchronization requires `TMDB_API_KEY`, MAL requires `MAL_CLIENT_ID`, and
Supabase writes require `SUPABASE_URL` and a server-only
`SUPABASE_SERVICE_ROLE_KEY`. Never expose the service-role key to frontend code.
The AI gateway uses `REMOTE_AI_BASE_URL`, `REMOTE_AI_API_KEY`,
`REMOTE_AI_DEFAULT_MODEL`, `REMOTE_AI_REASONING_MODEL`, and
`REMOTE_AI_FALLBACK_MODEL`.

See [PRD.md](./PRD.md), [TDD.md](./TDD.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and [API.md](./API.md) for the product and technical contracts.

The optional Supabase/PostgreSQL unified catalog migration is documented in
[SUPABASE_CONTENTS_SCHEMA.md](./SUPABASE_CONTENTS_SCHEMA.md).
