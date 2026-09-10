# NexaPlay Recommendation Service

Standalone FastAPI service for personalized content ranking. It reuses the
existing Supabase catalog vectors and calls the external embedding service;
it does not load or install an embedding model.

## Scoring

```text
final_score = content_score * 0.5
            + collaborative_score * 0.3
            + context_score * 0.2
```

- Content: cosine similarity, genre, content type, and metadata similarity.
- Collaborative: cosine similarity between user-item affinity vectors.
- Context: recent genres, searches, explicit preferences, completion, and
  time-of-day/content-type affinity.
- Cold start: normalized rating, vote support, and popularity.

The engine also consumes Batch 3 `user_preferences`, canonical `ratings` and
`favorites`, derived `user_taste_profiles`, and `user_embeddings`. Canonical
signals take precedence over their mirrored interaction events, preventing
double weighting.

## Configuration

Copy `.env.example` to `.env`, then provide server-only values:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
RECOMMENDATION_API_KEY=YOUR_INTERNAL_API_KEY
EMBEDDING_API_URL=http://localhost:8000/ai/embed
EMBEDDING_API_KEY=YOUR_EMBEDDING_KEY
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
PORT=8100
```

Never expose either service key in browser JavaScript.

## Local run

```bash
python -m pip install -r requirements-dev.txt
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

## API

```http
POST /recommendations
Authorization: Bearer YOUR_INTERNAL_API_KEY
Content-Type: application/json

{
  "user_id": "13dd748e-4df8-4b73-88c7-d5fa705e3b2d",
  "limit": 20,
  "query": "fantasy anime with emotional storytelling"
}
```

`user_id` may be null for anonymous cold-start recommendations. The public
Next.js route obtains authenticated IDs from the Supabase session; browser
input is never trusted as an identity.

Health check:

```http
GET /health
```

## Tests and Docker

```bash
pytest -q
docker build -t nexaplay-recommendations .
docker run --env-file .env -p 8100:8100 nexaplay-recommendations
```
