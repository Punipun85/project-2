from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from functools import lru_cache


def _command(name: str, default: list[str]) -> tuple[str, ...]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return tuple(default)
    value = json.loads(raw)
    if not isinstance(value, list) or not all(isinstance(part, str) and part for part in value):
        raise ValueError(f"{name} must be a JSON array of command arguments")
    return tuple(value)


@dataclass(frozen=True)
class Settings:
    worker_api_key: str
    supabase_url: str
    supabase_service_role_key: str
    pipeline_command: tuple[str, ...]
    embedding_command: tuple[str, ...]
    project_root: str
    daily_hour_utc: int
    weekly_day: str
    port: int
    log_level: str

    def validate(self) -> None:
        missing = [name for name, value in {
            "WORKER_API_KEY": self.worker_api_key,
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_SERVICE_ROLE_KEY": self.supabase_service_role_key,
        }.items() if not value]
        if missing:
            raise RuntimeError("Missing required worker configuration: " + ", ".join(missing))
        if len(self.worker_api_key) < 24:
            raise RuntimeError("WORKER_API_KEY must contain at least 24 characters")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        worker_api_key=os.getenv("WORKER_API_KEY", "").strip(),
        supabase_url=os.getenv("SUPABASE_URL", "").strip().rstrip("/"),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip(),
        pipeline_command=_command("PIPELINE_COMMAND", [sys.executable, "data-pipeline/main.py"]),
        embedding_command=_command("EMBEDDING_COMMAND", ["npm", "run", "embeddings:generate"]),
        project_root=os.getenv("PROJECT_ROOT", "/workspace"),
        daily_hour_utc=min(max(int(os.getenv("PIPELINE_DAILY_HOUR_UTC", "2")), 0), 23),
        weekly_day=os.getenv("ANALYTICS_WEEKLY_DAY", "sun").lower(),
        port=int(os.getenv("PORT", "8200")),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
    )
