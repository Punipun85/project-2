"""FastAPI entrypoint for NexaPlay Batch 2 recommendations."""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import require_api_key
from .config import get_settings
from .recommender import RecommendationEngine


settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("nexaplay.recommendations")

app = FastAPI(title="NexaPlay Recommendation Service", version="2.0.0")
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )


class RecommendationRequest(BaseModel):
    user_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=50)
    query: str | None = Field(default=None, max_length=500)
    content_type: str | None = None
    series_type: str | None = None
    request_hour: int | None = Field(default=None, ge=0, le=23)


@lru_cache(maxsize=1)
def engine() -> RecommendationEngine:
    return RecommendationEngine(settings)


@app.middleware("http")
async def access_log(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    logger.info(
        "request method=%s path=%s status=%s duration_ms=%.2f",
        request.method,
        request.url.path,
        response.status_code,
        (time.perf_counter() - started) * 1000,
    )
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "nexaplay-recommendations"}


@app.post("/recommendations", dependencies=[Depends(require_api_key)])
def recommendations(payload: RecommendationRequest) -> list[dict]:
    try:
        return engine().recommend(
            str(payload.user_id) if payload.user_id else None,
            payload.limit,
            payload.query,
            payload.content_type,
            payload.series_type,
            payload.request_hour,
        )
    except Exception as exc:
        logger.exception("Recommendation request failed")
        raise HTTPException(status_code=503, detail="Recommendation service unavailable") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, workers=1)
