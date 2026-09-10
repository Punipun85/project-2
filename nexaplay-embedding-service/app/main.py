"""FastAPI application for NexaPlay semantic embeddings."""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from .auth import require_api_key
from .config import Settings, get_settings
from .embedding import EmbeddingService


settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("nexaplay.embedding")


class EmbedRequest(BaseModel):
    text: str = Field(max_length=settings.max_text_length)

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("text must not be empty")
        return normalized


class EmbedResponse(BaseModel):
    embedding: list[float]
    model: str
    dimension: int


@asynccontextmanager
async def lifespan(application: FastAPI):
    service = EmbeddingService(settings.model_name, settings.expected_dimension)
    application.state.embedding_service = service
    await asyncio.to_thread(service.load)
    yield


app = FastAPI(
    title="NexaPlay Embedding Service",
    version="1.0.0",
    lifespan=lifespan,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )


def service_from(request: Request) -> EmbeddingService:
    return request.app.state.embedding_service


@app.middleware("http")
async def access_log(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled request failure path=%s", request.url.path)
        raise
    logger.info(
        "request method=%s path=%s status=%s duration_ms=%.2f",
        request.method,
        request.url.path,
        response.status_code,
        (time.perf_counter() - started) * 1000,
    )
    return response


@app.get("/health")
def health(request: Request):
    service = service_from(request)
    if not service.is_loaded:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "degraded",
                "model_loaded": False,
                "error": "model_loading_failed",
            },
        )
    return {"status": "ok", "model_loaded": True}


@app.post(
    "/ai/embed",
    response_model=EmbedResponse,
    dependencies=[Depends(require_api_key)],
)
async def embed(
    payload: EmbedRequest,
    service: Annotated[EmbeddingService, Depends(service_from)],
) -> EmbedResponse:
    if not service.is_loaded:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embedding model is unavailable",
        )
    try:
        vector = await asyncio.wait_for(
            asyncio.to_thread(service.encode, payload.text),
            timeout=settings.request_timeout_seconds,
        )
    except TimeoutError as exc:
        logger.warning("Embedding request timed out")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Embedding generation timed out",
        ) from exc
    except Exception as exc:
        logger.exception("Embedding generation failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embedding generation failed",
        ) from exc
    return EmbedResponse(
        embedding=vector,
        model=service.model_name,
        dimension=len(vector),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, workers=1)
