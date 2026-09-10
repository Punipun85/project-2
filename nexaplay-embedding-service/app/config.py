"""Environment-backed service configuration."""

from __future__ import annotations

import os
import warnings
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv


load_dotenv()


DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def _positive_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


def _origins() -> tuple[str, ...]:
    raw = os.getenv("CORS_ORIGINS", "").strip()
    return tuple(origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip())


@dataclass(frozen=True)
class Settings:
    model_name: str
    api_key: str
    port: int
    request_timeout_seconds: int
    max_text_length: int
    cors_origins: tuple[str, ...]
    log_level: str

    @property
    def expected_dimension(self) -> int:
        return 384


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    api_key = os.getenv("EMBEDDING_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("EMBEDDING_API_KEY must be configured")
    model_name = os.getenv("EMBEDDING_MODEL", "").strip()
    legacy_model_name = os.getenv("MODEL_NAME", "").strip()
    if not model_name and legacy_model_name:
        warnings.warn(
            "MODEL_NAME is deprecated; use EMBEDDING_MODEL",
            DeprecationWarning,
            stacklevel=2,
        )
        model_name = legacy_model_name
    model_name = model_name or DEFAULT_MODEL
    if not model_name:
        raise RuntimeError("EMBEDDING_MODEL must not be blank")
    return Settings(
        model_name=model_name,
        api_key=api_key,
        port=_positive_int("PORT", 8000),
        request_timeout_seconds=_positive_int("REQUEST_TIMEOUT_SECONDS", 30),
        max_text_length=_positive_int("MAX_TEXT_LENGTH", 12000),
        cors_origins=_origins(),
        log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO",
    )
