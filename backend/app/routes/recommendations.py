from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..models import Content, UserPreference
from ..schemas import ContentRead, RecommendationRead
from ..services.recommendation import rank_contents

router = APIRouter(tags=["recommendations"])


@router.get("/recommendations", response_model=list[RecommendationRead])
def recommendations(
    user_id: str = "demo-user",
    limit: int = Query(default=12, ge=1, le=24),
    session: Session = Depends(get_session),
) -> list[RecommendationRead]:
    preference = session.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    candidates = list(session.scalars(select(Content).order_by(Content.popularity.desc()).limit(500)))
    ranked = rank_contents(candidates, preference, limit)
    return [RecommendationRead(content=ContentRead.model_validate(item.content), content_score=item.content_score, collaborative_score=item.collaborative_score, final_score=item.final_score, reason=item.reason) for item in ranked]
