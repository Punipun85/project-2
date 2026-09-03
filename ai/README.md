# NexaPlay AI — Batch 3

Batch 3 is an additive backend service for semantic search, hybrid recommendation,
behavior tracking, and grounded Ollama chat. It does not replace the Batch 1 or
Batch 2A ingestion code.

## Setup

Apply the Supabase migration, install dependencies, then generate embeddings:

```powershell
supabase db push
python -m pip install -r ai/requirements.txt
python -m ai.embedding --batch-size 32
```

The service reads `SUPABASE_URL` and the service-role `SUPABASE_KEY` from the
process environment or `data-pipeline/.env`. Ollama defaults to
`http://ASUS:11434/api/chat` with `qwen2.5:3b`; override `OLLAMA_CHAT_URL` and
`OLLAMA_MODEL` when needed.

Run the API and tests:

```powershell
uvicorn ai.main:app --reload --port 8001
python -m pytest ai/tests -q
```

Endpoints:

- `POST /ai/search`
- `POST /ai/recommend`
- `POST /ai/chat`
- `POST /ai/interactions`

The recommendation score is exactly `0.5 * content + 0.3 * behavior + 0.2 * popularity`.
The RAG response includes source content IDs and titles so clients can show where
the answer came from.
