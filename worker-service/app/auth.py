import hmac
from typing import Annotated

from fastapi import Header, HTTPException

from .config import get_settings


def require_api_key(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = f"Bearer {get_settings().worker_api_key}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid worker API key")
