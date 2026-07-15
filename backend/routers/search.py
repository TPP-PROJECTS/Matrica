import re
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


class SearchRequest(BaseModel):
    query: str
    limit: int = 15


class PaperResult(BaseModel):
    title: str
    authors: str
    year: int | None
    url: str
    openAccessUrl: str | None
    abstract: str
    source: str = "openalex"


class SearchResponse(BaseModel):
    papers: list[PaperResult]
    query_used: str
    sources_searched: list[str] = ["OpenAlex", "PubMed"]


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


async def search_openalex(query_text: str, limit: int, client: httpx.AsyncClient) -> list[PaperResult]:
    params = {
        "search": query_text,
        "per-page": min(limit, 25),
        "select": OPENALEX_FIELDS,
    }
    try:
        resp = await client.get(
            OPENALEX_URL,
            params=params,
            headers={"User-Agent": "ResearchAI-tool (research@example.com)"},
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    return [parse_openalex_item(item) for item in data.get("results", [])]


async def search_pubmed(query_text: str, limit: int, client: httpx.AsyncClient) -> list[PaperResult]:
    """Search PubMed via E-utilities (free, no API key required)."""
    try:
        # Step 1: esearch — get PMIDs
        search_resp = await client.get(
            PUBMED_SEARCH_URL,
            params={
                "db": "pubmed",
                "term": query_text,
                "retmax": min(limit, 20),
                "retmode": "json",
                "sort": "relevance",
            },
            headers={"User-Agent": "ResearchAI-tool (research@example.com)"},
        )
        search_resp.raise_for_status()
        search_data = search_resp.json()
        pmids = search_data.get("esearchresult", {}).get("idlist", [])
        if not pmids:
            return []

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

    except Exception:
        return []

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
            abstract="",  # esummary doesn't include abstract; use efetch for full abstract
            source="pubmed",
        ))
    return papers


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

    async with httpx.AsyncClient(timeout=15.0) as client:
        import asyncio
        openalex_results, pubmed_results = await asyncio.gather(
            search_openalex(openalex_query, req.limit, client),
            search_pubmed(req.query, max(req.limit // 2, 5), client),
            return_exceptions=False,
        )

    # OpenAlex first (it carries abstracts), then PubMed; deduplicate() merges
    # the same paper across the two sources by DOI, falling back to title.
    combined = list(openalex_results) + list(pubmed_results)
    combined = deduplicate(combined)[:req.limit]

    return SearchResponse(
        papers=combined,
        query_used=openalex_query,
        sources_searched=["OpenAlex", "PubMed"],
    )


# ── Citation snowballing ──────────────────────────────────────────────────────
# Backward (references this paper cites) and forward (papers that cite it), via
# OpenAlex. Lets a researcher chase a seed paper's citation network to improve
# recall — a standard step in systematic reviews.

_OPENALEX_ID_RE = re.compile(r'W\d{6,}')


class CitationRequest(BaseModel):
    url: str                      # a DOI, or an OpenAlex work id/url
    direction: str = "backward"   # "backward" = references | "forward" = cited-by
    limit: int = 15


async def _resolve_openalex_id(http: httpx.AsyncClient, raw: str) -> str | None:
    """Resolve a DOI or OpenAlex link/id to a bare OpenAlex work id (W…)."""
    raw = (raw or "").strip()
    id_match = _OPENALEX_ID_RE.search(raw)
    if id_match and "openalex.org" in raw:
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
            return None

    return id_match.group(0) if id_match else None


@router.post("/search/citations", response_model=SearchResponse)
async def search_citations(req: CitationRequest):
    per_page = min(max(req.limit, 1), 25)
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as http:
        wid = await _resolve_openalex_id(http, req.url)
        if not wid:
            raise HTTPException(status_code=422, detail="Could not locate this paper in OpenAlex")

        items: list[dict] = []
        try:
            if req.direction == "forward":
                r = await http.get(OPENALEX_URL, params={
                    "filter": f"cites:{wid}",
                    "select": OPENALEX_FIELDS,
                    "per-page": per_page,
                    "sort": "cited_by_count:desc",
                }, headers=_UA)
                if r.status_code == 200:
                    items = r.json().get("results", [])
            else:
                rw = await http.get(f"{OPENALEX_URL}/{wid}",
                                   params={"select": "referenced_works"}, headers=_UA)
                refs = (rw.json().get("referenced_works") or []) if rw.status_code == 200 else []
                ref_ids = "|".join(x.split("/")[-1] for x in refs[:per_page])
                if ref_ids:
                    r = await http.get(OPENALEX_URL, params={
                        "filter": f"ids.openalex:{ref_ids}",
                        "select": OPENALEX_FIELDS,
                        "per-page": per_page,
                    }, headers=_UA)
                    if r.status_code == 200:
                        items = r.json().get("results", [])
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OpenAlex citation lookup failed: {str(e)}")

    papers = deduplicate([parse_openalex_item(it) for it in items])
    return SearchResponse(
        papers=papers,
        query_used=f"{req.direction} citations",
        sources_searched=["OpenAlex"],
    )
