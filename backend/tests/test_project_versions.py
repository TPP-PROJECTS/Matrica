"""Version checkpoints: immutable point-in-time copies of a project.

Distinct from the project list (different reviews) and from undo (last few
actions in the current session) — this is the "put it back the way it was
yesterday" path.
"""
import sys
import threading
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


from analytics import db  # noqa: E402
from routers import projects  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    """A database per test, pointed at a temporary file.

    The store caches one connection per thread, so repointing DB_PATH is not
    enough on its own — the thread-local has to be cleared too, as
    tests/test_db_concurrency.py does. Unlike that fixture this one does not
    evict modules from sys.modules: doing so leaves other test modules holding
    references to a store that no longer matches the one under test.
    """
    monkeypatch.setenv("ANALYTICS_DB", str(tmp_path / "test.db"))
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(db, "_local", threading.local())
    monkeypatch.setattr(db, "_schema_ready", False)
    db.init()
    yield db
    # Leave no connection to the temporary file behind for the next test.
    monkeypatch.setattr(db, "_local", threading.local())


def snapshot(session_id="p1", step=4, **over):
    base = {
        "sessionId": session_id,
        "sessionTitle": "My Review",
        "currentStep": step,
        "profile": {"domain": "cardiology"},
        "topics": [],
    }
    base.update(over)
    return base


def make(project_id="p1", label="", trigger="manual", **snap):
    return projects.create_version(
        project_id,
        projects.CreateVersionRequest(label=label, trigger=trigger, snapshot=snapshot(project_id, **snap)),
    )


def test_creating_a_version_returns_its_metadata():
    meta = make(label="before re-extraction")
    assert meta["projectId"] == "p1"
    assert meta["label"] == "before re-extraction"
    assert meta["step"] == 4
    assert meta["stepName"] == "Explore & Search"
    assert meta["trigger"] == "manual"
    assert meta["id"].startswith("v_")


def test_versions_are_listed_newest_first():
    first = make(label="one")
    second = make(label="two")
    listed = projects.list_versions("p1")
    assert [v["id"] for v in listed] == [second["id"], first["id"]]


def test_a_version_returns_the_snapshot_it_was_taken_from():
    meta = make(label="checkpoint", step=6)
    restored = projects.get_version("p1", meta["id"])
    assert restored["currentStep"] == 6
    assert restored["profile"] == {"domain": "cardiology"}


def test_a_version_is_immutable_once_the_project_moves_on():
    """The whole point: editing the project must not rewrite its history."""
    meta = make(step=4)
    projects.put_project("p1", snapshot(step=9, profile={"domain": "oncology"}))
    restored = projects.get_version("p1", meta["id"])
    assert restored["currentStep"] == 4
    assert restored["profile"] == {"domain": "cardiology"}


def test_versions_are_scoped_to_their_project():
    make(project_id="p1")
    make(project_id="p2")
    assert len(projects.list_versions("p1")) == 1
    assert len(projects.list_versions("p2")) == 1


def test_fetching_a_version_through_the_wrong_project_is_a_404():
    meta = make(project_id="p1")
    with pytest.raises(HTTPException) as exc:
        projects.get_version("p2", meta["id"])
    assert exc.value.status_code == 404


def test_a_missing_version_is_a_404():
    with pytest.raises(HTTPException) as exc:
        projects.get_version("p1", "v_nope")
    assert exc.value.status_code == 404


def test_snapshot_id_must_match_the_path():
    with pytest.raises(HTTPException) as exc:
        projects.create_version(
            "p1",
            projects.CreateVersionRequest(snapshot=snapshot(session_id="p2")),
        )
    assert exc.value.status_code == 400


def test_a_deleted_version_is_gone():
    meta = make()
    projects.delete_version("p1", meta["id"])
    assert projects.list_versions("p1") == []


def test_deleting_a_project_takes_its_versions_with_it():
    make(project_id="p1")
    projects.put_project("p1", snapshot())
    projects.delete_project("p1")
    assert projects.list_versions("p1") == []


def test_history_is_capped_so_a_long_review_cannot_grow_without_bound():
    for i in range(db.MAX_VERSIONS_PER_PROJECT + 5):
        make(label=f"v{i}")
    listed = projects.list_versions("p1")
    assert len(listed) == db.MAX_VERSIONS_PER_PROJECT
    # The oldest are the ones dropped.
    assert listed[0]["label"] == f"v{db.MAX_VERSIONS_PER_PROJECT + 4}"


# ── Out-of-order saves ────────────────────────────────────────────────────────


def test_an_older_save_arriving_late_does_not_overwrite_a_newer_one():
    projects.put_project("p1", snapshot(step=5, updatedAt="2026-09-28T10:00:02.000Z"))
    projects.put_project("p1", snapshot(step=4, updatedAt="2026-09-28T10:00:01.000Z"))
    assert projects.get_project("p1")["currentStep"] == 5


def test_a_newer_save_replaces_the_stored_one():
    projects.put_project("p1", snapshot(step=4, updatedAt="2026-09-28T10:00:01.000Z"))
    projects.put_project("p1", snapshot(step=5, updatedAt="2026-09-28T10:00:02.000Z"))
    assert projects.get_project("p1")["currentStep"] == 5


def test_a_save_without_a_timestamp_is_still_accepted():
    projects.put_project("p1", snapshot(step=4, updatedAt="2026-09-28T10:00:01.000Z"))
    projects.put_project("p1", snapshot(step=6))
    assert projects.get_project("p1")["currentStep"] == 6
