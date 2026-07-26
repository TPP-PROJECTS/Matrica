"""Unit tests for the search router's pure logic — query cleaning, abstract
reconstruction, cross-database deduplication, and filter translation. The HTTP
calls themselves are not exercised here."""
import sys
import asyncio
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.search import (  # noqa: E402
    PaperResult,
    SearchFilters,
    SearchRequest,
    SourceSearchError,
    _citation_title_key,
    _resolve_openalex_id,
    clean_query_openalex,
    deduplicate,
    openalex_filter_string,
    parse_pubmed_abstracts,
    pubmed_term,
    reconstruct_abstract,
    search_papers,
)


def paper(**kw) -> PaperResult:
    base = dict(
        title="A study of things",
        authors="Smith",
        year=2020,
        url="",
        openAccessUrl=None,
        abstract="",
        source="openalex",
    )
    base.update(kw)
    return PaperResult(**base)


# ── clean_query_openalex ──────────────────────────────────────────────────────

def test_clean_query_strips_boolean_operators_and_punctuation():
    assert clean_query_openalex('("machine learning" OR AI) AND diabetes') == "machine learning AI diabetes"


def test_clean_query_leaves_ordinary_text_alone():
    assert clean_query_openalex("diabetes prevention") == "diabetes prevention"


def test_clean_query_of_only_operators_is_empty():
    # The endpoint rejects this case with a 400 rather than searching for nothing.
    assert clean_query_openalex("AND OR ()") == ""


# ── citation seed resolution ──────────────────────────────────────────────────

def test_citation_title_key_ignores_only_case_and_punctuation():
    assert _citation_title_key("A Study: Of Things!") == "a study of things"


def test_resolve_citation_seed_from_pubmed_id_with_verified_title():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/works/pmid:12345")
        return httpx.Response(200, json={
            "id": "https://openalex.org/W123456789",
            "title": "A Study of Things",
            "publication_year": 2020,
        })

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await _resolve_openalex_id(
                client,
                "https://pubmed.ncbi.nlm.nih.gov/12345/",
                "A Study of Things",
                2020,
            )

    assert asyncio.run(run()) == "W123456789"


def test_resolve_citation_seed_rejects_wrong_pubmed_title():
    async def handler(request: httpx.Request) -> httpx.Response:
        # The subsequent exact-title fallback also returns no exact match.
        if request.url.path.endswith("/works/pmid:12345"):
            return httpx.Response(200, json={
                "id": "https://openalex.org/W123456789",
                "title": "A Different Paper",
                "publication_year": 2020,
            })
        return httpx.Response(200, json={"results": []})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await _resolve_openalex_id(
                client,
                "https://pubmed.ncbi.nlm.nih.gov/12345/",
                "A Study of Things",
                2020,
            )

    assert asyncio.run(run()) is None


# ── reconstruct_abstract ──────────────────────────────────────────────────────

def test_reconstruct_abstract_orders_words_by_position():
    inverted = {"world": [1], "hello": [0], "hello again": [2]}
    assert reconstruct_abstract(inverted) == "hello world hello again"


def test_reconstruct_abstract_handles_repeated_words():
    assert reconstruct_abstract({"the": [0, 2], "cat": [1], "hat": [3]}) == "the cat the hat"


def test_reconstruct_abstract_of_nothing_is_empty():
    assert reconstruct_abstract(None) == ""
    assert reconstruct_abstract({}) == ""


def test_parse_pubmed_abstracts_preserves_source_section_labels():
    xml = """<PubmedArticleSet><PubmedArticle><MedlineCitation>
      <PMID>123</PMID><Article><Abstract>
        <AbstractText Label="BACKGROUND">Why this matters.</AbstractText>
        <AbstractText Label="RESULTS">The measured result.</AbstractText>
      </Abstract></Article>
    </MedlineCitation></PubmedArticle></PubmedArticleSet>"""
    assert parse_pubmed_abstracts(xml) == {
        "123": "BACKGROUND: Why this matters. RESULTS: The measured result."
    }


# ── deduplicate ───────────────────────────────────────────────────────────────

def test_deduplicate_merges_same_doi_across_databases():
    a = paper(title="Deep learning", url="https://doi.org/10.1234/abc", source="openalex", abstract="")
    b = paper(title="Deep Learning.", url="https://doi.org/10.1234/ABC", source="pubmed", abstract="From PubMed.")
    out = deduplicate([a, b])
    assert len(out) == 1
    # The survivor inherits what the duplicate had and it did not.
    assert out[0].abstract == "From PubMed."
    assert out[0].source == "openalex+pubmed"


