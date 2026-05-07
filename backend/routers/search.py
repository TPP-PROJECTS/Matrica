import re
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

OPENALEX_URL = "https://api.openalex.org/works"
FIELDS = "title,authorships,publication_year,doi,open_access,id,abstract_inverted_index"


def clean_query(raw: str) -> str:
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
    limit: int = 8


class PaperResult(BaseModel):
    title: str
    authors: str
    year: int | None
    url: str
    openAccessUrl: str | None
    abstract: str


class SearchResponse(BaseModel):
    papers: list[PaperResult]
    query_used: str


@router.post("/search", response_model=SearchResponse)
async def search_papers(req: SearchRequest):
    query_text = clean_query(req.query)
    if not query_text:
        raise HTTPException(status_code=400, detail="Query is empty after cleaning")

    params = {
        "search": query_text,
        "per-page": min(req.limit, 10),
        "select": FIELDS,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                OPENALEX_URL,
                params=params,
                headers={"User-Agent": "ResearchAI-tool (research@example.com)"},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="OpenAlex timed out")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"OpenAlex error: {e.response.status_code} {e.response.text[:200]}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Search error: {str(e)}")

    papers = []
    for item in data.get("results", []):
        # Authors
        authorships = item.get("authorships") or []
        author_names = [a["author"]["display_name"] for a in authorships[:3] if a.get("author")]
        authors_str = ", ".join(author_names)
        if len(authorships) > 3:
            authors_str += " et al."

        # URL — prefer DOI, fall back to OpenAlex page
        doi = item.get("doi") or ""
        openalex_id = item.get("id") or ""
        url = doi if doi else openalex_id

        # Open-access PDF
        oa = item.get("open_access") or {}
        oa_url = oa.get("oa_url") if oa.get("is_oa") else None

        # Abstract from inverted index
        abstract = reconstruct_abstract(item.get("abstract_inverted_index"))

        papers.append(PaperResult(
            title=item.get("title") or "",
            authors=authors_str,
            year=item.get("publication_year"),
            url=url,
            openAccessUrl=oa_url,
            abstract=abstract,
        ))

    return SearchResponse(papers=papers, query_used=query_text)
