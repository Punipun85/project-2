"""Constant-time Bearer authentication for the internal API."""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings


bearer = HTTPBearer(auto_error=False)


def require_api_key(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    supplied = credentials.credentials if credentials else ""
    if not supplied or not hmac.compare_digest(supplied, settings.service_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )
