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
    DEFAULT_SOURCE_KEYS,
    SOURCES,
    PaperResult,
    SearchFilters,
    SearchRequest,
    SourceSearchError,
    _crossref_abstract,
    crossref_filter_string,
    describe_source,
    europe_pmc_term,
    list_sources,
    unapplied_limits,
    _citation_title_key,
    _resolve_openalex_id,
    _openalex_page_size,
    _pubmed_page_size,
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


# ── paging must not lose papers ───────────────────────────────────────────────
# The merged page used to be truncated to `limit`. Because each database's own
# offset had already moved past the discarded tail, "load more" could never
# fetch those records again — they left the review permanently.

def test_search_returns_the_whole_deduplicated_union(monkeypatch):
    """Nothing retrieved from either database is dropped on the way out."""
    async def openalex(*_args, **_kwargs):
        return [paper(title=f"OA {i}", url=f"https://doi.org/10.1/oa{i}") for i in range(15)], 500

    async def pubmed(*_args, **_kwargs):
        return [paper(title=f"PM {i}", url=f"https://doi.org/10.1/pm{i}", source="pubmed") for i in range(7)], 300

    monkeypatch.setattr("routers.search.search_openalex", openalex)
    monkeypatch.setattr("routers.search.search_pubmed", pubmed)

    result = asyncio.run(search_papers(SearchRequest(query="paging", limit=15)))
    assert len(result.papers) == 22
    assert {p.title for p in result.papers} == {f"OA {i}" for i in range(15)} | {f"PM {i}" for i in range(7)}


def test_search_still_collapses_cross_database_duplicates(monkeypatch):
    """Returning the whole union must not mean returning the same paper twice."""
    async def openalex(*_args, **_kwargs):
        return [paper(title="Shared", url="https://doi.org/10.1/shared", abstract="full")], 1

    async def pubmed(*_args, **_kwargs):
        return [paper(title="Shared", url="https://doi.org/10.1/shared", source="pubmed")], 1

    monkeypatch.setattr("routers.search.search_openalex", openalex)
    monkeypatch.setattr("routers.search.search_pubmed", pubmed)

    result = asyncio.run(search_papers(SearchRequest(query="dup")))
    assert len(result.papers) == 1
    assert result.papers[0].source == "openalex+pubmed"


def test_has_more_uses_the_same_page_size_the_search_applied():
    """The offset advanced per page and the has_more arithmetic must agree."""
    for limit in (5, 15, 30, 100):
        assert _openalex_page_size(limit) == min(limit, 25)
        assert _pubmed_page_size(limit) == min(limit, 20)


# ── Source registry ───────────────────────────────────────────────────────────
# Two biomedical-leaning databases cannot answer a review outside medicine, so
# which databases are searchable — and which were searched — is load-bearing.


def test_every_registered_source_is_offered_to_the_frontend():
    offered = list_sources()
    assert {s["key"] for s in offered} == set(SOURCES)
    assert {s["key"] for s in offered if s["default"]} == set(DEFAULT_SOURCE_KEYS)


def test_naming_no_sources_searches_the_historical_pair(monkeypatch):
    """An older client that does not know about the setting is unaffected."""
    searched = []

    def record(name):
        async def run(*_args, **_kwargs):
            searched.append(name)
            return [], 0
        return run

    monkeypatch.setattr("routers.search.search_openalex", record("openalex"))
    monkeypatch.setattr("routers.search.search_pubmed", record("pubmed"))
    monkeypatch.setattr("routers.search.search_crossref", record("crossref"))
    asyncio.run(search_papers(SearchRequest(query="anything")))
    assert sorted(searched) == ["openalex", "pubmed"]


def test_a_selection_searches_only_the_databases_named(monkeypatch):
    async def crossref(*_args, **_kwargs):
        return [paper(title="Crossref only", source="crossref")], 3

    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("an unselected database was searched")

    monkeypatch.setattr("routers.search.search_crossref", crossref)
    monkeypatch.setattr("routers.search.search_openalex", must_not_run)
    monkeypatch.setattr("routers.search.search_pubmed", must_not_run)

    result = asyncio.run(search_papers(SearchRequest(query="bridges", sources=["crossref"])))
    assert result.sources_searched == ["Crossref"]
    assert [p.title for p in result.papers] == ["Crossref only"]


def test_selecting_only_unknown_sources_is_rejected():
    with pytest.raises(Exception) as exc:
        asyncio.run(search_papers(SearchRequest(query="x", sources=["scopus"])))
    assert getattr(exc.value, "status_code", None) == 400


def test_a_failing_source_that_does_not_name_itself_is_still_attributed(monkeypatch):
    async def broken(*_args, **_kwargs):
        raise RuntimeError("connection reset")

    async def fine(*_args, **_kwargs):
        return [paper(title="Kept")], 1

    monkeypatch.setattr("routers.search.search_semantic_scholar", broken)
    monkeypatch.setattr("routers.search.search_openalex", fine)
    result = asyncio.run(search_papers(
        SearchRequest(query="x", sources=["openalex", "semanticscholar"])
    ))
    assert result.source_errors == ["Semantic Scholar: connection reset"]
    assert result.sources_searched == ["OpenAlex"]


def test_has_more_is_true_when_any_selected_database_has_pages_left(monkeypatch):
    async def exhausted(*_args, **_kwargs):
        return [paper(title="Only one")], 1

    async def deep(*_args, **_kwargs):
        return [paper(title="First of many", url="https://doi.org/10.1/x")], 900

    monkeypatch.setattr("routers.search.search_openalex", exhausted)
    monkeypatch.setattr("routers.search.search_crossref", deep)
    result = asyncio.run(search_papers(
        SearchRequest(query="x", limit=15, sources=["openalex", "crossref"])
    ))
    assert result.has_more is True


# ── Hit counts that do not mean "records identified" ──────────────────────────
# Crossref and Semantic Scholar rank by relevance over the query terms taken
# separately, so their reported totals *rise* as a query gets more specific:
# Crossref answers "sepsis" with 85k and a ten-word question with 4.6M, where
# OpenAlex narrows 840k to 9.8k over the same pair. Summing a figure like that
# into the PRISMA identification total would put millions of records into a flow
# diagram that never saw them.


def test_a_relevance_total_is_kept_out_of_the_identification_count(monkeypatch):
    async def openalex(*_args, **_kwargs):
        return [paper(title="Real hit")], 40

    async def crossref(*_args, **_kwargs):
        return [paper(title="Also found", url="https://doi.org/10.1/c", source="crossref")], 4_600_000

    monkeypatch.setattr("routers.search.search_openalex", openalex)
    monkeypatch.setattr("routers.search.search_crossref", crossref)
    result = asyncio.run(search_papers(
        SearchRequest(query="x", sources=["openalex", "crossref"])
    ))
    assert result.total_available == 40
    # The papers themselves are still retrieved and screened — only the count
    # is withheld from the total.
    assert len(result.papers) == 2


def test_the_relevance_total_is_still_reported_next_to_what_it_means(monkeypatch):
    async def crossref(*_args, **_kwargs):
        return [], 4_600_000

    monkeypatch.setattr("routers.search.search_crossref", crossref)
    result = asyncio.run(search_papers(SearchRequest(query="x", sources=["crossref"])))
    strategy = result.source_queries[0]
    assert strategy.hits == 4_600_000
    assert "excluded from the identification total" in strategy.query_as_run


def test_a_boolean_database_reports_a_plain_strategy():
    as_run = describe_source(SOURCES["europepmc"], "sepsis", None)
    assert "identification total" not in as_run


def test_the_picker_is_told_which_hit_counts_are_comparable():
    by_key = {s["key"]: s for s in list_sources()}
    assert by_key["openalex"]["comparableHits"] is True
    assert by_key["europepmc"]["comparableHits"] is True
    assert by_key["crossref"]["comparableHits"] is False
    assert by_key["semanticscholar"]["comparableHits"] is False


# ── Reporting a limit a database cannot express ───────────────────────────────
# Crossref has no open-access or language filter. Dropping the database would
# cost coverage; saying nothing would let a reader believe the limit held across
# every source. The strategy as run records that it did not.


def test_unapplied_limits_names_only_the_limits_actually_set():
    crossref = SOURCES["crossref"]
    assert unapplied_limits(crossref, SearchFilters(yearFrom=2015)) == []
    assert unapplied_limits(crossref, SearchFilters(openAccessOnly=True)) == ["open access only"]
    assert unapplied_limits(
        crossref, SearchFilters(openAccessOnly=True, language="en")
    ) == ["open access only", "language"]


def test_the_strategy_as_run_says_which_limit_was_not_applied():
    as_run = describe_source(
        SOURCES["crossref"], "bridge fatigue", SearchFilters(openAccessOnly=True),
    )
    assert "not applied: open access only" in as_run


def test_a_database_that_supports_every_limit_adds_no_note():
    as_run = describe_source(
        SOURCES["europepmc"], "sepsis", SearchFilters(openAccessOnly=True, language="en"),
    )
    assert "not applied" not in as_run


# ── Per-database limit translation ────────────────────────────────────────────

def test_europe_pmc_carries_each_limit_as_a_query_clause():
    term = europe_pmc_term("sepsis", SearchFilters(
        yearFrom=2015, yearTo=2021, openAccessOnly=True, excludePreprints=True, language="en",
    ))
    assert "FIRST_PDATE:[2015-01-01 TO 2021-12-31]" in term
    assert "OPEN_ACCESS:Y" in term
    assert "NOT (SRC:PPR)" in term
    assert "LANG:eng" in term


def test_europe_pmc_ignores_a_language_code_it_cannot_map():
    assert europe_pmc_term("x", SearchFilters(language="qq")) == "x"


def test_crossref_excludes_preprints_by_restricting_the_type():
    assert crossref_filter_string(SearchFilters(excludePreprints=True)) == "type:journal-article"
    assert crossref_filter_string(SearchFilters(yearFrom=2015)) == "from-pub-date:2015-01-01"
    assert crossref_filter_string(None) == ""


def test_crossref_abstract_is_stripped_of_its_jats_markup():
    raw = "<jats:p>Early <jats:italic>recognition</jats:italic> is hard.</jats:p>"
    assert _crossref_abstract(raw) == "Early recognition is hard."
    assert _crossref_abstract(None) == ""
