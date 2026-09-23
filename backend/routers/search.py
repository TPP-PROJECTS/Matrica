import asyncio
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Callable

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel

from config import MODEL
from routers.json_utils import extract_json

load_dotenv()

router = APIRouter()

_openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

OPENALEX_URL = "https://api.openalex.org/works"
PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_FETCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
PUBMED_SUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

OPENALEX_FIELDS = "title,authorships,publication_year,doi,open_access,id,abstract_inverted_index"
_UA = {"User-Agent": "ResearchAI-tool (research@example.com)"}


def clean_query_openalex(raw: str) -> str:
    """Strip boolean operators — OpenAlex uses relevance search, not boolean."""
    cleaned = re.sub(r'\b(AND|OR|NOT)\b', ' ', raw)
    cleaned = re.sub(r'[()"]', ' ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned


def reconstruct_abstract(inverted_index: dict | None) -> str:
    if not inverted_index:
        return ''
    pairs: list[tuple[int, str]] = []
    for word, positions in inverted_index.items():
        for pos in positions:
            pairs.append((pos, word))
    pairs.sort(key=lambda x: x[0])
    return ' '.join(word for _, word in pairs)


def parse_pubmed_abstracts(xml_text: str) -> dict[str, str]:
    """Extract genuine PMID → abstract text from PubMed efetch XML."""
    if not xml_text.strip():
        return {}
    root = ET.fromstring(xml_text)
    abstracts: dict[str, str] = {}
    for article in root.findall(".//PubmedArticle"):
        pmid_node = article.find("./MedlineCitation/PMID")
        pmid = "".join(pmid_node.itertext()).strip() if pmid_node is not None else ""
        if not pmid:
            continue
        sections: list[str] = []
        for node in article.findall("./MedlineCitation/Article/Abstract/AbstractText"):
            text = " ".join("".join(node.itertext()).split())
            if not text:
                continue
            label = (node.attrib.get("Label") or "").strip()
            sections.append(f"{label}: {text}" if label else text)
        if sections:
            abstracts[pmid] = " ".join(sections)
    return abstracts


class SearchFilters(BaseModel):
    """Narrowing applied before screening — the equivalent of a database's own
    limit controls. Every field is optional; an unset field means "no limit"."""
    yearFrom: int | None = None
    yearTo: int | None = None
    openAccessOnly: bool = False
    excludePreprints: bool = False
    language: str = ""          # ISO 639-1 code, "" = any language


class SearchRequest(BaseModel):
    query: str
    limit: int = 15
    page: int = 1                       # 1-based; drives "load more"
    filters: SearchFilters | None = None
    # Which databases to search, by key (see SOURCES). None keeps the historical
    # pair, so a caller that predates the setting searches what it always did.
    sources: list[str] | None = None
    #: What the search is *about*, in plain language — typically a system's name
    #: and vendor. A Boolean query written for a bibliographic database is a poor
    #: web search: run verbatim it surfaces the journal articles it was written
    #: to find, which is exactly what the grey-literature source must not return.
    #: Sources that are not bibliographic databases search this instead when it
    #: is given; everything else ignores it.
    subject: str = ""


class PaperResult(BaseModel):
    title: str
    authors: str
    year: int | None
    url: str
    openAccessUrl: str | None
    abstract: str
    source: str = "openalex"


class SourceQuery(BaseModel):
    """Exactly what one database was asked, and what it reported back.

    PRISMA 2020 item 7 requires the full search strategy for every database,
    including any filters, so the search can be re-run and audited. The tool
    rewrites the user's query per database — OpenAlex has no boolean syntax and
    PubMed takes its limits as extra query terms — so reporting the string the
    user typed would not be reproducible. This carries the string as actually
    sent.
    """
    source: str
    query_as_run: str
    hits: int


class SearchResponse(BaseModel):
    papers: list[PaperResult]
    query_used: str
    sources_searched: list[str] = ["OpenAlex", "PubMed"]
    source_errors: list[str] = []
    # Per-database strategies, for the reproducible search-strategy appendix.
    source_queries: list[SourceQuery] = []
    # Total hits the databases report for this query, across all pages. This is
    # the "records identified" figure a PRISMA flow diagram needs, so it is
    # reported even though only `limit` papers come back in this response.
    total_available: int = 0
    page: int = 1
    has_more: bool = False


class SourceSearchError(RuntimeError):
    """One external database failed, as distinct from returning zero matches."""

    def __init__(self, source: str, detail: str):
        self.source = source
        self.detail = detail
        super().__init__(f"{source}: {detail}")


def parse_openalex_item(item: dict) -> PaperResult:
    """Convert a single OpenAlex work JSON object into a PaperResult."""
    authorships = item.get("authorships") or []
    author_names = [a["author"]["display_name"] for a in authorships[:3] if a.get("author")]
    authors_str = ", ".join(author_names)
    if len(authorships) > 3:
        authors_str += " et al."

    doi = item.get("doi") or ""
    openalex_id = item.get("id") or ""
    url = doi if doi else openalex_id

    oa = item.get("open_access") or {}
    oa_url = oa.get("oa_url") if oa.get("is_oa") else None

    return PaperResult(
        title=item.get("title") or "",
        authors=authors_str,
        year=item.get("publication_year"),
        url=url,
        openAccessUrl=oa_url,
        abstract=reconstruct_abstract(item.get("abstract_inverted_index")),
        source="openalex",
    )


def openalex_filter_string(f: SearchFilters | None) -> str:
    """Translate our filters into OpenAlex's comma-separated filter syntax."""
    if f is None:
        return ""
    parts: list[str] = []
    if f.yearFrom is not None:
        parts.append(f"from_publication_date:{f.yearFrom}-01-01")
    if f.yearTo is not None:
        parts.append(f"to_publication_date:{f.yearTo}-12-31")
    if f.openAccessOnly:
        parts.append("is_oa:true")
    if f.excludePreprints:
        parts.append("type:!preprint")
    if f.language:
        parts.append(f"language:{f.language}")
    return ",".join(parts)


def pubmed_term(query_text: str, f: SearchFilters | None) -> str:
    """Append PubMed's own limit syntax to the raw query term."""
    if f is None:
        return query_text
    term = query_text
    if f.yearFrom is not None or f.yearTo is not None:
        lo = f.yearFrom if f.yearFrom is not None else 1800
        hi = f.yearTo if f.yearTo is not None else 3000
        term += f' AND ("{lo}"[dp] : "{hi}"[dp])'
    if f.openAccessOnly:
        term += ' AND "pubmed pmc open access"[filter]'
    if f.excludePreprints:
        term += ' NOT preprint[pt]'
    if f.language:
        # PubMed wants the language name, not the ISO code.
        name = _PUBMED_LANGUAGES.get(f.language.lower())
        if name:
            term += f' AND {name}[lang]'
    return term


# The handful of codes worth mapping; anything else is left unfiltered on PubMed
# rather than sent as a term PubMed would silently treat as a keyword.
_PUBMED_LANGUAGES = {
    "en": "english", "zh": "chinese", "fr": "french", "de": "german",
    "es": "spanish", "ja": "japanese", "pt": "portuguese", "ru": "russian",
}


# Each database's page size is a pure function of the requested limit, so the
# offset for page N is the same on every call. Deriving them anywhere else risks
# the two drifting apart, which silently skips or repeats records between pages.
def _openalex_page_size(limit: int) -> int:
    return min(limit, 25)


def _pubmed_page_size(limit: int) -> int:
    return min(limit, 20)


async def search_openalex(
    query_text: str, limit: int, client: httpx.AsyncClient,
    page: int = 1, filters: SearchFilters | None = None,
) -> tuple[list[PaperResult], int]:
    """Returns (papers on this page, total hits across all pages)."""
    params = {
        "search": query_text,
        "per-page": _openalex_page_size(limit),
        "page": max(page, 1),
        "select": OPENALEX_FIELDS,
    }
    filter_str = openalex_filter_string(filters)
    if filter_str:
        params["filter"] = filter_str
    try:
        resp = await client.get(
            OPENALEX_URL,
            params=params,
            headers={"User-Agent": "ResearchAI-tool (research@example.com)"},
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as error:
        raise SourceSearchError("OpenAlex", str(error)) from error

    total = int((data.get("meta") or {}).get("count") or 0)
    return [parse_openalex_item(item) for item in data.get("results", [])], total


async def search_pubmed(
    query_text: str, limit: int, client: httpx.AsyncClient,
    page: int = 1, filters: SearchFilters | None = None,
) -> tuple[list[PaperResult], int]:
    """Search PubMed via E-utilities (free, no API key required).

    Returns (papers on this page, total hits across all pages)."""
    retmax = _pubmed_page_size(limit)
    try:
        # Step 1: esearch — get PMIDs
        search_resp = await client.get(
            PUBMED_SEARCH_URL,
            params={
                "db": "pubmed",
                "term": pubmed_term(query_text, filters),
                "retmax": retmax,
                "retstart": (max(page, 1) - 1) * retmax,
                "retmode": "json",
                "sort": "relevance",
            },
            headers={"User-Agent": "ResearchAI-tool (research@example.com)"},
        )
        search_resp.raise_for_status()
        search_data = search_resp.json()
        esearch = search_data.get("esearchresult", {})
        pmids = esearch.get("idlist", [])
        total = int(esearch.get("count") or 0)
        if not pmids:
            return [], total

        # Step 2: esummary — get metadata for each PMID
        summary_resp = await client.get(
            PUBMED_SUMMARY_URL,
            params={
                "db": "pubmed",
                "id": ",".join(pmids),
                "retmode": "json",
            },
            headers={"User-Agent": "ResearchAI-tool (research@example.com)"},
        )
        summary_resp.raise_for_status()
        summary_data = summary_resp.json()
        result_map = summary_data.get("result", {})

        # esummary omits abstracts. Fetch the matching PubMed XML and attach
        # only the source text returned by NCBI—nothing is generated locally.
        abstracts_by_pmid: dict[str, str] = {}
        try:
            abstract_resp = await client.get(
                PUBMED_FETCH_URL,
                params={
                    "db": "pubmed",
                    "id": ",".join(pmids),
                    "retmode": "xml",
                },
                headers={"User-Agent": "ResearchAI-tool (research@example.com)"},
            )
            abstract_resp.raise_for_status()
            abstracts_by_pmid = parse_pubmed_abstracts(abstract_resp.text)
        except Exception:
            # Keep the genuine citation metadata if NCBI's separate abstract
            # request fails; the paper remains explicitly abstract-less.
            pass

    except Exception as error:
        raise SourceSearchError("PubMed", str(error)) from error

    papers = []
    for pmid in pmids:
        item = result_map.get(pmid, {})
        if not item or "title" not in item:
            continue

        # Authors
        authors_list = item.get("authors", [])
        author_names = [a.get("name", "") for a in authors_list[:3]]
        authors_str = ", ".join(n for n in author_names if n)
        if len(authors_list) > 3:
            authors_str += " et al."

        # Year from pubdate
        pubdate = item.get("pubdate", "")
        year = None
        if pubdate:
            m = re.match(r'(\d{4})', pubdate)
            if m:
                year = int(m.group(1))

        # URL
        doi = ""
        for article_id in item.get("articleids", []):
            if article_id.get("idtype") == "doi":
                doi = article_id.get("value", "")
                break
        url = f"https://doi.org/{doi}" if doi else f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"

        papers.append(PaperResult(
            title=item.get("title", "").rstrip("."),
            authors=authors_str,
            year=year,
            url=url,
            openAccessUrl=None,
            abstract=abstracts_by_pmid.get(pmid, ""),
            source="pubmed",
        ))
    return papers, total


# ── Crossref ──────────────────────────────────────────────────────────────────
# Every work with a DOI, across every discipline. Its coverage is the widest of
# any free source, and it is the one that reaches the engineering, humanities
# and social-science literature that a biomedical pair of databases misses.

CROSSREF_URL = "https://api.crossref.org/works"


def _crossref_page_size(limit: int) -> int:
    return min(limit, 20)


def crossref_filter_string(f: SearchFilters | None) -> str:
    parts: list[str] = []
    if f is None:
        return ""
    if f.yearFrom is not None:
        parts.append(f"from-pub-date:{f.yearFrom}-01-01")
    if f.yearTo is not None:
        parts.append(f"until-pub-date:{f.yearTo}-12-31")
    # Crossref has no preprint flag; a preprint is deposited as `posted-content`,
    # so restricting to journal articles is the equivalent limit.
    if f.excludePreprints:
        parts.append("type:journal-article")
    return ",".join(parts)


def _crossref_abstract(raw: str | None) -> str:
    """Crossref stores abstracts as JATS XML; the tags are not part of the text."""
    if not raw:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", text).strip()


async def search_crossref(
    query_text: str, limit: int, client: httpx.AsyncClient,
    page: int = 1, filters: SearchFilters | None = None,
) -> tuple[list[PaperResult], int]:
    rows = _crossref_page_size(limit)
    params: dict[str, str | int] = {
        "query.bibliographic": query_text,
        "rows": rows,
        "offset": (max(page, 1) - 1) * rows,
        "select": "title,author,issued,DOI,abstract,URL,link",
    }
    filter_str = crossref_filter_string(filters)
    if filter_str:
        params["filter"] = filter_str
    try:
        resp = await client.get(CROSSREF_URL, params=params, headers=_UA)
        resp.raise_for_status()
        message = resp.json().get("message") or {}
    except Exception as error:
        raise SourceSearchError("Crossref", str(error)) from error

    papers: list[PaperResult] = []
    for item in message.get("items") or []:
        titles = item.get("title") or []
        title = titles[0] if titles else ""
        if not title:
            continue
        authors_list = item.get("author") or []
        names = [
            " ".join(part for part in (a.get("given"), a.get("family")) if part)
            for a in authors_list[:3]
        ]
        authors = ", ".join(n for n in names if n)
        if len(authors_list) > 3:
            authors += " et al."
        date_parts = ((item.get("issued") or {}).get("date-parts") or [[]])[0]
        doi = item.get("DOI") or ""
        papers.append(PaperResult(
            title=re.sub(r"\s+", " ", title).strip(),
            authors=authors,
            year=date_parts[0] if date_parts else None,
            url=f"https://doi.org/{doi}" if doi else (item.get("URL") or ""),
            openAccessUrl=None,
            abstract=_crossref_abstract(item.get("abstract")),
            source="crossref",
        ))
    return papers, int(message.get("total-results") or 0)


# ── Semantic Scholar ──────────────────────────────────────────────────────────
# Computer science, engineering and the social sciences, where OpenAlex is
# thinner and PubMed is absent entirely. Abstracts come back with the search
# results, so its records need no follow-up request.

SEMANTIC_SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
SEMANTIC_SCHOLAR_FIELDS = "title,abstract,year,authors,externalIds,openAccessPdf,publicationTypes"


def _semantic_scholar_page_size(limit: int) -> int:
    return min(limit, 20)


async def search_semantic_scholar(
    query_text: str, limit: int, client: httpx.AsyncClient,
    page: int = 1, filters: SearchFilters | None = None,
) -> tuple[list[PaperResult], int]:
    size = _semantic_scholar_page_size(limit)
    params: dict[str, str | int] = {
        "query": query_text,
        "limit": size,
        "offset": (max(page, 1) - 1) * size,
        "fields": SEMANTIC_SCHOLAR_FIELDS,
    }
    if filters is not None:
        if filters.yearFrom is not None or filters.yearTo is not None:
            params["year"] = f"{filters.yearFrom or ''}-{filters.yearTo or ''}"
        if filters.openAccessOnly:
            # A valueless flag: its presence restricts to records with an OA PDF.
            params["openAccessPdf"] = ""
        if filters.excludePreprints:
            params["publicationTypes"] = "JournalArticle,Conference,Review"
    try:
        resp = await client.get(SEMANTIC_SCHOLAR_URL, params=params, headers=_UA)
        resp.raise_for_status()
        data = resp.json()
    except Exception as error:
        raise SourceSearchError("Semantic Scholar", str(error)) from error

    papers: list[PaperResult] = []
    for item in data.get("data") or []:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        authors_list = item.get("authors") or []
        authors = ", ".join((a.get("name") or "") for a in authors_list[:3] if a.get("name"))
        if len(authors_list) > 3:
            authors += " et al."
        ids = item.get("externalIds") or {}
        doi = ids.get("DOI") or ""
        paper_id = item.get("paperId") or ""
        oa = item.get("openAccessPdf") or {}
        papers.append(PaperResult(
            title=title,
            authors=authors,
            year=item.get("year"),
            url=f"https://doi.org/{doi}" if doi else f"https://www.semanticscholar.org/paper/{paper_id}",
            openAccessUrl=oa.get("url"),
            abstract=(item.get("abstract") or "").strip(),
            source="semanticscholar",
        ))
    return papers, int(data.get("total") or 0)


# ── Web & documentation (grey literature) ─────────────────────────────────────
# Systems under review are the case this exists for. A commercial platform's
# evaluation record is often a vendor white paper, a regulatory filing, an
# implementation report or the product documentation itself — none of which is
# indexed by a bibliographic database, so a literature-only search for it comes
# back empty and the system looks unstudied when it is merely unindexed.
#
# PRISMA 2020 treats this as the *other* identification pathway ("websites,
# organisations, citation searching"), counted and reported separately from
# database searching, and that is exactly how the records are labelled here:
# `source="web"` travels with every one of them so nothing downstream can mix a
# vendor page into the peer-reviewed count.

WEB_SEARCH_PROMPT = """You are a research librarian retrieving GREY LITERATURE with web search.

Find real, currently reachable web pages that document or evaluate the subject of the query:
official product documentation, vendor white papers, technical reports, regulatory filings and
clearances, standards documents, government or health-service evaluations, implementation reports,
and reputable news or industry analyses.

How to search: run SEVERAL web searches, not one. Search the subject on its own; search it with
"documentation", "user guide", "white paper", "technical brief"; search it with the name of its
regulator or of the agencies that deploy it. The query you are given was written for a
bibliographic database, so searching it verbatim mostly surfaces journal articles, which are not
what this task wants.

Rules:
- Use web search. Every record MUST be a page you actually found, with its real URL.
- Never return a peer-reviewed journal article, and never link to a journal, publisher or
  bibliographic index (jamanetwork.com, sciencedirect.com, springer.com, nature.com, wiley.com,
  bmj.com, thelancet.com, nejm.org, pubmed.ncbi.nlm.nih.gov, pmc.ncbi.nlm.nih.gov, doi.org,
  arxiv.org, medrxiv.org, researchgate.net, …). The bibliographic databases already cover those,
  and a record from one of them is not grey literature. Such a record will be discarded.
- Never invent a page, a publisher or a date. Omit a field you cannot establish.
- Prefer primary sources: the vendor's own site, the regulator, the standards body, the health
  service or agency that deployed the system.

The publisher must be the system's vendor, a regulator, a standards body, a government agency or
health service, a professional body, or a news / industry outlet — never an academic journal.

For each record return:
- title: the page or document title
- publisher: the organisation responsible for the page
- year: four-digit year of publication, or null if the page does not state one
- url: the page's real URL
- summary: 2-3 sentences on what the document says about the subject
- kind: one of "documentation", "white_paper", "regulatory", "report", "standard", "news", "other"
- peer_reviewed: true if this page is an article published in an academic journal or in conference
  proceedings, false otherwise. Answer this honestly for every record; a record marked true is
  discarded, because the bibliographic databases already cover it.

Respond ONLY with valid JSON:
{
  "records": [
    {
      "title": "...",
      "publisher": "...",
      "year": 2023,
      "url": "https://...",
      "summary": "...",
      "kind": "documentation",
      "peer_reviewed": false
    }
  ]
}
Your entire reply must be that JSON object and nothing else. If every page you found is a journal
article, or you found nothing at all, reply with exactly {"records": []} — never explain in prose,
never apologise, never describe what you could not find. Prose is unreadable to the caller and is
reported to the user as a failed search."""

#: How long the model is given to run its web search and answer. Longer than an
#: HTTP database because it is doing several searches and reading pages; still
#: bounded, so one slow source cannot hold up the databases that already
#: answered.
WEB_SEARCH_TIMEOUT_SECONDS = 90.0

#: Labels for the `kind` field, used in the record's authorship line so a
#: reviewer can see what sort of document it is without opening it.
_WEB_KINDS = {
    "documentation": "Product documentation",
    "white_paper": "White paper",
    "regulatory": "Regulatory document",
    "report": "Report",
    "standard": "Standard",
    "news": "News / industry analysis",
    "other": "Web page",
}


#: Hosts whose pages are peer-reviewed literature, a publisher's copy of it, or
#: a bibliographic index of it. A record from one of these is not grey
#: literature, it is a database record arriving by the wrong door — counted on
#: the wrong PRISMA pathway, labelled "not peer-reviewed" when it is, and often
#: a second copy of something the databases already returned. The model is told
#: not to return them and they are dropped here when it does anyway.
_NON_GREY_HOSTS = frozenset({
    "doi.org", "dx.doi.org",
    "pubmed.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov",
    "jamanetwork.com", "nejm.org", "bmj.com", "thelancet.com", "acpjournals.org",
    "sciencedirect.com", "elsevier.com", "springer.com", "link.springer.com",
    "springeropen.com", "nature.com", "wiley.com", "onlinelibrary.wiley.com",
    "tandfonline.com", "sagepub.com", "journals.sagepub.com", "frontiersin.org",
    "mdpi.com", "plos.org", "journals.plos.org", "biomedcentral.com",
    "academic.oup.com", "oup.com", "cambridge.org", "jmir.org", "ahajournals.org",
    "atsjournals.org", "annualreviews.org", "karger.com", "liebertpub.com",
    "ieee.org", "ieeexplore.ieee.org", "dl.acm.org", "acm.org",
    "arxiv.org", "medrxiv.org", "biorxiv.org", "ssrn.com", "papers.ssrn.com",
    "researchgate.net", "semanticscholar.org", "scholar.google.com",
    "europepmc.org", "openalex.org", "scopus.com", "webofscience.com",
})


def _is_non_grey(url: str) -> bool:
    """True for a journal, publisher or bibliographic-index address."""
    host = re.sub(r"^https?://", "", url).split("/")[0].split("?")[0].lower()
    host = host.split("@")[-1].split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    if host in _NON_GREY_HOSTS:
        return True
    # Subdomains of a blocked host are blocked with it.
    return any(host.endswith("." + blocked) for blocked in _NON_GREY_HOSTS)


#: Words that appear in the name of a journal or a proceedings, and essentially
#: never in the name of a vendor, a regulator or an agency. There are far more
#: journal hosts than any list can hold, so the publisher's own name is checked
#: as well as the address.
_JOURNAL_NAME_MARKERS = (
    "journal", "proceedings", "annals", "review of", "quarterly",
    "jama", "lancet", "bmj", "nejm", "new england journal",
    "arxiv", "medrxiv", "biorxiv", "preprint",
    "elsevier", "springer", "wiley", "taylor & francis", "sage publications",
    "frontiers in", "plos", "biomed central", "oxford university press",
)


def _is_journal_publisher(publisher: str) -> bool:
    """True when the named publisher is an academic journal or its press."""
    name = publisher.lower()
    return any(marker in name for marker in _JOURNAL_NAME_MARKERS)


def _web_page_size(limit: int) -> int:
    return min(max(limit, 1), 10)


def _web_as_run(query_text: str, f: SearchFilters | None) -> str:
    parts = [f'web search: {query_text}']
    if f is not None and (f.yearFrom is not None or f.yearTo is not None):
        parts.append(f"published {f.yearFrom or 'any'}–{f.yearTo or 'any'}")
    return "  ".join(parts)


def _web_record_year(raw: object) -> int | None:
    """A four-digit year, or None. The model is told to omit what it cannot establish."""
    if isinstance(raw, int) and 1000 <= raw <= 9999:
        return raw
    if isinstance(raw, str):
        match = re.search(r"\b(1\d{3}|2\d{3})\b", raw)
        if match:
            return int(match.group(1))
    return None


def _web_in_year_range(year: int | None, f: SearchFilters | None) -> bool:
    """Year limits are applied here — the model is asked for them, not trusted with them."""
    if f is None:
        return True
    if year is None:
        # A page with no stated date cannot be shown to meet a year limit, but
        # dropping it would silently lose most product documentation, which is
        # undated by nature. It is kept, and its missing year is visible.
        return True
    if f.yearFrom is not None and year < f.yearFrom:
        return False
    if f.yearTo is not None and year > f.yearTo:
        return False
    return True


async def search_web(
    query_text: str, limit: int, client: httpx.AsyncClient,
    page: int = 1, filters: SearchFilters | None = None,
) -> tuple[list[PaperResult], int]:
    """Grey literature for one query, via the model's web search.

    `client` is unused: this source is not an HTTP API. It keeps the signature
    every source shares so the dispatch loop needs no special case.
    """
    if page > 1:
        # Web search has no stable paging — asking again returns the same pages
        # in a different order. One page is what this source offers, and
        # reporting a total equal to what came back keeps "load more" off.
        return [], 0

    size = _web_page_size(limit)
    ask = [f"Subject of the search:\n{query_text}", f"Return at most {size} records."]
    if filters is not None and (filters.yearFrom is not None or filters.yearTo is not None):
        ask.append(
            f"Prefer documents published between {filters.yearFrom or 'any year'} and "
            f"{filters.yearTo or 'any year'}."
        )

    try:
        response = await asyncio.wait_for(
            _openai.responses.create(
                model=MODEL,
                instructions=WEB_SEARCH_PROMPT,
                input="\n\n".join(ask),
                tools=[{"type": "web_search_preview"}],
            ),
            timeout=WEB_SEARCH_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as error:
        raise SourceSearchError(
            "Web & documentation", f"no answer within {int(WEB_SEARCH_TIMEOUT_SECONDS)}s"
        ) from error
    except Exception as error:
        raise SourceSearchError("Web & documentation", str(error)) from error

    data = extract_json(response.output_text or "")
    if data is None:
        raise SourceSearchError("Web & documentation", "the model did not return readable JSON")

    papers: list[PaperResult] = []
    seen: set[str] = set()
    for record in data.get("records") or []:
        title = (record.get("title") or "").strip()
        url = (record.get("url") or "").strip()
        # A record without a reachable address cannot be checked by a reader, so
        # it has no place in a review's evidence.
        if not title or not url.startswith(("http://", "https://")):
            continue
        # Peer-reviewed work belongs to the databases, and arriving here it
        # would be counted on the wrong PRISMA pathway and labelled as grey
        # literature when it is not. Three independent checks, because none of
        # them is sufficient on its own: the model is asked outright, its answer
        # is checked against the address, and against the publisher's name —
        # there are more journal hosts than any list can hold, and a small
        # publisher's own domain passes an address check untouched.
        publisher_raw = (record.get("publisher") or "").strip()
        if record.get("peer_reviewed") is True:
            continue
        if _is_non_grey(url) or _is_journal_publisher(publisher_raw):
            continue
        if url in seen:
            continue
        seen.add(url)
        year = _web_record_year(record.get("year"))
        if not _web_in_year_range(year, filters):
            continue
        publisher = publisher_raw
        kind = _WEB_KINDS.get((record.get("kind") or "").strip(), _WEB_KINDS["other"])
        papers.append(PaperResult(
            title=title,
            # There is no author list for a vendor page; who published it and
            # what sort of document it is are what a reviewer needs instead.
            authors=f"{publisher} · {kind}" if publisher else kind,
            year=year,
            url=url,
            openAccessUrl=url,
            abstract=(record.get("summary") or "").strip(),
            source="web",
        ))
        if len(papers) >= size:
            break

    return papers, len(papers)


# ── Europe PMC ────────────────────────────────────────────────────────────────
# Life sciences, plus the preprint servers and theses PubMed does not index. It
# takes a full boolean query, so unlike OpenAlex it needs no rewriting.

EUROPE_PMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"

# Europe PMC's LANG field takes three-letter codes, not the ISO 639-1 the rest
# of the tool uses.
_EUROPE_PMC_LANGUAGES = {
    "en": "eng", "zh": "chi", "fr": "fre", "de": "ger",
    "es": "spa", "ja": "jpn", "pt": "por", "ru": "rus",
}


def _europe_pmc_page_size(limit: int) -> int:
    return min(limit, 25)


def europe_pmc_term(query_text: str, f: SearchFilters | None) -> str:
    """Europe PMC carries every limit as an extra clause of the query itself."""
    if f is None:
        return query_text
    term = query_text
    if f.yearFrom is not None or f.yearTo is not None:
        lo = f.yearFrom if f.yearFrom is not None else 1800
        hi = f.yearTo if f.yearTo is not None else 3000
        term += f" AND (FIRST_PDATE:[{lo}-01-01 TO {hi}-12-31])"
    if f.openAccessOnly:
        term += " AND (OPEN_ACCESS:Y)"
    if f.excludePreprints:
        term += " NOT (SRC:PPR)"
    if f.language:
        code = _EUROPE_PMC_LANGUAGES.get(f.language.lower())
        if code:
            term += f" AND (LANG:{code})"
    return term


async def search_europe_pmc(
    query_text: str, limit: int, client: httpx.AsyncClient,
    page: int = 1, filters: SearchFilters | None = None,
) -> tuple[list[PaperResult], int]:
    size = _europe_pmc_page_size(limit)
    try:
        resp = await client.get(
            EUROPE_PMC_URL,
            params={
                "query": europe_pmc_term(query_text, filters),
                "format": "json",
                "pageSize": size,
                "page": max(page, 1),
                # `core` is what carries the abstract; the default result type
                # omits it, which would put every record into screening blind.
                "resultType": "core",
            },
            headers=_UA,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as error:
        raise SourceSearchError("Europe PMC", str(error)) from error

    papers: list[PaperResult] = []
    for item in ((data.get("resultList") or {}).get("result") or []):
        title = (item.get("title") or "").strip().rstrip(".")
        if not title:
            continue
        doi = item.get("doi") or ""
        pmid = item.get("pmid") or ""
        if doi:
            url = f"https://doi.org/{doi}"
        elif pmid:
            url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        else:
            url = f"https://europepmc.org/article/{item.get('source', 'MED')}/{item.get('id', '')}"
        year = item.get("pubYear")
        papers.append(PaperResult(
            title=title,
            authors=(item.get("authorString") or "").strip().rstrip("."),
            year=int(year) if year and str(year).isdigit() else None,
            url=url,
            openAccessUrl=None,
            abstract=(item.get("abstractText") or "").strip(),
            source="europepmc",
        ))
    return papers, int(data.get("hitCount") or 0)


_DOI_IN_URL = re.compile(r'10\.\d{4,9}/[^\s"<>]+')


def _paper_doi(p: PaperResult) -> str | None:
    """Bare, lower-cased DOI from a paper's url or OA url, if present."""
    for s in (p.url or "", p.openAccessUrl or ""):
        m = _DOI_IN_URL.search(s)
        if m:
            return m.group(0).rstrip('.,;)').lower()
    return None


def _title_key(title: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', title.lower()).strip()[:80]


def _merge_into(base: PaperResult, dup: PaperResult) -> None:
    """Fold a duplicate's better fields into the record we keep."""
    if not base.abstract and dup.abstract:
        base.abstract = dup.abstract
    if not base.openAccessUrl and dup.openAccessUrl:
        base.openAccessUrl = dup.openAccessUrl
    # Prefer a DOI-resolvable link over a bare database id link.
    if "doi.org" not in (base.url or "") and "doi.org" in (dup.url or ""):
        base.url = dup.url
    # Record combined provenance (e.g. "openalex+pubmed").
    sources = set(base.source.split("+")) | set(dup.source.split("+"))
    base.source = "+".join(sorted(sources))


def deduplicate(papers: list[PaperResult]) -> list[PaperResult]:
    """Collapse the same paper appearing across databases into one record.

    Papers are matched by DOI first (authoritative across databases), then by a
    normalised title as a fallback. The first occurrence is kept and each later
    duplicate is *merged* into it — so a PubMed record with no abstract inherits
    the OpenAlex abstract instead of either being dropped or duplicating the row.
    """
    result: list[PaperResult] = []
    by_doi: dict[str, PaperResult] = {}
    by_title: dict[str, PaperResult] = {}
    for p in papers:
        doi = _paper_doi(p)
        tkey = _title_key(p.title)

        existing = None
        if doi and doi in by_doi:
            existing = by_doi[doi]
        elif tkey and tkey in by_title:
            existing = by_title[tkey]

        if existing is not None:
            _merge_into(existing, p)
            # A newly-seen DOI/title on the merged record now maps to the survivor.
            if doi:
                by_doi.setdefault(doi, existing)
            if tkey:
                by_title.setdefault(tkey, existing)
            continue

        result.append(p)
        if doi:
            by_doi[doi] = p
        if tkey:
            by_title[tkey] = p
    return result


# ── Source registry ───────────────────────────────────────────────────────────
#
# One entry per database. Adding a source is adding an adapter above and a row
# here; nothing else in the request path knows how many there are.
#
# Which databases were searched is not a detail — PRISMA 2020 requires reporting
# it, and the two this tool started with both lean biomedical, so a review
# outside medicine was searching a corpus that could not answer it.


def _full_share(limit: int) -> int:
    return limit


def _half_share(limit: int) -> int:
    """Every database beyond the first takes a smaller slice of the page.

    The returned page is the union across sources, so giving each the full
    requested limit would multiply the page size by the number selected.
    """
    return max(limit // 2, 5)


def _openalex_as_run(query_text: str, f: SearchFilters | None) -> str:
    filter_str = openalex_filter_string(f)
    return f"{query_text}  [filter: {filter_str}]" if filter_str else query_text


def _crossref_as_run(query_text: str, f: SearchFilters | None) -> str:
    filter_str = crossref_filter_string(f)
    return f"{query_text}  [filter: {filter_str}]" if filter_str else query_text


def _semantic_scholar_as_run(query_text: str, f: SearchFilters | None) -> str:
    parts: list[str] = []
    if f is not None:
        if f.yearFrom is not None or f.yearTo is not None:
            parts.append(f"year={f.yearFrom or ''}-{f.yearTo or ''}")
        if f.openAccessOnly:
            parts.append("openAccessPdf")
        if f.excludePreprints:
            parts.append("publicationTypes=JournalArticle,Conference,Review")
    return f"{query_text}  [{', '.join(parts)}]" if parts else query_text


@dataclass(frozen=True)
class SourceSpec:
    """Everything the request path needs to know about one database."""
    key: str
    name: str
    #: Module-level coroutine, looked up by name at call time rather than bound
    #: here, so a test that replaces the search function is actually exercised.
    fetch: str
    #: True where the database has no boolean syntax and needs the stripped query.
    needs_clean_query: bool
    describe: Callable[[str, SearchFilters | None], str]
    page_size: Callable[[int], int]
    share: Callable[[int], int]
    #: SearchFilters fields this database cannot express. Reported rather than
    #: silently ignored, and rather than dropping the database from the search.
    unsupported: tuple[str, ...]
    #: Whether this database's reported hit count means "records matching the
    #: search". Crossref and Semantic Scholar rank by relevance over the terms
    #: individually, so their totals *grow* as a query gets more specific —
    #: measured against the same query, Crossref reports 85k hits for "sepsis"
    #: and 4.6M for a ten-word question, where OpenAlex narrows from 840k to 9.8k.
    #: A figure like that is not "records identified" in any sense a PRISMA flow
    #: diagram means, so it is kept out of the identification total and labelled
    #: wherever it appears.
    comparable_hits: bool
    blurb: str
    #: True where the source searches `SearchRequest.subject` in preference to
    #: the database query — see that field.
    prefers_subject: bool = False
    #: True where this source is not peer-reviewed literature. PRISMA 2020 counts
    #: it on the other identification pathway — websites and organisations — so
    #: it is flagged here and kept apart from the database corpus downstream.
    grey_literature: bool = False
    #: What to say in the strategy record when `comparable_hits` is False. The
    #: default describes a relevance-ranked index; a web search needs its own.
    hits_note: str = (
        "hits are a relevance match on the terms individually, not records"
        " meeting the whole query; excluded from the identification total"
    )


SOURCES: dict[str, SourceSpec] = {
    "openalex": SourceSpec(
        key="openalex", name="OpenAlex", fetch="search_openalex",
        needs_clean_query=True, describe=_openalex_as_run,
        page_size=_openalex_page_size,
        comparable_hits=True, share=_full_share, unsupported=(),
        blurb="Open index of scholarly works across every discipline",
    ),
    "pubmed": SourceSpec(
        key="pubmed", name="PubMed", fetch="search_pubmed",
        needs_clean_query=False, describe=pubmed_term,
        page_size=_pubmed_page_size,
        comparable_hits=True, share=_half_share, unsupported=(),
        blurb="Biomedical and life sciences (NLM)",
    ),
    "europepmc": SourceSpec(
        key="europepmc", name="Europe PMC", fetch="search_europe_pmc",
        needs_clean_query=False, describe=europe_pmc_term,
        page_size=_europe_pmc_page_size,
        comparable_hits=True, share=_half_share, unsupported=(),
        blurb="Life sciences, including the preprints and theses PubMed omits",
    ),
    "crossref": SourceSpec(
        key="crossref", name="Crossref", fetch="search_crossref",
        needs_clean_query=True, describe=_crossref_as_run,
        page_size=_crossref_page_size,
        comparable_hits=False, share=_half_share,
        unsupported=("openAccessOnly", "language"),
        blurb="Every registered DOI — the widest coverage outside medicine",
    ),
    "semanticscholar": SourceSpec(
        key="semanticscholar", name="Semantic Scholar", fetch="search_semantic_scholar",
        needs_clean_query=True, describe=_semantic_scholar_as_run,
        page_size=_semantic_scholar_page_size,
        comparable_hits=False, share=_half_share,
        unsupported=("language",),
        blurb="Computer science, engineering and the social sciences (throttled without an API key)",
    ),
    "web": SourceSpec(
        key="web", name="Web & documentation", fetch="search_web",
        # The boolean operators mean nothing to a web search and read as noise.
        needs_clean_query=True, describe=_web_as_run,
        page_size=_web_page_size,
        comparable_hits=False, share=_web_page_size,
        prefers_subject=True,
        unsupported=("openAccessOnly", "excludePreprints", "language"),
        grey_literature=True,
        blurb=(
            "Vendor documentation, white papers, regulatory filings and reports — grey"
            " literature, for systems the bibliographic databases do not index"
        ),
        hits_note=(
            "grey literature found by web search: a count of pages retrieved, not of records"
            " matching a database query; reported on the PRISMA websites/organisations pathway"
            " rather than in the database identification total"
        ),
    ),
}

#: How long any one database is given to answer. Generous because a slow
#: database that answers is worth more to a review than a fast failure, and a
#: dead host fails on connection rather than on this.
SOURCE_TIMEOUT_SECONDS = 30.0

#: What a caller that names no sources gets — the pair this tool has always
#: searched, so an older client's behaviour is unchanged.
DEFAULT_SOURCE_KEYS = ["openalex", "pubmed"]

_LIMIT_LABELS = {
    "openAccessOnly": "open access only",
    "excludePreprints": "preprints excluded",
    "language": "language",
    "yearFrom": "year range",
    "yearTo": "year range",
}


def unapplied_limits(spec: SourceSpec, f: SearchFilters | None) -> list[str]:
    """Limits the user set that this database has no way to express."""
    if f is None:
        return []
    labels: list[str] = []
    for field in spec.unsupported:
        if getattr(f, field, None) and _LIMIT_LABELS[field] not in labels:
            labels.append(_LIMIT_LABELS[field])
    return labels


def describe_source(spec: SourceSpec, query_text: str, f: SearchFilters | None) -> str:
    """The strategy as run, including anything a reader has to know to read it.

    Dropping a database would cost coverage, and dropping the note would let a
    reader believe a limit held across every source, or that a relevance total
    was a count of matching records. PRISMA item 7 asks for the strategy as
    executed — a limit that could not be applied, and a hit count that does not
    mean what the other rows' hit counts mean, are both part of that.
    """
    as_run = spec.describe(query_text, f)
    missed = unapplied_limits(spec, f)
    if missed:
        as_run += f"  [limit not supported by this database, not applied: {', '.join(missed)}]"
    if not spec.comparable_hits:
        as_run += f"  [{spec.hits_note}]"
    return as_run


class SourceInfo(BaseModel):
    key: str
    name: str
    blurb: str
    default: bool
    unsupportedLimits: list[str] = []
    #: False where the database's hit count cannot be read as records identified.
    comparableHits: bool = True
    #: True where the source returns grey literature rather than peer-reviewed work.
    greyLiterature: bool = False


@router.get("/search/sources", response_model=list[SourceInfo])
def list_sources() -> list[dict]:
    """The databases this build can search, for the frontend's source picker."""
    return [
        {
            "key": spec.key,
            "name": spec.name,
            "blurb": spec.blurb,
            "default": spec.key in DEFAULT_SOURCE_KEYS,
            "unsupportedLimits": [_LIMIT_LABELS[f] for f in spec.unsupported],
            "comparableHits": spec.comparable_hits,
            "greyLiterature": spec.grey_literature,
        }
        for spec in SOURCES.values()
    ]


@router.post("/search", response_model=SearchResponse)
async def search_papers(req: SearchRequest):
    cleaned_query = clean_query_openalex(req.query)
    if not cleaned_query:
        raise HTTPException(status_code=400, detail="Query is empty after cleaning")

    keys = req.sources if req.sources is not None else DEFAULT_SOURCE_KEYS
    specs = [SOURCES[k] for k in keys if k in SOURCES]
    if not specs:
        raise HTTPException(
            status_code=400,
            detail="No known database was selected. Available: " + ", ".join(SOURCES),
        )

    page = max(req.page, 1)
    # Each source's own page size and query form, settled before dispatch so the
    # figures reported below are the ones the requests actually used.
    subject = req.subject.strip()
    plans = [
        (
            spec,
            spec.share(req.limit),
            subject if (spec.prefers_subject and subject)
            else (cleaned_query if spec.needs_clean_query else req.query),
        )
        for spec in specs
    ]

    # Sources run concurrently, so the wait is the slowest one, not the sum —
    # but that slowest one now sets the budget. Europe PMC's `core` result type
    # carries every abstract in the page and regularly takes ten seconds, which
    # the previous 15-second limit turned into an intermittent "database
    # failed" for a database that was answering correctly.
    async with httpx.AsyncClient(timeout=SOURCE_TIMEOUT_SECONDS) as client:
        outcomes = await asyncio.gather(
            *[
                # Resolved from the module here rather than held in the registry,
                # so a replaced search function is the one that runs.
                globals()[spec.fetch](text, share, client, page, req.filters)
                for spec, share, text in plans
            ],
            return_exceptions=True,
        )

    source_errors: list[str] = []
    sources_searched: list[str] = []
    source_queries: list[SourceQuery] = []
    collected: list[PaperResult] = []
    total_available = 0
    has_more = False

    for (spec, share, text), outcome in zip(plans, outcomes):
        if isinstance(outcome, BaseException):
            # A SourceSearchError already names its database; anything else has
            # to be labelled here or the user cannot tell which one failed.
            source_errors.append(
                str(outcome) if isinstance(outcome, SourceSearchError)
                else f"{spec.name}: {outcome}"
            )
            continue
        papers, total = outcome
        sources_searched.append(spec.name)
        source_queries.append(SourceQuery(
            source=spec.name,
            query_as_run=describe_source(spec, text, req.filters),
            hits=total,
        ))
        collected.extend(papers)
        # Only counts that mean "records matching the search" may be summed:
        # this figure becomes the PRISMA identification total, and a relevance
        # ranking's total would put millions into a flow diagram. The per-source
        # figure is still reported above, where its meaning is stated with it.
        if spec.comparable_hits:
            total_available += total
        # Any database still holding pages means "load more" has something to
        # fetch. Compared per-database because their page sizes differ, and
        # computed from the same share the request used — deriving it any other
        # way lets paging stop early or run past the end.
        if total > page * spec.page_size(share):
            has_more = True

    if not sources_searched:
        raise HTTPException(
            status_code=502,
            detail="Every selected database failed: " + "; ".join(source_errors),
        )

    # Sources are merged in the order they were requested, so the record kept for
    # a paper found in several is the one from the database listed first — which
    # is why the abstract-carrying sources lead the default list. deduplicate()
    # folds the rest into it by DOI, falling back to a normalised title.
    #
    # The union is returned whole, deliberately. Truncating it to `limit` used to
    # discard the tail — and because each database's page offset had already
    # advanced past those records, "load more" could never fetch them again, so
    # papers were permanently lost from the review. `limit` is the per-database
    # page size, not a cap on the merged page.
    combined = deduplicate(collected)

    return SearchResponse(
        papers=combined,
        query_used=cleaned_query,
        sources_searched=sources_searched,
        source_errors=source_errors,
        source_queries=source_queries,
        total_available=total_available,
        page=page,
        has_more=has_more,
    )


# ── Citation snowballing ──────────────────────────────────────────────────────
# Backward (references this paper cites) and forward (papers that cite it), via
# OpenAlex. Lets a researcher chase a seed paper's citation network to improve
# recall — a standard step in systematic reviews.

_OPENALEX_ID_RE = re.compile(r'W\d{6,}')


class CitationRequest(BaseModel):
    url: str                      # a DOI, or an OpenAlex work id/url
    title: str = ""               # strict fallback match when the locator is a PMID/publisher URL
    year: int | None = None
    direction: str = "backward"   # "backward" = references | "forward" = cited-by
    limit: int = 15


def _citation_title_key(value: str) -> str:
    """Normalise a title for identity checking, not fuzzy similarity."""
    return re.sub(r"[^a-z0-9]+", " ", (value or "").casefold()).strip()


async def _resolve_openalex_id(
    http: httpx.AsyncClient,
    raw: str,
    title: str = "",
    year: int | None = None,
) -> str | None:
    """Resolve a real paper locator/title to a verified OpenAlex work id.

    DOI and OpenAlex IDs are authoritative. PMID and title searches are only
    accepted when the returned title exactly matches after punctuation/case
    normalisation, preventing a merely similar paper from entering snowballing.
    """
    raw = (raw or "").strip()
    id_match = _OPENALEX_ID_RE.search(raw)
    if id_match:
        return id_match.group(0)

    doi_match = re.search(r'10\.\d{4,9}/[^\s"<>]+', raw)
    if doi_match:
        doi = doi_match.group(0).rstrip('.,;)')
        try:
            r = await http.get(f"{OPENALEX_URL}/https://doi.org/{doi}",
                               params={"select": "id"}, headers=_UA)
            if r.status_code == 200:
                return (r.json().get("id") or "").split("/")[-1] or None
        except Exception:
            pass

    # PubMed-only search results often have no DOI but do have a stable PMID.
    pmid_match = re.search(r'(?:pubmed(?:\.ncbi\.nlm\.nih\.gov)?/|pmid[:/\s])(\d+)', raw, re.I)
    if pmid_match:
        try:
            r = await http.get(
                f"{OPENALEX_URL}/pmid:{pmid_match.group(1)}",
                params={"select": "id,title,publication_year"},
                headers=_UA,
            )
            if r.status_code == 200:
                candidates = [r.json()]
                wanted = _citation_title_key(title)
                for item in candidates:
                    if (not wanted or _citation_title_key(item.get("title") or "") == wanted) and (
                        year is None or item.get("publication_year") in {None, year}
                    ):
                        return (item.get("id") or "").split("/")[-1] or None
        except Exception:
            pass

    # Publisher and legacy session URLs may contain neither DOI nor PMID.
    # Search OpenAlex, then require an exact normalised-title match.
    wanted = _citation_title_key(title)
    if wanted:
        try:
            params: dict[str, str | int] = {
                "search": title,
                "select": "id,title,publication_year",
                "per-page": 10,
            }
            if year and year > 0:
                params["filter"] = f"publication_year:{year}"
            r = await http.get(OPENALEX_URL, params=params, headers=_UA)
            if r.status_code == 200:
                for item in r.json().get("results") or []:
                    if _citation_title_key(item.get("title") or "") == wanted:
                        return (item.get("id") or "").split("/")[-1] or None
        except Exception:
            pass

    return None


@router.post("/search/citations", response_model=SearchResponse)
async def search_citations(req: CitationRequest):
    if req.direction not in {"backward", "forward"}:
        raise HTTPException(status_code=422, detail="Direction must be backward or forward")
    per_page = min(max(req.limit, 1), 25)
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as http:
        wid = await _resolve_openalex_id(http, req.url, req.title, req.year)
        if not wid:
            raise HTTPException(
                status_code=422,
                detail="No verified OpenAlex record matched this paper's DOI, PMID, or exact title",
            )

        items: list[dict] = []
        try:
            if req.direction == "forward":
                r = await http.get(OPENALEX_URL, params={
                    "filter": f"cites:{wid}",
                    "select": OPENALEX_FIELDS,
                    "per-page": per_page,
                    "sort": "cited_by_count:desc",
                }, headers=_UA)
                r.raise_for_status()
                items = r.json().get("results", [])
            else:
                rw = await http.get(f"{OPENALEX_URL}/{wid}",
                                   params={"select": "referenced_works"}, headers=_UA)
                rw.raise_for_status()
                refs = rw.json().get("referenced_works") or []
                ref_ids = "|".join(x.split("/")[-1] for x in refs[:per_page])
                if ref_ids:
                    r = await http.get(OPENALEX_URL, params={
                        "filter": f"ids.openalex:{ref_ids}",
                        "select": OPENALEX_FIELDS,
                        "per-page": per_page,
                    }, headers=_UA)
                    r.raise_for_status()
                    items = r.json().get("results", [])
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OpenAlex citation lookup failed: {str(e)}")

    papers = deduplicate([parse_openalex_item(it) for it in items])
    return SearchResponse(
        papers=papers,
        query_used=f"{req.direction} citations",
        sources_searched=["OpenAlex"],
    )
