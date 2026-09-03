"""Runtime configuration shared by the Batch 3 services."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]

# Local development already keeps provider credentials with the ingestion
# pipeline. Loading them read-only avoids duplicating secrets in a new file.
for env_file in (
    PROJECT_ROOT / ".env",
    PROJECT_ROOT / "data-pipeline" / ".env",
    PROJECT_ROOT / ".dev.vars",
):
    load_dotenv(env_file, override=False)

MODEL_NAME = os.getenv(
    "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
)
EMBEDDING_DIMENSIONS = 384
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()
OLLAMA_CHAT_URL = os.getenv("OLLAMA_CHAT_URL", "http://ASUS:11434/api/chat").strip()
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b").strip()
AI_LOG_PATH = PROJECT_ROOT / "logs" / "ai_pipeline.log"


def require_supabase() -> tuple[str, str]:
    """Return configured Supabase credentials or fail with a useful message."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_KEY are required. Configure them in "
            "data-pipeline/.env or the process environment."
        )
    return SUPABASE_URL, SUPABASE_KEY
