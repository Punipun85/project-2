# EntertainmentAI

EntertainmentAI extends MovieRecs AI into a universal entertainment recommendation platform for movies, anime, K-drama, TV series, and documentaries.

## Run the hosted web profile

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Local Cloudflare development reads Ollama settings from `.dev.vars`. The configured
endpoint is `http://ASUS:11434/api/chat` with model `qwen2.5:3b`. Copy
`.dev.vars.example` when setting up another machine.

Lumi uses a resilient provider chain: Ollama first, then an optional
OpenAI-compatible remote API, then deterministic hybrid explanations. Configure
the remote provider with `REMOTE_AI_BASE_URL`, `REMOTE_AI_API_KEY`, and
`REMOTE_AI_MODEL`. The prepared base URL is `https://ai.punipuni.my.id/v1`;
its key and model ID are intentionally not committed.

```bash
npm run build
npm test
npm run lint
npm run db:generate
```

## Run the FastAPI profile

```bash
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

## Recommendation tests

```bash
python -m unittest discover -s ml-service/tests -v
```

## Data synchronization

```bash
pip install -r data-pipeline/requirements.txt
copy data-pipeline\.env.example data-pipeline\.env
python data-pipeline/main.py --pages 1 --dry-run --output normalized-contents.ndjson
python data-pipeline/main.py --pages 1
```

The pipeline imports TMDB popular/top-rated movies and TV series plus Jikan top
anime, normalizes every item to the Supabase `contents` schema, deduplicates by
`(source, external_id)`, and performs bounded service-role upserts. Use repeated
`--source` flags to run only `tmdb-movies`, `tmdb-tv`, or `jikan-anime`.

TMDB synchronization requires `TMDB_API_KEY`; Supabase writes require
`SUPABASE_URL` and a server-only `SUPABASE_KEY`. Never expose the service-role
key to frontend code. The AI service uses
`OLLAMA_CHAT_URL` and `OLLAMA_MODEL`. The optional remote fallback uses
`REMOTE_AI_BASE_URL`, `REMOTE_AI_API_KEY`, and `REMOTE_AI_MODEL`.

See [PRD.md](./PRD.md), [TDD.md](./TDD.md), [ARCHITECTURE.md](./ARCHITECTURE.md), and [API.md](./API.md) for the product and technical contracts.

The optional Supabase/PostgreSQL unified catalog migration is documented in
[SUPABASE_CONTENTS_SCHEMA.md](./SUPABASE_CONTENTS_SCHEMA.md).
