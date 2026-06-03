"""
Analytics middleware.

Intercepts every API request, extracts the session ID from the X-Session-Id
header, infers which workflow step the call belongs to, then fire-and-forgets
a write to the SQLite analytics store.  Never blocks the response path.
"""
from __future__ import annotations

import asyncio
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from analytics import db

# Paths that produce too much noise or are internal — skip them
SKIP_PREFIXES = (
    "/api/health",
    "/api/analytics",
    "/docs",
    "/openapi.json",
    "/redoc",
)

# Map URL prefix → workflow step number (None = step is whatever the session is on)
STEP_MAP: list[tuple[str, int | None]] = [
    ("/api/chat",            None),
    ("/api/topics",          1),
    ("/api/systems",         2),
    ("/api/queries",         3),
    ("/api/search",          3),
    ("/api/recognise",       4),
    ("/api/matrix",          5),
    ("/api/synthesis",       6),
    ("/api/gaps",            7),
    ("/api/reasoning",       7),
    ("/api/final-question",  8),
    ("/api/bridge",          None),
    ("/api/prompts",         None),
    ("/api/assistant",       None),
]


def _infer_step(path: str) -> int | None:
    for prefix, step in STEP_MAP:
        if path.startswith(prefix):
            return step
    return None


class AnalyticsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        if any(path.startswith(p) for p in SKIP_PREFIXES):
            return await call_next(request)

        session_id = request.headers.get("X-Session-Id", "").strip()
        user_agent = request.headers.get("User-Agent", "")
        step = _infer_step(path)

        start = time.time()
        response = await call_next(request)
        duration_ms = round((time.time() - start) * 1000, 2)

        if session_id:
            asyncio.create_task(_record(
                session_id=session_id,
                step=step,
                endpoint=path,
                method=request.method,
                status_code=response.status_code,
                duration_ms=duration_ms,
                user_agent=user_agent,
            ))

        return response


async def _record(
    session_id: str, step: int | None, endpoint: str, method: str,
    status_code: int, duration_ms: float, user_agent: str,
) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None, _sync_record,
        session_id, step, endpoint, method, status_code, duration_ms, user_agent,
    )


def _sync_record(
    session_id: str, step: int | None, endpoint: str, method: str,
    status_code: int, duration_ms: float, user_agent: str,
) -> None:
    try:
        db.log_event(
            session_id=session_id,
            step=step,
            event_type="api_call",
            endpoint=endpoint,
            method=method,
            status_code=status_code,
            duration_ms=duration_ms,
        )
        db.upsert_session(
            session_id=session_id,
            current_step=step,
            user_agent=user_agent,
        )
    except Exception as e:
        print(f"[ANALYTICS] Failed to record event: {e}")
