from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from .config import Settings

logger = logging.getLogger("nexaplay.worker")
Runner = Callable[[tuple[str, ...], str], Awaitable[dict[str, Any]]]


async def run_command(command: tuple[str, ...], cwd: str) -> dict[str, Any]:
    process = await asyncio.create_subprocess_exec(
        *command, cwd=cwd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await process.communicate()
    if process.returncode:
        raise RuntimeError(f"command_failed_{process.returncode}: {stderr.decode(errors='replace')[-800:]}")
    return {"command": command[0], "output_tail": stdout.decode(errors="replace")[-500:]}


class JobManager:
    def __init__(self, settings: Settings, runner: Runner = run_command):
        self.settings = settings
        self.runner = runner
        self._locks: dict[str, asyncio.Lock] = {}

    async def _supabase(self, path: str, method: str = "POST", body: Any = None) -> httpx.Response:
        headers = {
            "apikey": self.settings.supabase_service_role_key,
            "authorization": f"Bearer {self.settings.supabase_service_role_key}",
            "content-type": "application/json",
            "prefer": "return=representation",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            return await client.request(method, f"{self.settings.supabase_url}/rest/v1/{path}", headers=headers, json=body)

    async def execute(self, name: str) -> dict[str, Any]:
        lock = self._locks.setdefault(name, asyncio.Lock())
        if lock.locked():
            return {"job": name, "status": "skipped", "reason": "already_running"}
        async with lock:
            started = time.perf_counter()
            run_id: int | None = None
            try:
                created = await self._supabase("admin_job_runs", body={"job_name": name, "status": "running"})
                if created.is_success:
                    rows = created.json()
                    run_id = rows[0]["id"] if rows else None
                metrics = await self._run(name)
                duration = round((time.perf_counter() - started) * 1000)
                if run_id:
                    await self._supabase(f"admin_job_runs?id=eq.{run_id}", "PATCH", {"status": "succeeded", "finished_at": datetime.now(UTC).isoformat(), "duration_ms": duration, "metrics": metrics})
                logger.info("job_succeeded", extra={"event": "job_succeeded", "job": name, "duration_ms": duration, "status": "succeeded"})
                return {"job": name, "status": "succeeded", "duration_ms": duration, "metrics": metrics}
            except Exception as error:
                duration = round((time.perf_counter() - started) * 1000)
                if run_id:
                    await self._supabase(f"admin_job_runs?id=eq.{run_id}", "PATCH", {"status": "failed", "finished_at": datetime.now(UTC).isoformat(), "duration_ms": duration, "error_type": type(error).__name__, "error_message": str(error)[:500]})
                logger.exception("job_failed", extra={"event": "job_failed", "job": name, "duration_ms": duration, "error_type": type(error).__name__, "status": "failed"})
                raise

    async def _run(self, name: str) -> dict[str, Any]:
        if name == "daily_content_sync":
            pipeline = await self.runner(self.settings.pipeline_command, self.settings.project_root)
            embeddings = await self.runner(self.settings.embedding_command, self.settings.project_root)
            return {"pipeline": pipeline, "embeddings": embeddings}
        if name == "weekly_analytics":
            response = await self._supabase("rpc/refresh_daily_analytics", body={})
            response.raise_for_status()
            return {"snapshot": response.json()}
        if name == "cleanup":
            checks = await self._supabase("rpc/cleanup_operational_history", body={})
            checks.raise_for_status()
            return checks.json()
        raise ValueError(f"Unknown job: {name}")
