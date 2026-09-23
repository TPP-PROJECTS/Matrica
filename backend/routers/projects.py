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
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

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
    # Which step numbering `currentStep` was written under. Absent on projects
    # saved before the workflow was renumbered; the client maps those forward.
    stepSchema: int | None = None
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
            "stepSchema": r.get("step_schema"),
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


# ── Version checkpoints ───────────────────────────────────────────────────────
#
# A checkpoint is a full, immutable copy of a project at a moment the user (or
# the workflow) considered worth being able to return to. It is deliberately not
# the same thing as the project list: that shows *different* reviews, this shows
# earlier states of *this* one.
#
# Undo covers the last few actions within a session. This covers the case undo
# cannot: coming back the next day and wanting the matrix as it stood before a
# re-extraction, or before a supervisor's suggested restructure.

STEP_NAMES = {
    1: "Chat & Define Topic", 2: "Matrix Initial", 3: "System Review",
    4: "Explore & Search", 5: "Select Paper", 6: "Matrix Table",
    7: "Synthesis", 8: "Gap & Statement", 9: "Final Question",
}


class VersionMeta(BaseModel):
    id: str
    projectId: str
    createdAt: str
    step: int
    stepName: str
    label: str
    trigger: str


class CreateVersionRequest(BaseModel):
    label: str = ""
    # 'manual' when the user asked for it, 'step_complete' when the workflow
    # took one automatically on advancing a step.
    trigger: str = "manual"
    snapshot: dict[str, Any]


def _version_row_to_meta(row: dict[str, Any]) -> dict[str, Any]:
    step = row["step"] or 1
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "createdAt": row["created_at"] or "",
        "step": step,
        "stepName": row["step_name"] or STEP_NAMES.get(step, ""),
        "label": row["label"] or "",
        "trigger": row["trigger"] or "manual",
    }


@router.get("/{project_id}/versions", response_model=list[VersionMeta])
def list_versions(project_id: str) -> list[dict]:
    return [_version_row_to_meta(r) for r in db.list_versions(project_id)]


@router.post("/{project_id}/versions", response_model=VersionMeta)
def create_version(project_id: str, req: CreateVersionRequest) -> dict[str, Any]:
    snapshot = req.snapshot
    if snapshot.get("sessionId") and snapshot["sessionId"] != project_id:
        raise HTTPException(status_code=400, detail="sessionId does not match path id")

    step = int(snapshot.get("currentStep") or 1)
    created_at = datetime.now(timezone.utc).isoformat()
    version_id = f"v_{uuid4().hex[:12]}"

    db.create_version(
        version_id=version_id,
        project_id=project_id,
        created_at=created_at,
        step=step,
        step_name=STEP_NAMES.get(step, ""),
        label=req.label.strip(),
        trigger=req.trigger,
        snapshot=json.dumps(snapshot),
    )
    return _version_row_to_meta({
        "id": version_id, "project_id": project_id, "created_at": created_at,
        "step": step, "step_name": STEP_NAMES.get(step, ""),
        "label": req.label.strip(), "trigger": req.trigger,
    })


@router.get("/{project_id}/versions/{version_id}")
def get_version(project_id: str, version_id: str) -> dict[str, Any]:
    raw = db.get_version(version_id)
    if raw is None:
        raise HTTPException(status_code=404, detail="Version not found")
    snapshot = json.loads(raw)
    # A version id is unguessable, but checking it belongs to the project in the
    # path keeps a mistyped URL from silently loading someone else's work.
    if snapshot.get("sessionId") and snapshot["sessionId"] != project_id:
        raise HTTPException(status_code=404, detail="Version not found")
    return snapshot


@router.delete("/{project_id}/versions/{version_id}")
def delete_version(project_id: str, version_id: str) -> dict[str, bool]:
    db.delete_version(version_id)
    return {"ok": True}
