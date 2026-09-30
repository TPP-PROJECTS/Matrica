"""Retraction / expression-of-concern / correction lookup against Crossref."""
import asyncio
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.integrity import (  # noqa: E402
    IntegrityPaper, check_one, classify, extract_doi,
)


def notice(kind, doi="10.1234/notice", date=(2010, 2, 6), source="retraction-watch"):
    return {"type": kind, "label": kind.title(), "DOI": doi, "source": source,
            "updated": {"date-parts": [list(date)]}}


def run(paper, handler):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await check_one(http, paper)
    return asyncio.run(go())


# ── classify ──────────────────────────────────────────────────────────────────

def test_retraction_outranks_a_correction():
    status, notices = classify([notice("correction"), notice("retraction")])
    assert status == "retracted"
    assert [n.type for n in notices] == ["correction", "retraction"]
    assert notices[1].date == "2010-02-06"


def test_expression_of_concern():
    assert classify([notice("expression_of_concern")])[0] == "concern"


def test_irrelevant_updates_leave_a_paper_clear():
    assert classify([notice("new_version")]) == ("clear", [])
    assert classify(None) == ("clear", [])


def test_extract_doi_from_a_url():
    assert extract_doi(None, "https://doi.org/10.1016/S0140-6736(97)11096-0") == "10.1016/s0140-6736(97)11096-0"
    assert extract_doi("", "https://example.org/paper") is None


# ── lookup ────────────────────────────────────────────────────────────────────

def test_looks_up_by_doi():
    def handler(request):
        assert "/works/10.1234/abc" in str(request.url)
        return httpx.Response(200, json={"message": {"DOI": "10.1234/abc", "updated-by": [notice("retraction")]}})
    r = run(IntegrityPaper(id="p1", title="Anything", url="https://doi.org/10.1234/abc"), handler)
    assert (r.status, r.doi) == ("retracted", "10.1234/abc")


def test_title_lookup_accepts_only_an_exact_title_match():
    def handler(request):
        return httpx.Response(200, json={"message": {"items": [
            {"DOI": "10.1234/other", "title": ["A different paper about mindfulness apps"], "updated-by": [notice("retraction")]},
            {"DOI": "10.1234/right", "title": ["Mindfulness App for Anxiety in Adolescents!"], "updated-by": []},
        ]}})
    r = run(IntegrityPaper(id="p1", title="Mindfulness app for anxiety in adolescents"), handler)
    assert (r.status, r.doi) == ("clear", "10.1234/right")


def test_no_title_match_is_unresolved_not_clear():
    def handler(request):
        return httpx.Response(200, json={"message": {"items": [{"DOI": "10.1234/x", "title": ["Something else entirely here"]}]}})
    r = run(IntegrityPaper(id="p1", title="Mindfulness app for anxiety in adolescents"), handler)
    assert r.status == "unresolved"


def test_a_failed_request_is_unresolved():
    def handler(request):
        return httpx.Response(503)
    r = run(IntegrityPaper(id="p1", title="t", doi="10.1234/abc"), handler)
    assert r.status == "unresolved"


def test_title_lookup_sees_a_retraction_through_title_marks():
    # The shape Crossref returns for the Wakefield paper: the original carries
    # "RETRACTED:", a same-titled letter carries nothing, and the notice is a
    # separate record titled "Retraction—…".
    title = "Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children"
    def handler(request):
        return httpx.Response(200, json={"message": {"items": [
            {"DOI": "10.1016/notice", "title": [f"Retraction—{title}"]},
            {"DOI": "10.1016/letter", "title": [title]},
            {"DOI": "10.1016/original", "title": [f"RETRACTED: {title}"], "updated-by": [notice("retraction")]},
        ]}})
    r = run(IntegrityPaper(id="p1", title=title), handler)
    assert r.status == "retracted"
    assert r.doi == "10.1016/original"


def test_a_doi_whose_title_is_marked_retracted_counts_without_a_notice():
    def handler(request):
        return httpx.Response(200, json={"message": {"DOI": "10.1234/abc", "title": ["WITHDRAWN: A trial"]}})
    r = run(IntegrityPaper(id="p1", title="A trial", doi="10.1234/abc"), handler)
    assert r.status == "retracted"


def test_a_rate_limited_request_is_retried(monkeypatch):
    from routers import integrity
    monkeypatch.setattr(integrity, "RETRY_DELAY_SECONDS", 0)
    calls = []
    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429)
        return httpx.Response(200, json={"message": {"DOI": "10.1234/abc", "updated-by": [notice("expression_of_concern")]}})
    r = run(IntegrityPaper(id="p1", title="t", doi="10.1234/abc"), handler)
    assert (r.status, len(calls)) == ("concern", 2)
