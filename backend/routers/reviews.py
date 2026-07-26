"""
Peer review: independent second-reviewer passes over a project, reached by a
share link rather than an account.

The methodological point of a second pass is that it is *independent*. That has
a concrete consequence for this API: the snapshot served to a reviewer must have
the owner's judgements stripped out server-side, before it leaves the process.
Hiding them in the frontend would leave them one devtools panel away, and a
reviewer who has seen the first pass is no longer a second opinion — the
agreement figure computed from it would be an artefact of anchoring, not a
measure of reliability. `redact_for_review` below is therefore the load-bearing
part of this module, and the one worth reading first.
"""
from __future__ import annotations

import json
import secrets
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from analytics import db
from routers.agreement import cohens_kappa, extraction_agreement

router = APIRouter(prefix="/reviews", tags=["Peer review"])

SCOPES = {"process", "screening", "extraction", "output"}


# ── Redaction ─────────────────────────────────────────────────────────────────

# Fields carrying the owner's screening verdict on a paper. Blanked so the
# reviewer forms their own.
_PAPER_VERDICT_FIELDS = ("status", "exclusionReasonId", "notes")


def redact_for_review(snapshot: dict[str, Any], scopes: list[str]) -> dict[str, Any]:
    """Strip the owner's judgements from a snapshot before a reviewer sees it.

    Only the judgements in scope are removed: a reviewer doing extraction still
    needs to know which papers were included, so the screening verdicts survive
    unless screening is itself under review.
    """
    out = json.loads(json.dumps(snapshot))   # deep copy; never mutate the stored blob

    # A process reviewer evaluates what the user actually saw and did, so the
    # complete results and decisions are the evidence under review. Legacy
    # independent-review links retain their original blind-redaction contract.
    if "process" in scopes:
        return out

    if "screening" in scopes:
        for paper in out.get("results") or []:
            for f in _PAPER_VERDICT_FIELDS:
                paper[f] = None if f != "notes" else ""
        # The review list *is* the owner's verdict, so it cannot be shown at all.
        out["reviewList"] = []

    if "extraction" in scopes:
        # Keep the rows and columns — the reviewer extracts against the same
        # schema — but empty every cell so they read the paper, not the answer.
        for row in out.get("matrixRows") or []:
            row["cells"] = {}
        for row in out.get("systemMatrixRows") or []:
            row["cells"] = {}

    # `output` is deliberately not redacted: the gap statement and research
    # questions are the artefact under review, so the reviewer must see them.
    # There is no independent second version to compare against, which is why
    # that scope produces a verdict and comments rather than an agreement score.

    return out


# ── Owner-facing: create and manage invitations ───────────────────────────────

class CreateReviewRequest(BaseModel):
    projectId: str
    reviewerName: str | None = None
    scopes: list[str]


class CreateReviewResponse(BaseModel):
    id: str
    token: str
    url: str


@router.post("", response_model=CreateReviewResponse)
def create_review(req: CreateReviewRequest) -> dict:
    bad = set(req.scopes) - SCOPES
    if bad:
        raise HTTPException(status_code=422, detail=f"Unknown review scope(s): {sorted(bad)}")
    if not req.scopes:
        raise HTTPException(status_code=422, detail="At least one review scope is required")
    if db.get_project(req.projectId) is None:
        # The reviewer loads the project from here, so a link cannot be issued
        # for one the server has never received.
        raise HTTPException(
            status_code=404,
            detail="This project has not been saved to the server yet, so it cannot be shared. "
                   "Make an edit to trigger a save, then try again.",
        )

    review_id = f"rv_{uuid.uuid4().hex[:12]}"
    # 32 bytes of urandom: this token is the only thing standing between the
    # link and the project, so it must not be guessable or enumerable.
    token = secrets.token_urlsafe(32)
    db.create_review(review_id, req.projectId, token, req.reviewerName, req.scopes)

    return {"id": review_id, "token": token, "url": f"#review/{token}"}


class ReviewMeta(BaseModel):
    id: str
    reviewerName: str | None
    scopes: list[str]
    createdAt: float
    openedAt: float | None
    submittedAt: float | None
    revoked: bool
    decisionCount: int


