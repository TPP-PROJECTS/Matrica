"""
Durable project (session) store.

The frontend serialises the entire app state into a SessionSnapshot JSON object.
These endpoints persist that blob server-side (SQLite) so a researcher's projects
survive a browser-cache clear and are available across devices — the frontend keeps
localStorage only as an instant-load offline cache and writes through to here.

Single-user / self-hosted deployment: projects are a single global collection,
no per-user scoping.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from analytics import db

router = APIRouter(prefix="/projects", tags=["Projects"])


class ProjectMeta(BaseModel):
    id: str
    title: str
    createdAt: str
    updatedAt: str
    currentStep: int
    topicPreview: str


def _derive_topic_preview(snapshot: dict[str, Any]) -> str:
    """Mirror the frontend buildMeta preview: selected topic title, else domain."""
    for topic in snapshot.get("topics") or []:
        if topic.get("selected"):
            return topic.get("title") or ""
    return (snapshot.get("profile") or {}).get("domain") or ""


@router.get("", response_model=list[ProjectMeta])
def list_projects() -> list[dict]:
    rows = db.list_projects()
    return [
        {
            "id": r["id"],
            "title": r["title"] or "Untitled Session",
            "createdAt": r["created_at"] or "",
            "updatedAt": r["updated_at"] or "",
            "currentStep": r["current_step"] or 1,
            "topicPreview": r["topic_preview"] or "",
        }
        for r in rows
    ]


@router.get("/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    raw = db.get_project(project_id)
    if raw is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return json.loads(raw)


@router.put("/{project_id}")
def put_project(project_id: str, snapshot: dict[str, Any]) -> dict[str, bool]:
    if snapshot.get("sessionId") and snapshot["sessionId"] != project_id:
        raise HTTPException(status_code=400, detail="sessionId does not match path id")
    db.upsert_project(
        project_id=project_id,
        title=snapshot.get("sessionTitle") or "Untitled Session",
        created_at=snapshot.get("createdAt"),
        updated_at=snapshot.get("updatedAt"),
        current_step=snapshot.get("currentStep") or 1,
        topic_preview=_derive_topic_preview(snapshot),
        snapshot=json.dumps(snapshot),
    )
    return {"ok": True}


@router.delete("/{project_id}")
def delete_project(project_id: str) -> dict[str, bool]:
    db.delete_project(project_id)
    return {"ok": True}
