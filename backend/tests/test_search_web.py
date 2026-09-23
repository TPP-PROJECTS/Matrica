"""Unit tests for the web / grey-literature source.

The model call is faked; what is tested is everything around it — the record
guard, the year handling, and the way the source is declared, because a vendor
page must never be counted as a peer-reviewed record.
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from routers import search as search_mod  # noqa: E402
from routers.search import (  # noqa: E402
    DEFAULT_SOURCE_KEYS,
    SOURCES,
    SearchFilters,
    SearchRequest,
    SourceSearchError,
    _is_journal_publisher,
    _is_non_grey,
    describe_source,
    search_web,
)


class _FakeResponses:
    def __init__(self, text):
        self._text = text

    async def create(self, **_kwargs):
        class _R:
            output_text = self._text
        return _R()


class _FakeOpenAI:
    def __init__(self, text):
        self.responses = _FakeResponses(text)


@pytest.fixture
def fake_model(monkeypatch):
    def use(text):
        monkeypatch.setattr(search_mod, "_openai", _FakeOpenAI(text))
    return use


def run(coro):
    return asyncio.run(coro)


def test_records_become_papers_marked_as_web(fake_model):
    fake_model("""{"records": [
        {"title": "Epic Sepsis Model documentation", "publisher": "Epic Systems",
         "year": 2021, "url": "https://epic.com/sepsis", "summary": "How the model scores.",
         "kind": "documentation"}
    ]}""")
    papers, total = run(search_web("Epic Sepsis Model", 10, None))
    assert total == 1
    assert papers[0].source == "web"
    assert papers[0].url == "https://epic.com/sepsis"
    assert "Epic Systems" in papers[0].authors
    assert "Product documentation" in papers[0].authors


def test_a_record_without_a_reachable_url_is_dropped(fake_model):
    fake_model("""{"records": [
        {"title": "No address", "publisher": "X", "year": 2020, "url": "", "summary": "s"},
        {"title": "Not a link", "publisher": "X", "year": 2020, "url": "epic.com", "summary": "s"}
    ]}""")
    papers, total = run(search_web("anything", 10, None))
    assert papers == [] and total == 0


def test_the_same_page_is_returned_once(fake_model):
    fake_model("""{"records": [
        {"title": "A", "publisher": "X", "url": "https://a.example/doc", "summary": "s"},
        {"title": "A again", "publisher": "X", "url": "https://a.example/doc", "summary": "s"}
    ]}""")
    papers, _ = run(search_web("anything", 10, None))
    assert len(papers) == 1


def test_an_undated_page_survives_a_year_limit(fake_model):
    # Product documentation is undated by nature; dropping it would lose most of
    # what this source exists to find.
    fake_model("""{"records": [
        {"title": "Undated manual", "publisher": "X", "url": "https://a.example/m", "summary": "s"}
    ]}""")
    papers, _ = run(search_web("q", 10, None, 1, SearchFilters(yearFrom=2020)))
    assert len(papers) == 1
    assert papers[0].year is None


def test_a_dated_page_outside_the_year_limit_is_dropped(fake_model):
    fake_model("""{"records": [
        {"title": "Old", "publisher": "X", "year": 2001, "url": "https://a.example/o", "summary": "s"},
        {"title": "New", "publisher": "X", "year": 2023, "url": "https://a.example/n", "summary": "s"}
    ]}""")
    papers, _ = run(search_web("q", 10, None, 1, SearchFilters(yearFrom=2020)))
    assert [p.title for p in papers] == ["New"]


def test_the_limit_is_respected(fake_model):
    records = ",".join(
        f'{{"title": "T{i}", "publisher": "X", "url": "https://a.example/{i}", "summary": "s"}}'
        for i in range(10)
    )
    fake_model('{"records": [' + records + "]}")
    papers, total = run(search_web("q", 3, None))
    assert len(papers) == 3 and total == 3


def test_there_is_no_second_page(fake_model):
    fake_model('{"records": [{"title": "T", "publisher": "X", "url": "https://a.example/1", "summary": "s"}]}')
    papers, total = run(search_web("q", 10, None, page=2))
    assert papers == [] and total == 0


def test_unreadable_output_is_a_source_failure_not_an_empty_result(fake_model):
    fake_model("I could not find anything useful.")
    with pytest.raises(SourceSearchError):
        run(search_web("q", 10, None))


def test_the_source_is_declared_as_grey_literature_and_off_by_default():
    spec = SOURCES["web"]
    assert spec.grey_literature is True
    assert spec.comparable_hits is False
    assert "web" not in DEFAULT_SOURCE_KEYS


def test_the_strategy_record_says_the_count_is_not_an_identification_total():
    spec = SOURCES["web"]
    as_run = describe_source(spec, "Epic Sepsis Model", SearchFilters(yearFrom=2020))
    assert "web search: Epic Sepsis Model" in as_run
    assert "grey literature" in as_run
    # The limits it cannot express are named rather than silently ignored.
    assert "not supported by this database" in describe_source(
        spec, "q", SearchFilters(openAccessOnly=True)
    )


@pytest.mark.parametrize("url", [
    "https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2781307",
    "https://pubmed.ncbi.nlm.nih.gov/37405252/",
    "https://doi.org/10.1001/jamainternmed.2021.2626",
    "https://www.sciencedirect.com/science/article/pii/S000",
    "https://link.springer.com/article/10.1007/x",
    "http://WWW.Nature.com/articles/x",
    "https://arxiv.org/abs/2401.00001",
])
def test_journal_and_index_addresses_are_not_grey_literature(url):
    assert _is_non_grey(url) is True


@pytest.mark.parametrize("url", [
    "https://www.epic.com/software/sepsis",
    "https://www.fda.gov/media/12345/download",
    "https://www.nice.org.uk/guidance/ng51",
    "https://digital.nhs.uk/services/report",
    "https://perahealth.com/rothman-index/",
])
def test_vendor_regulator_and_agency_pages_are_grey_literature(url):
    assert _is_non_grey(url) is False


def test_a_journal_article_returned_by_the_model_is_discarded(fake_model):
    # The prompt forbids these; the filter is what makes it true. A peer-reviewed
    # paper arriving here would be counted on PRISMA's websites pathway and
    # labelled "not peer-reviewed" — both wrong, and usually a second copy of a
    # record the databases already returned.
    fake_model("""{"records": [
        {"title": "External Validation of a Proprietary Sepsis Model", "publisher": "JAMA Internal Medicine",
         "year": 2021, "url": "https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2781307",
         "summary": "s", "kind": "report"},
        {"title": "Sepsis model setup guide", "publisher": "Epic Systems", "year": 2023,
         "url": "https://www.epic.com/software/sepsis", "summary": "s", "kind": "documentation"}
    ]}""")
    papers, total = run(search_web("Epic Sepsis Model", 10, None))
    assert [p.title for p in papers] == ["Sepsis model setup guide"]
    assert total == 1


@pytest.mark.parametrize("publisher", [
    "Journal of Hospital Administration",
    "JAMA Network Open",
    "The Lancet Digital Health",
    "arXiv",
    "Springer Nature",
    "Annals of Internal Medicine",
])
def test_journal_publishers_are_recognised_by_name(publisher):
    assert _is_journal_publisher(publisher) is True


@pytest.mark.parametrize("publisher", [
    "Epic Systems", "PeraHealth", "US Food and Drug Administration",
    "NHS England", "NICE", "HIMSS", "KLAS Research",
])
def test_vendors_regulators_and_agencies_are_not_journal_publishers(publisher):
    assert _is_journal_publisher(publisher) is False


def test_a_record_the_model_admits_is_peer_reviewed_is_discarded(fake_model):
    fake_model("""{"records": [
        {"title": "A study", "publisher": "Some Institute", "url": "https://institute.example/x",
         "summary": "s", "kind": "report", "peer_reviewed": true},
        {"title": "A manual", "publisher": "Epic Systems", "url": "https://epic.example/m",
         "summary": "s", "kind": "documentation", "peer_reviewed": false}
    ]}""")
    papers, _ = run(search_web("q", 10, None))
    assert [p.title for p in papers] == ["A manual"]


def test_a_journal_on_its_own_domain_is_discarded_by_its_name(fake_model):
    # The address check cannot hold every journal host; the publisher's name is
    # what catches a small press on a domain no list knows about.
    fake_model("""{"records": [
        {"title": "The Rothman Index: assessing readmission risk", "publisher": "Journal of Hospital Administration",
         "year": 2019, "url": "https://www.sciedupress.com/journal/index.php/jha/article/view/1",
         "summary": "s", "kind": "report"}
    ]}""")
    papers, total = run(search_web("Rothman Index", 10, None))
    assert papers == [] and total == 0


def test_only_the_web_source_prefers_the_plain_language_subject():
    # A Boolean string written for PubMed is a bad web search; a database is
    # given the Boolean string and nothing else.
    assert SOURCES["web"].prefers_subject is True
    assert all(
        spec.prefers_subject is False
        for key, spec in SOURCES.items() if key != "web"
    )


def test_the_subject_defaults_to_empty_so_older_callers_are_unchanged():
    assert SearchRequest(query="x").subject == ""
