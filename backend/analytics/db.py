"""
Analytics SQLite store.

Tracks session lifecycle and every instrumented API call so we can answer:
  - Which step do users reach before dropping off?
  - Where are users currently stuck (idle too long on a step)?
  - Which AI generation endpoints are being retried the most?
  - What is the overall funnel completion rate?

Uses a single WAL-mode SQLite file. Thread-safe via check_same_thread=False
and a double-checked init lock; writes are fire-and-forget via run_in_executor.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = os.getenv("ANALYTICS_DB", str(Path(__file__).parent.parent / "analytics.db"))

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()


# ── Connection & Schema ───────────────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    with _lock:
        if _conn is None:
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.execute("PRAGMA synchronous=NORMAL")
            _init_schema(_conn)
    return _conn


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
    conn.commit()


# ── Queries ───────────────────────────────────────────────────────────────────

def get_overview() -> dict:
    conn = get_conn()
    total     = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    completed = conn.execute("SELECT COUNT(*) FROM sessions WHERE max_step = 8").fetchone()[0]
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
          AND s.max_step < 8
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
