from __future__ import annotations

from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, HTTPException, Request

from .auth import require_api_key
from .config import get_settings
from .jobs import JobManager
from .logging_config import configure_logging

settings = get_settings()
configure_logging(settings.log_level)


def schedule_definitions():
    return {
        "daily_content_sync": CronTrigger(hour=settings.daily_hour_utc, minute=0, timezone="UTC"),
        "weekly_analytics": CronTrigger(day_of_week=settings.weekly_day, hour=4, minute=0, timezone="UTC"),
        "cleanup": CronTrigger(day=1, hour=5, minute=0, timezone="UTC"),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate()
    manager = JobManager(settings)
    scheduler = AsyncIOScheduler(timezone="UTC")
    for name, trigger in schedule_definitions().items():
        scheduler.add_job(manager.execute, trigger, args=[name], id=name, replace_existing=True, max_instances=1, coalesce=True)
    scheduler.start()
    app.state.manager = manager
    app.state.scheduler = scheduler
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="NexaPlay Production Worker", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health(request: Request):
    scheduler = request.app.state.scheduler
    return {"status": "ok" if scheduler.running else "degraded", "scheduler_running": scheduler.running, "jobs": len(scheduler.get_jobs())}


@app.get("/jobs", dependencies=[Depends(require_api_key)])
def jobs(request: Request):
    return [{"id": job.id, "next_run_time": job.next_run_time} for job in request.app.state.scheduler.get_jobs()]


@app.post("/jobs/{job_name}/run", dependencies=[Depends(require_api_key)])
async def run_job(job_name: str, request: Request):
    if job_name not in schedule_definitions():
        raise HTTPException(status_code=404, detail="Unknown job")
    try:
        return await request.app.state.manager.execute(job_name)
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Job failed: {type(error).__name__}") from error
