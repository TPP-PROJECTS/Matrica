"""
Publication-integrity check for included papers: retractions, expressions of
concern and corrections.

Crossref carries these as `updated-by` notices on the original work, merging
publishers' own notices with the Retraction Watch database, which Crossref has
held since 2023. A retracted paper cited as evidence is one of the few errors a
review cannot recover from after publication, and nothing in a paper's
metadata at search time would reveal it — the retraction usually comes years
later.

Only a DOI identifies a paper reliably. A paper without one is looked up by
title, and a record counts only when its title agrees exactly after
normalisation (and after removing marks such as "RETRACTED:"); anything looser
would risk attaching another paper's retraction to this one. A paper that
cannot be resolved is reported as unresolved, never as clear.
"""
import asyncio
import re
from typing import Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

CROSSREF_WORKS = "https://api.crossref.org/works"
# Crossref asks API clients to identify themselves; identified requests go to
# its more reliable "polite" pool.
_UA = {"User-Agent": "ResearchAI-tool (research@example.com)"}
_DOI = re.compile(r'10\.\d{4,9}/[^\s"<>]+')
CONCURRENCY = 4
TIMEOUT_SECONDS = 15.0
MAX_PAPERS = 200
RETRY_DELAY_SECONDS = 1.0

# Crossref update types, grouped by what they mean for a paper's use as
# evidence. Anything else (new versions, additions) says nothing about it.
_RETRACTED = {"retraction", "withdrawal", "removal", "partial_retraction"}
_CONCERN = {"expression_of_concern"}
_CORRECTED = {"correction", "erratum", "corrigendum"}

Status = Literal["retracted", "concern", "corrected", "clear", "unresolved"]


class IntegrityPaper(BaseModel):
    id: str
    title: str
    doi: str | None = None
    url: str | None = None


class IntegrityRequest(BaseModel):
    papers: list[IntegrityPaper]


class Notice(BaseModel):
    type: str
    label: str
    doi: str | None = None
    date: str | None = None
    source: str | None = None


class IntegrityResult(BaseModel):
    id: str
    status: Status
    doi: str | None = None
    notices: list[Notice] = []


class IntegrityResponse(BaseModel):
    results: list[IntegrityResult]


def extract_doi(*candidates: str | None) -> str | None:
    """A bare, lower-cased DOI from the first candidate that contains one."""
    for s in candidates:
        m = _DOI.search(s or "")
        if m:
            return m.group(0).rstrip('.,;)').lower()
    return None


def _title_key(title: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', (title or '').lower()).strip()


# How Crossref titles announce a status. A publisher often marks the original
# ("RETRACTED: …") without an `updated-by` notice, and the notice itself is a
# separate record titled after the paper ("Retraction—…", "Expression of
# concern: …"). Either is evidence about the paper that carries the title.
_TITLE_MARKS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'^\s*(retracted|withdrawn)(\s+article)?\s*[:\-\u2013\u2014]\s*', re.I), "retraction"),
    (re.compile(r'^\s*(notice of retraction|retraction notice|retraction)(\s+(to|for|of))?\s*[:\-\u2013\u2014]?\s*', re.I), "retraction"),
    (re.compile(r'^\s*expression of concern(\s+(to|for|regarding|about))?\s*[:\-\u2013\u2014]?\s*', re.I), "expression_of_concern"),
    (re.compile(r'^\s*(correction|erratum|corrigendum)(\s+(to|for))?\s*[:\-\u2013\u2014]?\s*', re.I), "correction"),
]


def split_title_mark(title: str) -> tuple[str | None, str]:
    """(status the title announces, or None; the title with that mark removed)."""
    for pattern, kind in _TITLE_MARKS:
        m = pattern.match(title or "")
        if m:
            return kind, title[m.end():]
    return None, title or ""


_SEVERITY = {"retracted": 3, "concern": 2, "corrected": 1, "clear": 0}
_KIND_STATUS = {**{k: "retracted" for k in _RETRACTED}, **{k: "concern" for k in _CONCERN},
                **{k: "corrected" for k in _CORRECTED}}


