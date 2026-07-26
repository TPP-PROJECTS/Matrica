"""The redaction contract: what a reviewer is allowed to see.

These are the tests that keep the review blind. If one of them starts failing,
the agreement statistics the tool reports have stopped measuring reliability and
started measuring anchoring.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.reviews import (  # noqa: E402
    Decision,
    SaveDecisionsRequest,
    _owner_screening_verdicts,
    get_review_workspace,
    redact_for_review,
    save_decisions,
)


def snapshot() -> dict:
    return {
        "results": [
            {"id": "p1", "title": "Alpha", "status": "included",
             "exclusionReasonId": None, "notes": "looks good", "abstract": "a"},
            {"id": "p2", "title": "Beta", "status": "excluded",
             "exclusionReasonId": "ex-design", "notes": "wrong design", "abstract": "b"},
            {"id": "p3", "title": "Gamma", "status": None,
             "exclusionReasonId": None, "notes": "", "abstract": "c"},
        ],
        "reviewList": [{"id": "p1", "title": "Alpha", "status": "included", "notes": "looks good"}],
        "matrixColumns": ["Title", "Method", "Sample Size"],
        "matrixRows": [
            {"paperId": "p1", "title": "Alpha", "cells": {
                "Method": {"value": "RCT"}, "Sample Size": {"value": "120"}}},
        ],
        "systemMatrixRows": [{"systemId": "s1", "name": "Tool", "cells": {"Cost": {"value": "free"}}}],
        "gapStatement": "The gap is X.",
        "rqOptions": [{"id": "rq1", "text": "Does X?"}],
        "decisionJournal": [{
            "id": "j1",
            "kind": "justification",
            "step": 4,
            "action": "Edited search query",
            "entityType": "query",
            "entityId": "q1",
            "entityLabel": "Query 1",
            "justification": "Improves population specificity",
            "createdAt": "2026-01-01T00:00:00Z",
        }],
    }


# ── screening scope ───────────────────────────────────────────────────────────

def test_screening_redaction_removes_every_verdict_field():
    out = redact_for_review(snapshot(), ["screening"])
    for paper in out["results"]:
        assert paper["status"] is None
        assert paper["exclusionReasonId"] is None
        assert paper["notes"] == ""


def test_screening_redaction_empties_the_review_list():
    # The review list is itself the owner's verdict — leaving it would hand the
    # reviewer the answer key.
    assert redact_for_review(snapshot(), ["screening"])["reviewList"] == []


def test_screening_redaction_keeps_what_the_reviewer_needs_to_judge():
    out = redact_for_review(snapshot(), ["screening"])
    assert [p["title"] for p in out["results"]] == ["Alpha", "Beta", "Gamma"]
    assert [p["abstract"] for p in out["results"]] == ["a", "b", "c"]


def test_reviewer_receives_the_research_process_audit_trail():
    out = redact_for_review(snapshot(), ["screening"])
    assert out["decisionJournal"][0]["justification"] == "Improves population specificity"


def test_process_review_receives_complete_results_and_user_decisions():
    out = redact_for_review(snapshot(), ["process"])
    assert out["reviewList"][0]["id"] == "p1"
    assert out["results"][1]["status"] == "excluded"
    assert out["matrixRows"][0]["cells"]["Method"]["value"] == "RCT"
    assert out["decisionJournal"][0]["justification"] == "Improves population specificity"


def test_legacy_invitation_is_upgraded_to_full_process_review(monkeypatch):
    import json
    from routers import reviews
    db = reviews.db

    monkeypatch.setattr(db, "get_review_by_token", lambda _token: {
        "id": "rv-old", "project_id": "p1", "reviewer_name": "R",
        "scopes": json.dumps(["screening"]), "submitted_at": None,
    })
    monkeypatch.setattr(db, "get_project", lambda _project_id: json.dumps(snapshot()))
    monkeypatch.setattr(db, "mark_review_opened", lambda _review_id: None)
    monkeypatch.setattr(db, "get_decisions", lambda _review_id: [])

    workspace = get_review_workspace("legacy-token")
    assert workspace["scopes"] == ["process"]
    assert workspace["snapshot"]["results"][1]["status"] == "excluded"
    assert workspace["snapshot"]["decisionJournal"][0]["justification"]


def test_legacy_invitation_accepts_process_comments(monkeypatch):
    import json
    from routers import reviews
    db = reviews.db

    saved = []
    monkeypatch.setattr(db, "get_review_by_token", lambda _token: {
        "id": "rv-old", "scopes": json.dumps(["screening"]), "submitted_at": None,
    })
    monkeypatch.setattr(
        db,
        "upsert_decisions",
        lambda review_id, scope, decisions: saved.append((review_id, scope, decisions)),
    )

    result = save_decisions("legacy-token", SaveDecisionsRequest(
        scope="process",
        decisions=[Decision(itemKey="step-result:1", note="Good reasoning")],
    ))
    assert result == {"saved": 1}
    assert saved[0][1] == "process"


def test_no_owner_verdict_survives_anywhere_in_the_screening_payload():
    # Belt and braces: the giveaway strings must not appear anywhere in the
    # serialised payload, whatever shape a future field takes.
    import json
    blob = json.dumps(redact_for_review(snapshot(), ["screening"]))
    assert "ex-design" not in blob
    assert "looks good" not in blob
    assert "wrong design" not in blob


# ── extraction scope ──────────────────────────────────────────────────────────

def test_extraction_redaction_empties_cells_but_keeps_the_schema():
    out = redact_for_review(snapshot(), ["extraction"])
    assert out["matrixRows"][0]["cells"] == {}
    assert out["matrixRows"][0]["paperId"] == "p1"      # row survives
    assert out["matrixColumns"] == ["Title", "Method", "Sample Size"]


def test_extraction_redaction_also_covers_the_system_matrix():
    out = redact_for_review(snapshot(), ["extraction"])
    assert out["systemMatrixRows"][0]["cells"] == {}


def test_extraction_scope_leaves_screening_verdicts_visible():
    # A reviewer extracting data needs to know which papers were included.
    out = redact_for_review(snapshot(), ["extraction"])
    assert out["results"][0]["status"] == "included"
    assert len(out["reviewList"]) == 1


# ── output scope ──────────────────────────────────────────────────────────────

def test_output_scope_shows_the_artefact_under_review():
    out = redact_for_review(snapshot(), ["output"])
    assert out["gapStatement"] == "The gap is X."
    assert out["rqOptions"][0]["text"] == "Does X?"


# ── general ───────────────────────────────────────────────────────────────────

def test_redaction_never_mutates_the_stored_snapshot():
    original = snapshot()
    redact_for_review(original, ["screening", "extraction"])
    assert original["results"][0]["status"] == "included"
    assert original["matrixRows"][0]["cells"]["Method"]["value"] == "RCT"


def test_combined_scopes_apply_every_redaction():
    out = redact_for_review(snapshot(), ["screening", "extraction", "output"])
    assert out["reviewList"] == []
    assert out["results"][0]["status"] is None
    assert out["matrixRows"][0]["cells"] == {}


def test_empty_scopes_redacts_nothing():
    out = redact_for_review(snapshot(), [])
    assert out["results"][0]["status"] == "included"
    assert out["matrixRows"][0]["cells"]["Method"]["value"] == "RCT"


def test_redaction_survives_a_snapshot_missing_optional_keys():
    assert redact_for_review({}, ["screening", "extraction"]) == {"reviewList": []}


# ── owner verdict mapping ─────────────────────────────────────────────────────

def test_owner_verdicts_collapse_included_and_maybe_to_one_category():
    snap = snapshot()
    snap["reviewList"] = [{"id": "p1"}, {"id": "p3"}]      # p3 is a "maybe"
    verdicts = _owner_screening_verdicts(snap)
    assert verdicts["p1"] == "include"
    assert verdicts["p3"] == "include"


def test_owner_verdicts_omit_papers_never_judged():
    # p3 is neither kept nor excluded — it carries no verdict, so it must not
    # appear and be compared against a reviewer's judgement.
    verdicts = _owner_screening_verdicts(snapshot())
    assert set(verdicts) == {"p1", "p2"}
    assert verdicts["p2"] == "exclude"


@pytest.mark.parametrize("snap", [{}, {"results": []}, {"reviewList": []}])
def test_owner_verdicts_of_an_empty_project(snap):
    assert _owner_screening_verdicts(snap) == {}


# ── Invitation creation ───────────────────────────────────────────────────────

def test_cannot_share_a_project_the_server_has_never_received():
    """A brand-new session is only in the browser until something triggers a
    save, and the reviewer loads the project from the server — so the link has
    to be refused, with a message saying what to do about it."""
    from fastapi import HTTPException

    from analytics import db
    from routers.reviews import CreateReviewRequest, create_review

    real_get_project = db.get_project
    db.get_project = lambda _id: None
    try:
        with pytest.raises(HTTPException) as exc:
            create_review(CreateReviewRequest(projectId="never_saved", scopes=["screening"]))
    finally:
        db.get_project = real_get_project

    assert exc.value.status_code == 404
    assert "has not been saved" in exc.value.detail
