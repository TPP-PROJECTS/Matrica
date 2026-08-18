"""
Analytics SQLite store.

Tracks session lifecycle and every instrumented API call so we can answer:
  - Which step do users reach before dropping off?
  - Where are users currently stuck (idle too long on a step)?
  - Which AI generation endpoints are being retried the most?
  - What is the overall funnel completion rate?

Uses a WAL-mode SQLite file with one connection per thread.

Per-thread rather than shared: FastAPI runs sync endpoints in a threadpool, and
a single sqlite3.Connection driven concurrently from several of those threads
raises "bad parameter or other API misuse" and loses writes. WAL mode lets the
resulting connections read concurrently, and busy_timeout makes a writer wait
its turn instead of failing outright when another holds the write lock.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = os.getenv("ANALYTICS_DB", str(Path(__file__).parent.parent / "analytics.db"))

# How long a writer waits for another writer to finish before giving up.
BUSY_TIMEOUT_MS = 5000

_local = threading.local()
_schema_lock = threading.Lock()
_schema_ready = False


# ── Connection & Schema ───────────────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    """The calling thread's connection, opening and initialising it on first use."""
    global _schema_ready

    conn: sqlite3.Connection | None = getattr(_local, "conn", None)
    if conn is not None:
        return conn

    conn = sqlite3.connect(
        DB_PATH,
        check_same_thread=False,
        timeout=BUSY_TIMEOUT_MS / 1000,
    )
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")

    # Setting journal_mode takes a write lock. Doing it independently on every
    # connection races during a burst of first requests and can fail with
    # "database is locked" before busy_timeout has any useful effect. The first
    # connection configures the file and schema under one process lock; later
    # connections only apply the per-connection synchronous preference.
    if not _schema_ready:
        with _schema_lock:
            if not _schema_ready:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                _init_schema(conn)
                _schema_ready = True
            else:
                conn.execute("PRAGMA synchronous=NORMAL")
    else:
        conn.execute("PRAGMA synchronous=NORMAL")

    _local.conn = conn
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id           TEXT PRIMARY KEY,
            started_at   REAL NOT NULL,
            last_seen_at REAL NOT NULL,
            max_step     INTEGER DEFAULT 1,
            current_step INTEGER DEFAULT 1,
            domain       TEXT,
            user_agent   TEXT
        );

        CREATE TABLE IF NOT EXISTS events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id  TEXT    NOT NULL,
            ts          REAL    NOT NULL,
            step        INTEGER,
            event_type  TEXT    NOT NULL,
            endpoint    TEXT,
            method      TEXT,
            status_code INTEGER,
            duration_ms REAL,
            detail      TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
        CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts);
        CREATE INDEX IF NOT EXISTS idx_events_step    ON events(step, event_type);

        -- Durable project store: full SessionSnapshot JSON blob per project,
        -- with a few denormalised columns for the project-list query.
        CREATE TABLE IF NOT EXISTS projects (
            id            TEXT PRIMARY KEY,
            title         TEXT,
            created_at    TEXT,
            updated_at    TEXT,
            current_step  INTEGER,
            topic_preview TEXT,
            snapshot      TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

        -- Version checkpoints: immutable point-in-time copies of a project.
        -- Kept server-side rather than in localStorage because a snapshot is
        -- the same size as the project itself, and a handful of them would
        -- exhaust the browser's storage quota for the working session.
        CREATE TABLE IF NOT EXISTS project_versions (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            step        INTEGER,
            step_name   TEXT,
            label       TEXT,
            trigger     TEXT,
            snapshot    TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_versions_project
            ON project_versions(project_id, created_at DESC);

        -- Peer review: one row per invitation. `token` is the bearer secret
        -- embedded in the share link; it is the row's only access credential,
        -- so it is indexed but never returned by any owner-facing list query
        -- beyond the one that created it.
        CREATE TABLE IF NOT EXISTS reviews (
            id            TEXT PRIMARY KEY,
            project_id    TEXT NOT NULL,
            token         TEXT NOT NULL UNIQUE,
            reviewer_name TEXT,
            scopes        TEXT NOT NULL,   -- JSON array: screening|extraction|output
            created_at    REAL NOT NULL,
            opened_at     REAL,
            submitted_at  REAL,
            revoked       INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_reviews_token   ON reviews(token);
        CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);

        -- One row per judgement. `item_key` identifies what was judged:
        --   screening   -> paper id
        --   extraction  -> "<paperId>::<column>"
        --   output      -> the artefact name ("gap_statement", "rq", …)
        CREATE TABLE IF NOT EXISTS review_decisions (
            review_id  TEXT NOT NULL,
            scope      TEXT NOT NULL,
            item_key   TEXT NOT NULL,
            value      TEXT,             -- the verdict, or the extracted text
            note       TEXT,
            updated_at REAL NOT NULL,
            PRIMARY KEY (review_id, scope, item_key)
        );
    """)
    conn.commit()


def init() -> None:
    """Call once at startup to pre-open the connection."""
    get_conn()


# ── Writes ────────────────────────────────────────────────────────────────────

def log_event(
    session_id: str,
    step: int | None,
    event_type: str,
    endpoint: str | None,
    method: str | None,
    status_code: int | None,
    duration_ms: float | None,
    detail: dict | None = None,
) -> None:
    conn = get_conn()
    conn.execute(
        """INSERT INTO events
           (session_id, ts, step, event_type, endpoint, method, status_code, duration_ms, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            session_id, time.time(), step, event_type,
            endpoint, method, status_code, duration_ms,
            json.dumps(detail) if detail else None,
        ),
    )
    conn.commit()


def upsert_session(
    session_id: str,
    current_step: int | None,
    user_agent: str | None,
    domain: str | None = None,
) -> None:
    conn = get_conn()
    now = time.time()
    conn.execute(
        """INSERT INTO sessions (id, started_at, last_seen_at, max_step, current_step, user_agent, domain)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
               last_seen_at = excluded.last_seen_at,
               current_step = COALESCE(excluded.current_step, sessions.current_step),
               max_step     = MAX(sessions.max_step, COALESCE(excluded.current_step, 1)),
               user_agent   = COALESCE(sessions.user_agent, excluded.user_agent),
               domain       = COALESCE(excluded.domain, sessions.domain)
        """,
        (session_id, now, now, current_step or 1, current_step or 1, user_agent, domain),
    )
    conn.commit()


# ── Projects (durable session store) ──────────────────────────────────────────

def upsert_project(
    project_id: str,
    title: str | None,
    created_at: str | None,
    updated_at: str | None,
    current_step: int | None,
    topic_preview: str | None,
    snapshot: str,
) -> None:
    conn = get_conn()
    conn.execute(
        """INSERT INTO projects
           (id, title, created_at, updated_at, current_step, topic_preview, snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
               title         = excluded.title,
               updated_at    = excluded.updated_at,
               current_step  = excluded.current_step,
               topic_preview = excluded.topic_preview,
               snapshot      = excluded.snapshot
        """,
        (project_id, title, created_at, updated_at, current_step, topic_preview, snapshot),
    )
    conn.commit()


def list_projects() -> list[dict]:
    """Project-list metadata, most recently updated first."""
    conn = get_conn()
    rows = conn.execute(
        """SELECT id, title, created_at, updated_at, current_step, topic_preview
           FROM projects
           ORDER BY updated_at DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


def get_project(project_id: str) -> str | None:
    """Return the raw snapshot JSON for a project, or None if not found."""
    conn = get_conn()
    row = conn.execute(
        "SELECT snapshot FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    return row["snapshot"] if row else None


def delete_project(project_id: str) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.execute("DELETE FROM project_versions WHERE project_id = ?", (project_id,))
    conn.commit()


# ── Version checkpoints ───────────────────────────────────────────────────────

# Kept per project so a long review cannot fill the database with history.
# Oldest are dropped first; the working project itself is never affected.
MAX_VERSIONS_PER_PROJECT = 40


def create_version(
    version_id: str,
    project_id: str,
    created_at: str,
    step: int | None,
    step_name: str | None,
    label: str | None,
    trigger: str | None,
    snapshot: str,
) -> None:
    conn = get_conn()
    conn.execute(
        """INSERT INTO project_versions
           (id, project_id, created_at, step, step_name, label, trigger, snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (version_id, project_id, created_at, step, step_name, label, trigger, snapshot),
    )
    conn.execute(
        """DELETE FROM project_versions
           WHERE project_id = ?
             AND id NOT IN (
                 SELECT id FROM project_versions
                 WHERE project_id = ?
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?
             )""",
        (project_id, project_id, MAX_VERSIONS_PER_PROJECT),
    )
    conn.commit()


def list_versions(project_id: str) -> list[dict]:
    """Checkpoint metadata, newest first. The snapshot blob is not included."""
    conn = get_conn()
    rows = conn.execute(
        """SELECT id, project_id, created_at, step, step_name, label, trigger
           FROM project_versions
           WHERE project_id = ?
           ORDER BY created_at DESC, rowid DESC""",
        (project_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_version(version_id: str) -> str | None:
    """Raw snapshot JSON for one checkpoint, or None if it is not there."""
    conn = get_conn()
    row = conn.execute(
        "SELECT snapshot FROM project_versions WHERE id = ?", (version_id,)
    ).fetchone()
    return row["snapshot"] if row else None


def delete_version(version_id: str) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM project_versions WHERE id = ?", (version_id,))
    conn.commit()


# ── Peer review ───────────────────────────────────────────────────────────────

def create_review(
    review_id: str,
    project_id: str,
    token: str,
    reviewer_name: str | None,
    scopes: list[str],
) -> None:
    conn = get_conn()
    conn.execute(
        """INSERT INTO reviews (id, project_id, token, reviewer_name, scopes, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (review_id, project_id, token, reviewer_name, json.dumps(scopes), time.time()),
    )
    conn.commit()


def get_review_by_token(token: str) -> dict | None:
    """Look up an invitation by its bearer token. Revoked links resolve to None."""
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM reviews WHERE token = ? AND revoked = 0", (token,)
    ).fetchone()
    return dict(row) if row else None


def get_review(review_id: str) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM reviews WHERE id = ?", (review_id,)).fetchone()
    return dict(row) if row else None


def list_reviews(project_id: str) -> list[dict]:
    """Invitations for a project. Excludes `token` — the secret is shown once,
    at creation, and never re-listed."""
    conn = get_conn()
    rows = conn.execute(
        """SELECT id, project_id, reviewer_name, scopes, created_at,
                  opened_at, submitted_at, revoked
           FROM reviews WHERE project_id = ? ORDER BY created_at DESC""",
        (project_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def mark_review_opened(review_id: str) -> None:
    """Record first access only; later visits must not reset the timestamp."""
    conn = get_conn()
    conn.execute(
        "UPDATE reviews SET opened_at = ? WHERE id = ? AND opened_at IS NULL",
        (time.time(), review_id),
    )
    conn.commit()


def mark_review_submitted(review_id: str) -> None:
    conn = get_conn()
    conn.execute("UPDATE reviews SET submitted_at = ? WHERE id = ?", (time.time(), review_id))
    conn.commit()


def revoke_review(review_id: str) -> None:
    conn = get_conn()
    conn.execute("UPDATE reviews SET revoked = 1 WHERE id = ?", (review_id,))
    conn.commit()


def upsert_decisions(review_id: str, scope: str, decisions: list[dict]) -> None:
    """Write a batch of judgements, replacing any previous verdict on the same item."""
    conn = get_conn()
    now = time.time()
    conn.executemany(
        """INSERT INTO review_decisions (review_id, scope, item_key, value, note, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(review_id, scope, item_key) DO UPDATE SET
               value      = excluded.value,
               note       = excluded.note,
               updated_at = excluded.updated_at""",
        [
            (review_id, scope, d["itemKey"], d.get("value"), d.get("note"), now)
            for d in decisions
        ],
    )
    conn.commit()


def get_decisions(review_id: str, scope: str | None = None) -> list[dict]:
    conn = get_conn()
    if scope:
        rows = conn.execute(
            "SELECT * FROM review_decisions WHERE review_id = ? AND scope = ?",
            (review_id, scope),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM review_decisions WHERE review_id = ?", (review_id,)
        ).fetchall()
    return [dict(r) for r in rows]


# ── Queries ───────────────────────────────────────────────────────────────────

def get_overview() -> dict:
    conn = get_conn()
    total     = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    completed = conn.execute("SELECT COUNT(*) FROM sessions WHERE max_step = 9").fetchone()[0]
    api_calls = conn.execute("SELECT COUNT(*) FROM events WHERE event_type = 'api_call'").fetchone()[0]
    errors    = conn.execute("SELECT COUNT(*) FROM events WHERE status_code >= 400").fetchone()[0]
    avg_row   = conn.execute("SELECT AVG(max_step) FROM sessions").fetchone()
    avg_step  = round(avg_row[0], 1) if avg_row[0] else 0
    recent    = conn.execute(
        "SELECT COUNT(*) FROM sessions WHERE last_seen_at > ?", (time.time() - 3600,)
    ).fetchone()[0]

    return {
        "total_sessions": total,
        "completed_sessions": completed,
        "completion_rate_pct": round(completed / total * 100, 1) if total else 0,
        "active_last_hour": recent,
        "total_api_calls": api_calls,
        "error_calls": errors,
        "error_rate_pct": round(errors / api_calls * 100, 1) if api_calls else 0,
        "avg_step_reached": avg_step,
    }


def get_all_sessions() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT
            s.id, s.started_at, s.last_seen_at,
            s.max_step, s.current_step, s.domain, s.user_agent,
            COUNT(e.id)                                                  AS event_count,
            SUM(CASE WHEN e.status_code >= 400 THEN 1 ELSE 0 END)       AS error_count,
            SUM(CASE WHEN e.event_type = 'api_call' THEN 1 ELSE 0 END)  AS api_calls,
            SUM(CASE WHEN e.event_type = 'heartbeat' THEN 1 ELSE 0 END) AS heartbeats
        FROM sessions s
        LEFT JOIN events e ON e.session_id = s.id
        GROUP BY s.id
        ORDER BY s.last_seen_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def get_session_events(session_id: str) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC",
        (session_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_funnel() -> list[dict]:
    """How many sessions made it to each step (cumulative and per-step)."""
    conn = get_conn()
    # Per-step drop-off: sessions where max_step = N
    rows = conn.execute("""
        SELECT max_step AS step, COUNT(*) AS sessions_stopped_here
        FROM sessions
        GROUP BY max_step
        ORDER BY max_step
    """).fetchall()
    result = [dict(r) for r in rows]

    # Add cumulative "reached at least step N"
    total = sum(r["sessions_stopped_here"] for r in result)
    cumulative = total
    for r in result:
        r["sessions_reached"] = cumulative
        r["reached_pct"] = round(cumulative / total * 100, 1) if total else 0
        cumulative -= r["sessions_stopped_here"]

    return result


def get_stuck_sessions(idle_minutes: int = 15) -> list[dict]:
    """Sessions that haven't made an API call in idle_minutes and aren't at step 8."""
    conn = get_conn()
    cutoff = time.time() - idle_minutes * 60
    rows = conn.execute("""
        SELECT s.*,
               ROUND((? - s.last_seen_at) / 60.0, 1) AS idle_minutes,
               COUNT(e.id)                             AS total_events,
               SUM(CASE WHEN e.event_type = 'api_call' THEN 1 ELSE 0 END) AS api_calls
        FROM sessions s
        LEFT JOIN events e ON e.session_id = s.id
        WHERE s.last_seen_at < ?
          AND s.max_step < 9
          AND (? - s.started_at) > 180
        GROUP BY s.id
        ORDER BY s.last_seen_at ASC
    """, (time.time(), cutoff, time.time())).fetchall()
    return [dict(r) for r in rows]


def get_regeneration_sessions(threshold: int = 3) -> list[dict]:
    """Sessions retrying the same AI generation endpoint >= threshold times."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT session_id, endpoint, COUNT(*) AS call_count,
               MIN(ts) AS first_call, MAX(ts) AS last_call
        FROM events
        WHERE event_type = 'api_call'
          AND endpoint IS NOT NULL
          AND (status_code IS NULL OR status_code < 400)
          AND (
            endpoint LIKE '%/generate%'
            OR endpoint LIKE '%/search%'
            OR endpoint LIKE '%/synthesis%'
          )
        GROUP BY session_id, endpoint
        HAVING call_count >= ?
        ORDER BY call_count DESC
    """, (threshold,)).fetchall()
    return [dict(r) for r in rows]


def get_step_timings() -> list[dict]:
    """Average time users spend on each step before advancing, from step_change events."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT
            json_extract(detail, '$.from_step')             AS step,
            COUNT(*)                                        AS transitions,
            ROUND(AVG(json_extract(detail, '$.time_on_step_ms')) / 1000.0, 1) AS avg_seconds,
            ROUND(MIN(json_extract(detail, '$.time_on_step_ms')) / 1000.0, 1) AS min_seconds,
            ROUND(MAX(json_extract(detail, '$.time_on_step_ms')) / 1000.0, 1) AS max_seconds,
            SUM(CASE WHEN json_extract(detail, '$.direction') = 'back' THEN 1 ELSE 0 END) AS back_navs
        FROM events
        WHERE event_type = 'step_change'
          AND detail IS NOT NULL
        GROUP BY step
        ORDER BY step
    """).fetchall()
    return [dict(r) for r in rows]