def classify(updated_by: list[dict] | None, titles: list[str] | None = None) -> tuple[Status, list[Notice]]:
    """Reduce a work's `updated-by` notices (and title marks) to the most serious status."""
    notices: list[Notice] = []
    status: Status = "clear"
    for u in updated_by or []:
        kind = (u.get("type") or "").lower()
        if kind not in _KIND_STATUS:
            continue
        parts = ((u.get("updated") or {}).get("date-parts") or [[None]])[0]
        date = "-".join(f"{p:02d}" if i else str(p) for i, p in enumerate(parts) if p) or None
        notices.append(Notice(
            type=kind,
            label=u.get("label") or kind.replace("_", " ").capitalize(),
            doi=(u.get("DOI") or None),
            date=date,
            source=u.get("source"),
        ))
        if _SEVERITY[_KIND_STATUS[kind]] > _SEVERITY[status]:
            status = _KIND_STATUS[kind]
    for t in titles or []:
        kind, _ = split_title_mark(t)
        # Only the work's own "RETRACTED:"/"WITHDRAWN:" mark counts here; the
        # other marks name notice records, handled in the title lookup.
        if kind == "retraction" and re.match(r'^\s*(retracted|withdrawn)', t, re.I):
            if not any(n.type in _RETRACTED for n in notices):
                notices.append(Notice(type="retraction", label="Marked retracted in its title", source="publisher"))
            status = "retracted"
    return status, notices


async def _get(http: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    """GET with one retry: Crossref sheds load with 429s and the odd 5xx or
    timeout, and a single hiccup should not leave a paper unchecked."""
    for attempt in (1, 2):
        try:
            r = await http.get(url, headers=_UA, **kwargs)
        except httpx.TimeoutException:
            if attempt == 2:
                raise
        else:
            if (r.status_code != 429 and r.status_code < 500) or attempt == 2:
                return r
        await asyncio.sleep(RETRY_DELAY_SECONDS)
    raise AssertionError("unreachable")


async def _work_by_doi(http: httpx.AsyncClient, doi: str) -> dict | None:
    r = await _get(http, f"{CROSSREF_WORKS}/{doi}")
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json().get("message")


async def _check_by_title(http: httpx.AsyncClient, paper: "IntegrityPaper") -> IntegrityResult:
    """
    Every Crossref record whose title matches exactly — once status marks are
    removed — is evidence about this paper: the work itself, its notices, and
    letters that reuse its title. The most serious status among them is
    reported. For a retraction check a false "clear" is the costly error; a
    reviewer can dismiss a false alarm in seconds.
    """
    key = _title_key(paper.title)
    if len(key) < 15:
        # Too short to match on safely ("Editorial", "Introduction").
        return IntegrityResult(id=paper.id, status="unresolved")
    r = await _get(
        http, CROSSREF_WORKS,
        params={"query.bibliographic": paper.title, "rows": 6, "select": "DOI,title,updated-by"},
    )
    r.raise_for_status()

    status: Status = "clear"
    notices: list[Notice] = []
    work_doi: str | None = None
    matched = False
    for item in (r.json().get("message") or {}).get("items") or []:
        for t in item.get("title") or []:
            mark, bare = split_title_mark(t)
            if _title_key(bare) != key:
                continue
            matched = True
            is_notice = mark is not None and not re.match(r'^\s*(retracted|withdrawn)', t, re.I)
            if is_notice:
                notices.append(Notice(type=mark, label=t[:len(t) - len(bare)].strip(" :-\u2013\u2014") or mark,
                                      doi=extract_doi(item.get("DOI")), source="crossref-title"))
                item_status: Status = _KIND_STATUS.get(mark, "clear")
            else:
                item_status, item_notices = classify(item.get("updated-by"), [t])
                notices.extend(item_notices)
                if work_doi is None or item_status != "clear":
                    work_doi = extract_doi(item.get("DOI"))
            if _SEVERITY[item_status] > _SEVERITY[status]:
                status = item_status
            break
    if not matched:
        return IntegrityResult(id=paper.id, status="unresolved")
    return IntegrityResult(id=paper.id, status=status, doi=work_doi, notices=notices)


async def check_one(http: httpx.AsyncClient, paper: "IntegrityPaper") -> IntegrityResult:
    doi = extract_doi(paper.doi, paper.url)
    try:
        if not doi:
            return await _check_by_title(http, paper)
        work = await _work_by_doi(http, doi)
    except (httpx.HTTPError, ValueError):
        return IntegrityResult(id=paper.id, status="unresolved", doi=doi)
    if not work:
        return IntegrityResult(id=paper.id, status="unresolved", doi=doi)
    status, notices = classify(work.get("updated-by"), work.get("title"))
    return IntegrityResult(id=paper.id, status=status, doi=doi, notices=notices)


@router.post("/integrity/check", response_model=IntegrityResponse)
async def check_integrity(req: IntegrityRequest):
    papers = req.papers[:MAX_PAPERS]
    gate = asyncio.Semaphore(CONCURRENCY)

    async def guarded(http: httpx.AsyncClient, p: IntegrityPaper) -> IntegrityResult:
        async with gate:
            return await check_one(http, p)

    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=True) as http:
        results = await asyncio.gather(*(guarded(http, p) for p in papers))
    return IntegrityResponse(results=list(results))
