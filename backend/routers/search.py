import re
import xml.etree.ElementTree as ET
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

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


@router.post("/search", response_model=SearchResponse)
async def search_papers(req: SearchRequest):
    openalex_query = clean_query_openalex(req.query)
    if not openalex_query:
        raise HTTPException(status_code=400, detail="Query is empty after cleaning")

    page = max(req.page, 1)
    pubmed_limit = max(req.limit // 2, 5)

    async with httpx.AsyncClient(timeout=15.0) as client:
        import asyncio
        openalex_outcome, pubmed_outcome = await asyncio.gather(
            search_openalex(openalex_query, req.limit, client, page, req.filters),
            search_pubmed(req.query, pubmed_limit, client, page, req.filters),
            return_exceptions=True,
        )

    source_errors: list[str] = []
    sources_searched: list[str] = []
    source_queries: list[SourceQuery] = []

    pubmed_query = pubmed_term(req.query, req.filters)
    openalex_filters = openalex_filter_string(req.filters)
    openalex_as_run = (
        f"{openalex_query}  [filter: {openalex_filters}]" if openalex_filters else openalex_query
    )

    if isinstance(openalex_outcome, BaseException):
        source_errors.append(str(openalex_outcome))
        openalex_results, openalex_total = [], 0
    else:
        sources_searched.append("OpenAlex")
        openalex_results, openalex_total = openalex_outcome
        source_queries.append(SourceQuery(
            source="OpenAlex", query_as_run=openalex_as_run, hits=openalex_total,
        ))

    if isinstance(pubmed_outcome, BaseException):
        source_errors.append(str(pubmed_outcome))
        pubmed_results, pubmed_total = [], 0
    else:
        sources_searched.append("PubMed")
        pubmed_results, pubmed_total = pubmed_outcome
        source_queries.append(SourceQuery(
            source="PubMed", query_as_run=pubmed_query, hits=pubmed_total,
        ))

    if not sources_searched:
        raise HTTPException(
            status_code=502,
            detail="Both literature databases failed: " + "; ".join(source_errors),
        )

    # OpenAlex first (it carries abstracts), then PubMed; deduplicate() merges
    # the same paper across the two sources by DOI, falling back to title.
    #
    # The union is returned whole, deliberately. Truncating it to `limit` used to
    # discard the tail — and because each database's page offset had already
    # advanced past those records, "load more" could never fetch them again, so
    # papers were permanently lost from the review. `limit` is the per-database
    # page size, not a cap on the merged page.
    combined = deduplicate(list(openalex_results) + list(pubmed_results))

    # Either database still having pages left means "load more" has something
    # to fetch. Compared per-database because their page sizes differ. The page
    # sizes below must stay in step with the ones the two search functions apply,
    # or paging will either stop early or loop past the end.
    has_more = (
        openalex_total > page * _openalex_page_size(req.limit)
        or pubmed_total > page * _pubmed_page_size(pubmed_limit)
    )

    return SearchResponse(
        papers=combined,
        query_used=openalex_query,
        sources_searched=sources_searched,
        source_errors=source_errors,
        source_queries=source_queries,
        total_available=openalex_total + pubmed_total,
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
