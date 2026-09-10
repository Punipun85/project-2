# NexaPlay Production Worker

This standalone FastAPI service schedules the existing data pipeline and embedding command. It does not duplicate either implementation.

## Jobs

- `daily_content_sync`: runs the existing TMDB/MAL pipeline, then the existing embedding generator every day at `PIPELINE_DAILY_HOUR_UTC`.
- `weekly_analytics`: refreshes the Supabase daily analytics snapshot each `ANALYTICS_WEEKLY_DAY`.
- `cleanup`: removes health checks older than 90 days and job runs older than 180 days monthly.

Copy `.env.example` to a private `.env`, provide a strong `WORKER_API_KEY`, Supabase URL, and service-role key, then run:

```bash
pip install -r worker-service/requirements.txt
uvicorn --app-dir worker-service app.main:app --host 0.0.0.0 --port 8200
```

Build the container from the repository root because the worker intentionally reuses root scripts and `data-pipeline/`:

```bash
docker build -f worker-service/Dockerfile -t nexaplay-worker .
docker run --env-file worker-service/.env -p 8200:8200 nexaplay-worker
```

Manual execution is authenticated:

```bash
curl -X POST http://localhost:8200/jobs/weekly_analytics/run \
  -H "Authorization: Bearer $WORKER_API_KEY"
```

The service-role key must only exist in this trusted worker runtime. Never add it to a browser variable or commit it.
