import os

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="EntertainmentAI LLM Service", version="1.0.0")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")


class ExplainRequest(BaseModel):
    user_context: str = Field(max_length=4000)
    content_title: str = Field(max_length=320)
    content_context: str = Field(max_length=6000)


@app.get("/health")
async def health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
        ollama = "online" if response.status_code == 200 else "degraded"
    except httpx.HTTPError:
        ollama = "offline"
    return {"status": "ok", "ollama": ollama, "model": OLLAMA_MODEL}


@app.post("/explain")
async def explain(request: ExplainRequest) -> dict[str, str]:
    prompt = (
        "Write one concise, specific recommendation explanation. "
        f"User taste: {request.user_context}\n"
        f"Content: {request.content_title}\n"
        f"Metadata: {request.content_context}"
    )
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
        response.raise_for_status()
        return {"explanation": response.json().get("response", "").strip(), "provider": "ollama"}
    except httpx.HTTPError:
        return {
            "explanation": f"{request.content_title} matches the themes and emotional tone in your recent activity.",
            "provider": "deterministic-fallback",
        }
