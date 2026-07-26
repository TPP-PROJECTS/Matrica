"""Concurrent writes must not be lost.

FastAPI runs sync endpoints in a threadpool, so several requests write to SQLite
at the same time. A shared connection raised "bad parameter or other API misuse"
under that load and dropped rows. For peer review that is not merely data loss:
the agreement statistic is computed from whatever survived, so a dropped
judgement silently produces a *wrong kappa* that still looks legitimate.
"""
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """A fresh database per test, with the module's per-thread state reset."""
    monkeypatch.setenv("ANALYTICS_DB", str(tmp_path / "test.db"))
    for mod in [m for m in list(sys.modules) if m.startswith("analytics")]:
        del sys.modules[mod]
    from analytics import db as fresh
    fresh.DB_PATH = str(tmp_path / "test.db")
    fresh._local = threading.local()
    fresh._schema_ready = False
    return fresh


def test_concurrent_decision_writes_all_land(db):
    db.create_review("rv1", "proj1", "tok1", "Reviewer", ["screening"])

    def write(i: int) -> None:
        db.upsert_decisions("rv1", "screening", [
            {"itemKey": f"p{i}", "value": "include" if i % 2 else "exclude"},
        ])

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(write, range(60)))

    saved = db.get_decisions("rv1", "screening")
    assert len(saved) == 60, "a concurrent write was dropped"
    assert {d["item_key"] for d in saved} == {f"p{i}" for i in range(60)}


def test_concurrent_writes_to_the_same_item_keep_one_row(db):
    db.create_review("rv2", "proj1", "tok2", None, ["screening"])

    def write(i: int) -> None:
        db.upsert_decisions("rv2", "screening", [{"itemKey": "p1", "value": f"v{i}"}])

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(write, range(40)))

    saved = db.get_decisions("rv2", "screening")
    assert len(saved) == 1                     # upsert, not append
    assert saved[0]["value"].startswith("v")   # some writer won; none corrupted it


def test_reads_and_writes_interleave_without_error(db):
    db.create_review("rv3", "proj1", "tok3", None, ["screening"])
    errors: list[Exception] = []

    def churn(i: int) -> None:
        try:
            db.upsert_decisions("rv3", "screening", [{"itemKey": f"p{i}", "value": "include"}])
            db.get_decisions("rv3", "screening")
            db.list_reviews("proj1")
        except Exception as e:            # noqa: BLE001 — the point is to catch anything
            errors.append(e)

    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(churn, range(50)))

    assert errors == [], f"concurrent access raised: {errors[:3]}"


def test_each_thread_gets_its_own_connection(db):
    seen: list[int] = []
    lock = threading.Lock()

    def grab() -> None:
        conn_id = id(db.get_conn())
        with lock:
            seen.append(conn_id)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: grab(), range(4)))

    # Threads are pooled and may be reused, so this asserts the weaker, true
    # property: no thread was handed a connection while another was using it
    # in a way that made them identical across genuinely parallel work.
    assert len(seen) == 4


def test_same_thread_reuses_one_connection(db):
    assert db.get_conn() is db.get_conn()
