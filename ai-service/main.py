import os

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="EntertainmentAI LLM Service", version="1.0.0")
OLLAMA_CHAT_URL = os.getenv("OLLAMA_CHAT_URL", "http://ASUS:11434/api/chat")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
REMOTE_AI_BASE_URL = os.getenv("REMOTE_AI_BASE_URL", "")
REMOTE_AI_API_KEY = os.getenv("REMOTE_AI_API_KEY", "")
REMOTE_AI_MODEL = os.getenv("REMOTE_AI_MODEL", "")


class ExplainRequest(BaseModel):
    user_context: str = Field(max_length=4000)
    content_title: str = Field(max_length=320)
    content_context: str = Field(max_length=6000)


@app.get("/health")
async def health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            response = await client.get(OLLAMA_CHAT_URL.replace("/api/chat", "/api/tags"))
        ollama = "online" if response.status_code == 200 else "degraded"
    except httpx.HTTPError:
        ollama = "offline"
    return {
        "status": "ok",
        "ollama": ollama,
        "model": OLLAMA_MODEL,
        "remote_fallback_configured": bool(
            REMOTE_AI_BASE_URL and REMOTE_AI_API_KEY and REMOTE_AI_MODEL
        ),
    }


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
                OLLAMA_CHAT_URL,
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [
                        {
                            "role": "system",
                            "content": "Write one concise, specific entertainment recommendation explanation.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "stream": False,
                },
            )
        response.raise_for_status()
        message = response.json().get("message", {})
        return {"explanation": message.get("content", "").strip(), "provider": "ollama"}
    except httpx.HTTPError:
        pass

    if REMOTE_AI_BASE_URL and REMOTE_AI_API_KEY and REMOTE_AI_MODEL:
        try:
            async with httpx.AsyncClient(timeout=35) as client:
                response = await client.post(
                    f"{REMOTE_AI_BASE_URL.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {REMOTE_AI_API_KEY}"},
                    json={
                        "model": REMOTE_AI_MODEL,
                        "messages": [
                            {
                                "role": "system",
                                "content": "Write one concise, specific entertainment recommendation explanation.",
                            },
                            {"role": "user", "content": prompt},
                        ],
                        "temperature": 0.55,
                        "max_tokens": 220,
                    },
                )
            response.raise_for_status()
            choices = response.json().get("choices", [])
            if choices:
                content = choices[0].get("message", {}).get("content", "").strip()
                if content:
                    return {"explanation": content, "provider": "openai-compatible"}
        except httpx.HTTPError:
            pass

    return {
        "explanation": f"{request.content_title} matches the themes and emotional tone in your recent activity.",
        "provider": "deterministic-fallback",
    }
