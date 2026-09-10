# NexaPlay Embedding Service

Standalone FastAPI microservice that generates normalized semantic embeddings
for NexaPlay search, RAG, and recommendations. It uses
`sentence-transformers/all-MiniLM-L6-v2` and returns 384-dimensional vectors.

The model is loaded once during application startup and reused across requests.
Inference runs outside the async event loop and is protected by a configurable
timeout.

## Project layout

```text
nexaplay-embedding-service/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── embedding.py
│   ├── auth.py
│   └── config.py
├── tests/
│   └── test_api.py
├── requirements.txt
├── requirements-dev.txt
├── Dockerfile
├── .dockerignore
├── .env.example
└── README.md
```

## Environment variables

Copy `.env.example` to `.env` and insert a private API key:

```dotenv
EMBEDDING_API_KEY=replace-with-a-long-random-secret
MODEL_NAME=sentence-transformers/all-MiniLM-L6-v2
PORT=8000
CORS_ORIGINS=http://localhost:3000
REQUEST_TIMEOUT_SECONDS=30
MAX_TEXT_LENGTH=12000
LOG_LEVEL=INFO
```

`EMBEDDING_API_KEY` is required. Never expose it in browser JavaScript or
commit the populated `.env` file. NexaPlay's Next.js server should call this
service server-to-server.

## Local installation

Python 3.11 is recommended.

```bash
python -m venv .venv
```

Activate the environment, then install and run:

```bash
python -m pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Alternatively, `python -m app.main` reads the port from `PORT`.

The first local startup downloads the model if it is not already cached.

## API

### Health check

```http
GET /health
```

Healthy response:

```json
{
  "status": "ok",
  "model_loaded": true
}
```

A model-loading failure returns HTTP `503` with `status: "degraded"`.

### Generate embedding

```http
POST /ai/embed
Authorization: Bearer YOUR_KEY
Content-Type: application/json
```

```json
{
  "text": "An anime about fantasy adventure and magic"
}
```

Successful responses contain `embedding`, `model`, and `dimension`. The
embedding contains exactly 384 normalized floating-point values.

Example curl:

```bash
curl -X POST http://localhost:8000/ai/embed \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"An action anime with an overpowered main character"}'
```

Status behavior:

- `200`: embedding generated;
- `401`: missing or invalid API key;
- `422`: empty, malformed, or oversized request;
- `503`: model unavailable or inference failure;
- `504`: inference exceeded `REQUEST_TIMEOUT_SECONDS`.

## Tests

Tests use an in-memory fake model and do not download model weights:

```bash
python -m pip install -r requirements-dev.txt
pytest -q
```

They verify authentication, empty-text validation, degraded health behavior,
and that the example input returns a 384-dimensional vector.

## Docker

Build the image:

```bash
docker build -t nexaplay-embedding-service .
```

Run it with a secret supplied at runtime:

```bash
docker run --rm -p 8000:8000 \
  -e EMBEDDING_API_KEY="YOUR_KEY" \
  -e CORS_ORIGINS="https://your-nexaplay-domain.com" \
  nexaplay-embedding-service
```

The Docker build caches the default model, runs as a non-root user, exposes a
container health check, and starts one Uvicorn worker. A single worker avoids
duplicating the model in memory. Scale horizontally with additional containers
when more throughput is required.

## Production notes

- Terminate HTTPS at the hosting platform or reverse proxy.
- Store `EMBEDDING_API_KEY` in the platform's secret manager.
- Restrict `CORS_ORIGINS` to trusted web origins. CORS does not replace API-key
  authentication.
- Allocate enough memory for PyTorch and the MiniLM model.
- Use `/health` for readiness and liveness monitoring.
- Do not use multiple Uvicorn workers in one small container because each
  worker loads its own model copy.
