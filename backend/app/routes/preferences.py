from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..models import UserPreference
from ..schemas import PreferenceRead, PreferenceUpsert

router = APIRouter(tags=["preferences"])


@router.get("/user/preferences", response_model=PreferenceRead)
def get_preferences(user_id: str, session: Session = Depends(get_session)) -> UserPreference:
    preference = session.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if not preference:
        raise HTTPException(status_code=404, detail="Preferences not found")
    return preference


@router.put("/user/preferences", response_model=PreferenceRead)
def upsert_preferences(user_id: str, payload: PreferenceUpsert, session: Session = Depends(get_session)) -> UserPreference:
    preference = session.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if not preference:
        preference = UserPreference(user_id=user_id)
        session.add(preference)
    for field, value in payload.model_dump(mode="json").items():
        setattr(preference, field, value)
    session.commit()
    session.refresh(preference)
    return preference