@router.get("/project/{project_id}", response_model=list[ReviewMeta])
def list_reviews(project_id: str) -> list[dict]:
    out = []
    for r in db.list_reviews(project_id):
        written_comments = sum(
            1 for decision in db.get_decisions(r["id"], "process")
            if (decision.get("note") or "").strip()
        )
        out.append({
            "id": r["id"],
            "reviewerName": r["reviewer_name"],
            "scopes": json.loads(r["scopes"]),
            "createdAt": r["created_at"],
            "openedAt": r["opened_at"],
            "submittedAt": r["submitted_at"],
            "revoked": bool(r["revoked"]),
            "decisionCount": written_comments,
        })
    return out


@router.post("/{review_id}/revoke")
def revoke(review_id: str) -> dict:
    if db.get_review(review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    db.revoke_review(review_id)
    return {"ok": True}


# ── Reviewer-facing: everything below is authorised by token alone ────────────

def _review_or_404(token: str) -> dict:
    review = db.get_review_by_token(token)
    if review is None:
        raise HTTPException(status_code=404, detail="This review link is not valid or has been revoked")
    return review


@router.get("/by-token/{token}")
def get_review_workspace(token: str) -> dict:
    """The reviewer workspace: the full process evidence plus saved comments.

    Older invitations may contain the retired screening/extraction/output
    scopes. They are upgraded at read time so those links cannot bring back the
    old include/exclude/approve workspace.
    """
    review = _review_or_404(token)
    raw = db.get_project(review["project_id"])
    if raw is None:
        raise HTTPException(status_code=404, detail="The project behind this link no longer exists")

    db.mark_review_opened(review["id"])
    process_snapshot = redact_for_review(json.loads(raw), ["process"])

    return {
        "reviewId": review["id"],
        "reviewerName": review["reviewer_name"],
        "scopes": ["process"],
        "submittedAt": review["submitted_at"],
        "snapshot": process_snapshot,
        "decisions": [
            {"scope": d["scope"], "itemKey": d["item_key"], "value": d["value"], "note": d["note"]}
            for d in db.get_decisions(review["id"])
            if d["scope"] == "process"
        ],
    }


class Decision(BaseModel):
    itemKey: str
    value: str | None = None
    note: str | None = None


class SaveDecisionsRequest(BaseModel):
    scope: str
    decisions: list[Decision]


@router.post("/by-token/{token}/decisions")
def save_decisions(token: str, req: SaveDecisionsRequest) -> dict:
    review = _review_or_404(token)
    if req.scope not in SCOPES:
        raise HTTPException(status_code=422, detail=f"Unknown review scope: {req.scope}")
    # Process comments are the only current reviewer workflow. Permit them on
    # old invitation rows too, so opening a legacy link never exposes the
    # retired independent-decision controls.
    if req.scope != "process" and req.scope not in json.loads(review["scopes"]):
        raise HTTPException(status_code=403, detail=f"This link does not cover '{req.scope}'")
    if review["submitted_at"] is not None:
        raise HTTPException(status_code=409, detail="This review has already been submitted")

    db.upsert_decisions(review["id"], req.scope, [d.model_dump() for d in req.decisions])
    return {"saved": len(req.decisions)}


@router.post("/by-token/{token}/submit")
def submit(token: str) -> dict:
    review = _review_or_404(token)
    db.mark_review_submitted(review["id"])
    return {"ok": True}


# ── Owner-facing: the comparison ──────────────────────────────────────────────

def _owner_screening_verdicts(snapshot: dict) -> dict[str, str]:
    """Collapse the owner's screening state into the reviewer's vocabulary.

    'included' and 'maybe' both mean "kept for full-text assessment" at the
    screening stage, so they map to one category. Papers never judged are left
    out — they carry no verdict to compare.
    """
    verdicts: dict[str, str] = {}
    kept = {p["id"] for p in (snapshot.get("reviewList") or [])}
    for paper in snapshot.get("results") or []:
        if paper["id"] in kept:
            verdicts[paper["id"]] = "include"
        elif paper.get("status") == "excluded":
            verdicts[paper["id"]] = "exclude"
    return verdicts


@router.get("/{review_id}/comparison")
def comparison(review_id: str) -> dict:
    """Agreement between the owner's pass and this reviewer's, per scope."""
    review = db.get_review(review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    raw = db.get_project(review["project_id"])
    if raw is None:
        raise HTTPException(status_code=404, detail="Project not found")

    snapshot = json.loads(raw)
    scopes = json.loads(review["scopes"])
    result: dict[str, Any] = {"reviewId": review_id, "scopes": scopes}
    papers_by_id = {p["id"]: p for p in (snapshot.get("results") or [])}
    journal_by_id = {
        entry.get("id"): entry
        for entry in (snapshot.get("decisionJournal") or [])
        if entry.get("id")
    }
    step_names = {
        1: "Chat & Define Topic", 2: "Matrix Initial", 3: "System Review",
        4: "Explore & Search", 5: "Select Paper", 6: "Matrix Table",
        7: "Synthesis", 8: "Gap & Statement", 9: "Final Question",
    }

    def process_comment_meta(item_key: str) -> tuple[str, str]:
        if item_key.startswith("journal:"):
            entry = journal_by_id.get(item_key.removeprefix("journal:"), {})
            return entry.get("action", "Recorded action"), entry.get("entityLabel", "")
        prefix, _, raw_step = item_key.partition(":")
        try:
            step = int(raw_step)
        except ValueError:
            step = 0
        step_name = step_names.get(step, f"Step {raw_step}")
        if prefix == "step-result":
            return "Evaluation of step result", f"Step {step} · {step_name}"
        return "Evaluation of user operations and critical thinking", f"Step {step} · {step_name}"

    result["processComments"] = [
        {
            "entryId": d["item_key"],
            "action": process_comment_meta(d["item_key"])[0],
            "entityLabel": process_comment_meta(d["item_key"])[1],
            "comment": d["note"],
        }
        for d in db.get_decisions(review_id)
        if (
            (d["item_key"] or "").startswith(("journal:", "step-result:", "step-actions:"))
            and (d["note"] or "").strip()
        )
    ]

    if "screening" in scopes:
        owner = _owner_screening_verdicts(snapshot)
        reviewer = {
            d["item_key"]: d["value"]
            for d in db.get_decisions(review_id, "screening")
            if d["value"] in {"include", "exclude"}
        }
        k = cohens_kappa(owner, reviewer)
        result["screening"] = {
            "n": k.n,
            "observedAgreement": k.observed_agreement,
            "expectedAgreement": k.expected_agreement,
            "kappa": k.kappa,
            "interpretation": k.interpretation,
            "conflicts": [
                {
                    "paperId": pid,
                    "title": (papers_by_id.get(pid) or {}).get("title", ""),
                    "owner": owner[pid],
                    "reviewer": reviewer[pid],
                }
                for pid in k.disagreements
            ],
        }

    if "extraction" in scopes:
        owner_cells = {
            row["paperId"]: {c: (cell or {}).get("value", "") for c, cell in (row.get("cells") or {}).items()}
            for row in (snapshot.get("matrixRows") or [])
        }
        reviewer_cells: dict[str, dict[str, str]] = {}
        for d in db.get_decisions(review_id, "extraction"):
            # item_key is "<paperId>::<column>"
            paper_id, _, column = (d["item_key"] or "").partition("::")
            if not paper_id or not column:
                continue
            reviewer_cells.setdefault(paper_id, {})[column] = d["value"] or ""

        columns = [
            c for c in (snapshot.get("matrixColumns") or [])
            if c not in {"#", "Title", "Authors", "Year"}
        ]
        fields = extraction_agreement(owner_cells, reviewer_cells, columns)
        compared = sum(f.n for f in fields)
        matched = sum(f.matched for f in fields)
        result["extraction"] = {
            "overallAgreementPct": round(matched / compared * 100, 1) if compared else 0.0,
            "cellsCompared": compared,
            "byColumn": [
                {
                    "column": f.column,
                    "n": f.n,
                    "matched": f.matched,
                    "agreementPct": f.agreement_pct,
                    "discrepancies": [
                        {**d, "title": (papers_by_id.get(d["paperId"]) or {}).get("title", "")}
                        for d in f.discrepancies
                    ],
                }
                for f in fields
            ],
        }

    if "output" in scopes:
        # No agreement statistic here by design: the reviewer is appraising the
        # owner's write-up, not independently reproducing it, so there is no
        # second version to correlate against.
        result["output"] = {
            "verdicts": [
                {"itemKey": d["item_key"], "verdict": d["value"], "comment": d["note"]}
                for d in db.get_decisions(review_id, "output")
            ]
        }

    return result