def test_deduplicate_falls_back_to_title_without_a_doi():
    a = paper(title="A Study of Things!", url="https://openalex.org/W1")
    b = paper(title="a study of things", url="https://pubmed.ncbi.nlm.nih.gov/9/")
    assert len(deduplicate([a, b])) == 1


def test_deduplicate_keeps_genuinely_different_papers():
    a = paper(title="Alpha", url="https://doi.org/10.1234/a")
    b = paper(title="Beta", url="https://doi.org/10.1234/b")
    assert len(deduplicate([a, b])) == 2


def test_deduplicate_prefers_a_resolvable_doi_link():
    a = paper(title="Alpha", url="https://openalex.org/W1")
    b = paper(title="Alpha", url="https://doi.org/10.1234/a")
    out = deduplicate([a, b])
    assert out[0].url == "https://doi.org/10.1234/a"


def test_deduplicate_of_empty_input():
    assert deduplicate([]) == []


# ── openalex_filter_string ────────────────────────────────────────────────────

def test_openalex_filter_string_with_no_filters_is_empty():
    assert openalex_filter_string(None) == ""
    assert openalex_filter_string(SearchFilters()) == ""


def test_openalex_filter_string_builds_each_limit():
    f = SearchFilters(yearFrom=2010, yearTo=2020, openAccessOnly=True,
                      excludePreprints=True, language="en")
    parts = openalex_filter_string(f).split(",")
    assert "from_publication_date:2010-01-01" in parts
    assert "to_publication_date:2020-12-31" in parts
    assert "is_oa:true" in parts
    assert "type:!preprint" in parts
    assert "language:en" in parts


def test_openalex_filter_string_omits_unset_year_bound():
    assert openalex_filter_string(SearchFilters(yearFrom=2015)) == "from_publication_date:2015-01-01"


# ── pubmed_term ───────────────────────────────────────────────────────────────

def test_pubmed_term_without_filters_is_the_raw_query():
    assert pubmed_term("diabetes", None) == "diabetes"
    assert pubmed_term("diabetes", SearchFilters()) == "diabetes"


def test_pubmed_term_open_ended_year_range_uses_sentinels():
    assert pubmed_term("x", SearchFilters(yearTo=1999)) == 'x AND ("1800"[dp] : "1999"[dp])'


def test_pubmed_term_appends_each_limit():
    term = pubmed_term("x", SearchFilters(openAccessOnly=True, excludePreprints=True, language="en"))
    assert '"pubmed pmc open access"[filter]' in term
    assert "NOT preprint[pt]" in term
    assert "AND english[lang]" in term


@pytest.mark.parametrize("code", ["xx", "klingon", "EN-GB"])
def test_pubmed_term_ignores_language_codes_it_cannot_map(code):
    # Passing an unmapped code through would make PubMed treat it as a keyword
    # and silently return the wrong results.
    assert "[lang]" not in pubmed_term("x", SearchFilters(language=code))


def test_pubmed_term_language_code_is_case_insensitive():
    assert "AND english[lang]" in pubmed_term("x", SearchFilters(language="EN"))


def test_search_reports_a_partial_database_failure(monkeypatch):
    async def openalex_ok(*_args, **_kwargs):
        return [paper(title="Verified result")], 1

    async def pubmed_failed(*_args, **_kwargs):
        raise SourceSearchError("PubMed", "temporary outage")

    monkeypatch.setattr("routers.search.search_openalex", openalex_ok)
    monkeypatch.setattr("routers.search.search_pubmed", pubmed_failed)
    result = asyncio.run(search_papers(SearchRequest(query="verified")))
    assert [item.title for item in result.papers] == ["Verified result"]
    assert result.sources_searched == ["OpenAlex"]
    assert result.source_errors == ["PubMed: temporary outage"]


def test_search_raises_when_every_database_failed(monkeypatch):
    async def failed(source):
        async def run(*_args, **_kwargs):
            raise SourceSearchError(source, "offline")
        return run

    monkeypatch.setattr("routers.search.search_openalex", asyncio.run(failed("OpenAlex")))
    monkeypatch.setattr("routers.search.search_pubmed", asyncio.run(failed("PubMed")))
    with pytest.raises(Exception) as exc:
        asyncio.run(search_papers(SearchRequest(query="verified")))
    assert getattr(exc.value, "status_code", None) == 502
