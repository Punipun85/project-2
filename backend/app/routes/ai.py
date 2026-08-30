from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..models import Content
from ..schemas import ChatRequest, ChatResponse, ContentRead, RecommendationRead
from ..services.recommendation import infer_types, semantic_rank

router = APIRouter(tags=["ai"])


@router.post("/ai/chat", response_model=ChatResponse)
def chat(request: ChatRequest, session: Session = Depends(get_session)) -> ChatResponse:
    candidates = list(session.scalars(select(Content).order_by(Content.popularity.desc()).limit(500)))
    matches = semantic_rank(candidates, request.message, 3)
    titles = ", ".join(item.content.title for item in matches)
    answer = f"I found {titles}. {matches[0].reason}" if matches else "I need one more signal: try a mood, language, theme, or content type."
    return ChatResponse(
        answer=answer,
        detected_types=infer_types(request.message),
        recommendations=[RecommendationRead(content=ContentRead.model_validate(item.content), content_score=item.content_score, collaborative_score=item.collaborative_score, final_score=item.final_score, reason=item.reason) for item in matches],
    )
