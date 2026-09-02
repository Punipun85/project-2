"""Environment-backed configuration for the entertainment ingestion pipeline."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field, field_validator


PIPELINE_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PIPELINE_ROOT / ".env"


class Settings(BaseModel):
    """Validated runtime configuration loaded from ``data-pipeline/.env``."""

    tmdb_api_key: str | None = None
    mal_client_id: str | None = None
    mal_client_secret: str | None = None
    mal_access_token: str | None = None
    mal_refresh_token: str | None = None
    mal_redirect_uri: str | None = None
    supabase_url: str | None = None
    supabase_key: str | None = None

    http_timeout_seconds: float = Field(default=30.0, gt=0)
    request_retries: int = Field(default=4, ge=1, le=10)
    tmdb_request_delay: float = Field(default=0.05, ge=0)
    mal_request_delay: float = Field(default=0.20, ge=0)
    import_pages: int = Field(default=1, ge=1)
    import_batch_size: int = Field(default=100, ge=1, le=100)
    cast_limit: int = Field(default=20, ge=1, le=100)
    log_level: str = "INFO"

    @field_validator(
        "tmdb_api_key",
        "mal_client_id",
        "mal_client_secret",
        "mal_access_token",
        "mal_refresh_token",
        "mal_redirect_uri",
        "supabase_url",
        "supabase_key",
        mode="before",
    )
    @classmethod
    def empty_strings_are_none(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if not value or value.startswith("YOUR_") or "xxxx.supabase.co" in value:
                return None
        return value

    @field_validator("log_level")
    @classmethod
    def normalize_log_level(cls, value: str) -> str:
        return value.strip().upper() or "INFO"

    @classmethod
    def from_environment(cls) -> "Settings":
        load_dotenv(ENV_FILE)
        return cls(
            tmdb_api_key=os.getenv("TMDB_API_KEY"),
            mal_client_id=os.getenv("MAL_CLIENT_ID"),
            mal_client_secret=os.getenv("MAL_CLIENT_SECRET"),
            mal_access_token=os.getenv("MAL_ACCESS_TOKEN"),
            mal_refresh_token=os.getenv("MAL_REFRESH_TOKEN"),
            mal_redirect_uri=os.getenv("MAL_REDIRECT_URI"),
            supabase_url=os.getenv("SUPABASE_URL"),
            supabase_key=os.getenv("SUPABASE_KEY"),
            http_timeout_seconds=os.getenv("HTTP_TIMEOUT_SECONDS", "30"),
            request_retries=os.getenv("REQUEST_RETRIES", "4"),
            tmdb_request_delay=os.getenv("TMDB_REQUEST_DELAY", "0.05"),
            mal_request_delay=os.getenv("MAL_REQUEST_DELAY", "0.20"),
            import_pages=os.getenv("IMPORT_PAGES", "1"),
            import_batch_size=os.getenv("IMPORT_BATCH_SIZE", "100"),
            cast_limit=os.getenv("CAST_LIMIT", "20"),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
        )

    def require_tmdb(self) -> str:
        if not self.tmdb_api_key:
            raise RuntimeError(f"TMDB_API_KEY belum dikonfigurasi di {ENV_FILE}")
        return self.tmdb_api_key

    def require_mal(self) -> str:
        if not self.mal_client_id:
            raise RuntimeError(f"MAL_CLIENT_ID belum dikonfigurasi di {ENV_FILE}")
        return self.mal_client_id

    def require_supabase(self) -> tuple[str, str]:
        if not self.supabase_url or not self.supabase_key:
            raise RuntimeError(
                f"SUPABASE_URL dan SUPABASE_KEY service-role harus dikonfigurasi di {ENV_FILE}"
            )
        return self.supabase_url, self.supabase_key


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_environment()
