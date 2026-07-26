"""
Analytics query endpoints.

All reads are synchronous (FastAPI runs sync handlers in a thread pool).
The POST /event endpoint receives explicit frontend events (step transitions,
heartbeats, session starts) that complement the middleware's API call log.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from analytics import db

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


# ── Frontend event intake ─────────────────────────────────────────────────────

class FrontendEvent(BaseModel):
    session_id: str
    event_type: str               # step_change | session_start | heartbeat
    step: int | None = None
    detail: dict | None = None    # arbitrary extra data (from_step, to_step, domain…)


@router.post("/event")
def track_frontend_event(req: FrontendEvent) -> dict[str, bool]:
    """Receive explicit lifecycle events from the frontend."""
    domain = (req.detail or {}).get("domain")
    db.log_event(
        session_id=req.session_id,
        step=req.step,
        event_type=req.event_type,
        endpoint=None,
        method=None,
        status_code=None,
        duration_ms=None,
        detail=req.detail,
    )
    db.upsert_session(
        session_id=req.session_id,
        current_step=req.step,
        user_agent=None,
        domain=domain if isinstance(domain, str) else None,
    )
    return {"ok": True}


# ── Query endpoints ───────────────────────────────────────────────────────────

@router.get("/overview")
def get_overview() -> dict[str, Any]:
    """High-level metrics: totals, completion rate, error rate."""
    return db.get_overview()


@router.get("/sessions")
def list_sessions() -> list[dict[str, Any]]:
    """All sessions, most recent first, with per-session event counts."""
    return db.get_all_sessions()


@router.get("/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    """Full chronological event log for one session."""
    events = db.get_session_events(session_id)
    return {"session_id": session_id, "events": events}


@router.get("/funnel")
def get_funnel() -> list[dict[str, Any]]:
    """
    Per-step drop-off: how many sessions reached each step,
    how many stopped there, and the cumulative % that got that far.
    """
    return db.get_funnel()


@router.get("/step-timings")
def get_step_timings() -> list[dict[str, Any]]:
    """
    Average / min / max time users spend on each step before navigating away,
    plus how often they went *back* from that step.
    """
    return db.get_step_timings()


@router.get("/stuck")
def get_stuck(
    idle_minutes: int = Query(default=15, ge=1, le=120),
) -> list[dict[str, Any]]:
    """
    Sessions that look stuck: no activity for idle_minutes minutes,
    haven't completed the flow (max_step < 9), and have been running
    for at least 3 minutes so fresh sessions aren't included.
    """
    return db.get_stuck_sessions(idle_minutes)


@router.get("/regeneration")
def get_regeneration(
    threshold: int = Query(default=3, ge=2, le=20),
) -> list[dict[str, Any]]:
    """
    Sessions that retried the same AI generation endpoint >= threshold times.
    High counts indicate dissatisfaction with outputs on a particular step.
    """
    return db.get_regeneration_sessions(threshold)
