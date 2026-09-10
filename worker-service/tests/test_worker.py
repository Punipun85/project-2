from __future__ import annotations

import asyncio
import pytest

from app.config import Settings
from app.jobs import JobManager


def settings() -> Settings:
    return Settings(
        worker_api_key="x" * 32,
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-key",
        pipeline_command=("python", "data-pipeline/main.py"),
        embedding_command=("npm", "run", "embeddings:generate"),
        project_root="/workspace",
        daily_hour_utc=2,
        weekly_day="sun",
        port=8200,
        log_level="INFO",
    )


def test_environment_validation_rejects_short_worker_key():
    value = settings()
    object.__setattr__(value, "worker_api_key", "short")
    with pytest.raises(RuntimeError, match="at least 24"):
        value.validate()


def test_daily_job_runs_existing_pipeline_before_existing_embedding_generator():
    calls: list[tuple[str, ...]] = []

    async def runner(command: tuple[str, ...], cwd: str):
        assert cwd == "/workspace"
        calls.append(command)
        return {"ok": True}

    manager = JobManager(settings(), runner=runner)
    result = asyncio.run(manager._run("daily_content_sync"))
    assert calls == [settings().pipeline_command, settings().embedding_command]
    assert result["pipeline"]["ok"] is True


def test_unknown_job_is_rejected_without_running_commands():
    async def runner(command: tuple[str, ...], cwd: str):
        raise AssertionError("runner must not execute")

    manager = JobManager(settings(), runner=runner)
    with pytest.raises(ValueError, match="Unknown job"):
        asyncio.run(manager._run("unknown"))


def test_scheduler_contains_daily_weekly_and_cleanup_jobs():
    from app.main import schedule_definitions

    definitions = schedule_definitions()
    assert set(definitions) == {"daily_content_sync", "weekly_analytics", "cleanup"}
    assert all(trigger.timezone is not None for trigger in definitions.values())
