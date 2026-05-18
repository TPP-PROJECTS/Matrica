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

    papers = []
    for item in data.get("results", []):
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

        abstract = reconstruct_abstract(item.get("abstract_inverted_index"))

        papers.append(PaperResult(
            title=item.get("title") or "",
            authors=authors_str,
            year=item.get("publication_year"),
            url=url,
            openAccessUrl=oa_url,
            abstract=abstract,
            source="openalex",
        ))
    return papers


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


def deduplicate(papers: list[PaperResult]) -> list[PaperResult]:
    """Remove near-duplicate titles (case-insensitive, first 60 chars)."""
    seen: set[str] = set()
    result = []
    for p in papers:
        key = re.sub(r'\s+', ' ', p.title.lower().strip())[:60]
        if key and key not in seen:
            seen.add(key)
            result.append(p)
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

    # Merge: OpenAlex first (has abstracts), PubMed fills gaps
    combined = list(openalex_results) + [
        p for p in pubmed_results
        if p.title not in {r.title for r in openalex_results}
    ]
    combined = deduplicate(combined)[:req.limit]

    return SearchResponse(papers=combined, query_used=openalex_query)
