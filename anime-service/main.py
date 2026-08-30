from fastapi import FastAPI, HTTPException, Query
import httpx


app = FastAPI(title="EntertainmentAI Anime Service", version="1.0.0")
JIKAN_URL = "https://api.jikan.moe/v4"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "jikan"}


@app.get("/anime/search")
async def search_anime(query: str = Query(min_length=2), limit: int = Query(default=10, ge=1, le=25)) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{JIKAN_URL}/anime", params={"q": query, "limit": limit, "sfw": "true"})
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Jikan is unavailable")
    return {"data": response.json().get("data", []), "provider": "jikan"}


@app.get("/anime/{mal_id}")
async def anime_detail(mal_id: int) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"{JIKAN_URL}/anime/{mal_id}/full")
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Anime not found")
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Jikan is unavailable")
    return {"data": response.json().get("data"), "provider": "jikan"}
