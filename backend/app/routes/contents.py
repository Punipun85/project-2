from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..models import Content, ContentType
from ..schemas import ContentRead
from ..services.recommendation import semantic_rank

router = APIRouter(tags=["contents"])


@router.get("/contents", response_model=list[ContentRead])
def list_contents(
    content_type: ContentType | None = Query(default=None, alias="type"),
    search: str | None = None,
    limit: int = Query(default=24, ge=1, le=100),
    session: Session = Depends(get_session),
) -> list[Content]:
    statement = select(Content).order_by(Content.popularity.desc()).limit(limit)
    if content_type:
        statement = statement.where(Content.type == content_type)
    if search:
        statement = statement.where(Content.title.ilike(f"%{search}%"))
    return list(session.scalars(statement))


@router.get("/contents/{content_id}", response_model=ContentRead)
def get_content(content_id: int, session: Session = Depends(get_session)) -> Content:
    content = session.get(Content, content_id)
    if not content:
        raise HTTPException(status_code=404, detail="Content not found")
    return content


@router.post("/search/semantic")
def semantic_search(payload: dict, session: Session = Depends(get_session)) -> dict:
    query = str(payload.get("query", "")).strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    candidates = list(session.scalars(select(Content).order_by(Content.popularity.desc()).limit(500)))
    matches = semantic_rank(candidates, query, min(int(payload.get("limit", 8)), 20))
    return {"data": [{"content": ContentRead.model_validate(match.content), "score": match.final_score, "reason": match.reason} for match in matches]}
