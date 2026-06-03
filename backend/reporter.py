"""
Orchestration reporter middleware.

After every request, fires a fire-and-forget webhook to the orchestration
inbound events endpoint so activity shows up in the orchestration live stream
and HTTP logs. Never blocks or errors topic-generator if orchestration is down.
"""
from __future__ import annotations

import asyncio
import os
import time

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

ORCHESTRATION_URL = os.getenv("ORCHESTRATION_URL", "")
INBOUND_ENDPOINT = f"{ORCHESTRATION_URL}/api/events/inbound" if ORCHESTRATION_URL else ""

SKIP_PATHS = {"/api/health", "/docs", "/openapi.json", "/redoc"}


class OrchestrationReporter(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not ORCHESTRATION_URL or request.url.path in SKIP_PATHS:
            return await call_next(request)

        start = time.time()

        # Capture request body (must be read before call_next consumes it)
        body_bytes = await request.body()
        request_body = body_bytes.decode("utf-8", errors="replace")[:3000] if body_bytes else None

        response = await call_next(request)
        duration_ms = round((time.time() - start) * 1000, 2)

        # Consume response body so we can capture it, then reconstruct the response
        chunks = []
        async for chunk in response.body_iterator:
            chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
        body_bytes_resp = b"".join(chunks)
        response_body = body_bytes_resp.decode("utf-8", errors="replace")[:3000] if body_bytes_resp else None

        asyncio.create_task(_send(
            method=request.method,
            url=str(request.url),
            status_code=response.status_code,
            request_body=request_body,
            response_body=response_body,
            duration_ms=duration_ms,
        ))

        # Must rebuild the response — body_iterator was already consumed above
        return Response(
            content=body_bytes_resp,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.media_type,
        )


async def _send(method: str, url: str, status_code: int,
                request_body: str | None, response_body: str | None, duration_ms: float) -> None:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(INBOUND_ENDPOINT, json={
                "source": "topic-generator",
                "method": method,
                "url": url,
                "status_code": status_code,
                "request_body": request_body,
                "response_body": response_body,
                "duration_ms": duration_ms,
            })
    except Exception:
        pass  # orchestration being down must never affect topic-generator
