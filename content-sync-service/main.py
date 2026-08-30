import os

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException


app = FastAPI(title="EntertainmentAI Content Sync", version="1.0.0")
CONTENT_API_URL = os.getenv("CONTENT_API_URL", "http://localhost:8000")
ANIME_SERVICE_URL = os.getenv("ANIME_SERVICE_URL", "http://localhost:8002")


async def sync_anime(query: str) -> None:
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(f"{ANIME_SERVICE_URL}/anime/search", params={"query": query, "limit": 25})
        response.raise_for_status()
        for item in response.json().get("data", []):
            await client.post(f"{CONTENT_API_URL}/internal/contents/upsert", json={"provider": "jikan", "type": "anime", "payload": item})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "content-sync"}


@app.post("/sync/anime")
async def start_anime_sync(background_tasks: BackgroundTasks, query: str = "top anime") -> dict:
    if not query.strip():
        raise HTTPException(status_code=400, detail="query is required")
    background_tasks.add_task(sync_anime, query)
    return {"status": "accepted", "source": "jikan", "query": query}
