"""Environment-backed service configuration."""

from __future__ import annotations

import os
import warnings
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv


load_dotenv()


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_key: str
    service_api_key: str
    embedding_api_url: str
    embedding_api_key: str
    embedding_model: str
    request_timeout_seconds: int
    port: int
    cors_origins: tuple[str, ...]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    legacy_supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if not service_role_key and legacy_supabase_key:
        warnings.warn(
            "SUPABASE_KEY is deprecated; use SUPABASE_SERVICE_ROLE_KEY",
            DeprecationWarning,
            stacklevel=2,
        )
        service_role_key = legacy_supabase_key
    values = {
        "SUPABASE_URL": os.getenv("SUPABASE_URL", "").strip().rstrip("/"),
        "SUPABASE_SERVICE_ROLE_KEY": service_role_key,
        "RECOMMENDATION_API_KEY": os.getenv("RECOMMENDATION_API_KEY", "").strip(),
        "EMBEDDING_API_URL": os.getenv("EMBEDDING_API_URL", "").strip(),
        "EMBEDDING_API_KEY": os.getenv("EMBEDDING_API_KEY", "").strip(),
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        raise RuntimeError(f"Missing required configuration: {', '.join(missing)}")
    origins = tuple(
        item.strip().rstrip("/")
        for item in os.getenv("CORS_ORIGINS", "").split(",")
        if item.strip()
    )
    return Settings(
        supabase_url=values["SUPABASE_URL"],
        supabase_key=values["SUPABASE_SERVICE_ROLE_KEY"],
        service_api_key=values["RECOMMENDATION_API_KEY"],
        embedding_api_url=values["EMBEDDING_API_URL"],
        embedding_api_key=values["EMBEDDING_API_KEY"],
        embedding_model=os.getenv(
            "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        ).strip(),
        request_timeout_seconds=_positive_int("REQUEST_TIMEOUT_SECONDS", 30),
        port=_positive_int("PORT", 8100),
        cors_origins=origins,
    )
