"""FastAPI entry point for NexaPlay AI Batch 3."""

from __future__ import annotations

from functools import lru_cache

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .interactions import InteractionService
from .rag import RAGService
from .recommendation import RecommendationService
from .schemas import ChatRequest, InteractionRequest, RecommendRequest, SearchRequest
from .vector_search import VectorSearchService


app = FastAPI(title="NexaPlay AI Intelligence API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def search_service() -> VectorSearchService:
    return VectorSearchService()


@lru_cache(maxsize=1)
def recommendation_service() -> RecommendationService:
    return RecommendationService(search=search_service())


@lru_cache(maxsize=1)
def rag_service() -> RAGService:
    return RAGService(search=search_service())


@lru_cache(maxsize=1)
def interaction_service() -> InteractionService:
    return InteractionService()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "nexaplay-ai-batch-3"}


@app.post("/ai/search")
def semantic_search(request: SearchRequest) -> list[dict]:
    try:
        records = search_service().search_similar_content(
            request.query, request.limit, request.content_type
        )
        return [
            {
                **record,
                "reason": f"Semantic similarity {float(record.get('similarity') or 0):.2f}",
            }
            for record in records
        ]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Semantic search unavailable: {exc}") from exc


@app.post("/ai/recommend")
def recommend(request: RecommendRequest) -> list[dict]:
    try:
        return recommendation_service().recommend(
            str(request.user_id) if request.user_id else None,
            request.query,
            request.limit,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Recommendation unavailable: {exc}") from exc


@app.post("/ai/chat")
async def chat(request: ChatRequest) -> dict:
    try:
        return await rag_service().answer(request.message, request.limit)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"AI assistant unavailable: {exc}") from exc


@app.post("/ai/interactions", status_code=201)
def track_interaction(request: InteractionRequest) -> dict:
    try:
        return interaction_service().track(
            request.user_id,
            request.interaction_type,
            request.content_id,
            request.rating,
            request.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Interaction tracking unavailable: {exc}") from exc
