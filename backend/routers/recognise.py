import json
from routers.json_utils import extract_json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from config import MODEL

router = APIRouter()
client = AsyncOpenAI()

SYSTEM_PROMPT = """You are an academic research assistant evaluating paper relevance and query quality.
Always respond with valid JSON only — no markdown, no commentary.
"""


class PaperInfo(BaseModel):
    title: str
    abstract: str
    authors: str = ''
    year: int | None = None
    url: str = ''


class ProfileInfo(BaseModel):
    domain: str = ''
    population: str = ''
    focus: str = ''
    method: str = ''
    reviewType: str = ''


class RecogniseRequest(BaseModel):
    mode: str  # "paper_relevance" or "query_quality"
    paper: PaperInfo | None = None
    query_text: str | None = None
    profile: ProfileInfo


class RecogniseResponse(BaseModel):
    score: int          # 0-100
    level: str          # "high" | "medium" | "low" | "none"
    reasoning: str
    suggestions: list[str] | None = None
    resolvedAbstract: str | None = None
    model: str


class PaperInsightsRequest(BaseModel):
    paper: PaperInfo


class PaperInsightsResponse(BaseModel):
    summary: str
    conclusion: str | None = None
    conclusionAvailable: bool
    resolvedAbstract: str
    model: str


def score_to_level(score: int) -> str:
    if score >= 75:
        return 'high'
    if score >= 45:
        return 'medium'
    if score >= 15:
        return 'low'
    return 'none'


@router.post("/recognise", response_model=RecogniseResponse)
async def recognise(req: RecogniseRequest):
    profile_text = (
        f"Domain: {req.profile.domain}\n"
        f"Population: {req.profile.population}\n"
        f"Focus: {req.profile.focus}\n"
        f"Method: {req.profile.method}\n"
        f"Review type: {req.profile.reviewType}"
    )

    if req.mode == "paper_relevance":
        if not req.paper:
            raise HTTPException(status_code=400, detail="paper is required for paper_relevance mode")

        # Search metadata can arrive before PubMed's separate abstract request.
        # Resolve the source abstract again here so relevance explanations never
        # claim it is missing merely because an earlier network call failed.
        from routers.screening import fetch_real_abstract
        abstract = await fetch_real_abstract(req.paper)
        if not abstract:
            raise HTTPException(
                status_code=422,
                detail="No verified abstract is available from PubMed or OpenAlex; relevance was not guessed.",
            )

        user_content = f"""Evaluate how relevant this paper is to the researcher's profile.

RESEARCH PROFILE:
{profile_text}

PAPER:
Title: {req.paper.title}
Authors: {req.paper.authors}
Year: {req.paper.year}
Abstract: {abstract}

Respond with JSON in this exact format:
{{
  "score": <integer 0-100>,
  "reasoning": "<2-3 sentences citing concrete information from the supplied title and abstract>",
  "suggestions": null
}}
"""

    elif req.mode == "query_quality":
        if not req.query_text:
            raise HTTPException(status_code=400, detail="query_text is required for query_quality mode")

        user_content = f"""Evaluate the quality of this Boolean search query for the researcher's profile.

RESEARCH PROFILE:
{profile_text}

QUERY:
{req.query_text}

Respond with JSON in this exact format:
{{
  "score": <integer 0-100>,
  "reasoning": "<2-3 sentences explaining the quality judgement>",
  "suggestions": ["<specific improvement 1>", "<specific improvement 2>"]
}}
"""

    else:
        raise HTTPException(status_code=400, detail=f"Unknown mode: {req.mode}")

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=SYSTEM_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or "")
        if data is None:
            raise HTTPException(status_code=500, detail="AI returned invalid JSON")
        score = max(0, min(100, int(data.get("score", 0))))
        return RecogniseResponse(
            score=score,
            level=score_to_level(score),
            reasoning=data.get("reasoning", ""),
            suggestions=data.get("suggestions"),
            resolvedAbstract=abstract if req.mode == "paper_relevance" else None,
            model=MODEL,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recognise error: {str(e)}")


PAPER_INSIGHTS_PROMPT = """You summarise a research-paper abstract without adding outside knowledge.
Use only claims explicitly supported by the supplied abstract.

Return valid JSON only:
{
  "summary": "<2-4 sentence faithful summary of aim, method and findings actually present>",
  "conclusion": "<the authors' conclusion if the abstract explicitly states one, otherwise null>"
}

Rules:
- Do not add benefits, limitations, implications, populations, settings, methods or findings absent from the abstract.
- Do not turn background statements into study findings.
- If an explicit author conclusion is absent, return null for conclusion.
"""


@router.post("/papers/insights", response_model=PaperInsightsResponse)
async def paper_insights(req: PaperInsightsRequest):
    from routers.screening import fetch_real_abstract
    abstract = await fetch_real_abstract(req.paper)
    if not abstract:
        raise HTTPException(
            status_code=422,
            detail="No verified abstract is available from PubMed or OpenAlex; no summary was generated.",
        )

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=PAPER_INSIGHTS_PROMPT,
            input=(
                f"Title: {req.paper.title}\n"
                f"Authors: {req.paper.authors}\n"
                f"Year: {req.paper.year}\n"
                f"Abstract:\n{abstract}"
            ),
        )
        data = extract_json(response.output_text or "")
        if not isinstance(data, dict) or not str(data.get("summary", "")).strip():
            raise HTTPException(status_code=502, detail="AI returned invalid paper insights")
        conclusion = data.get("conclusion")
        conclusion_text = str(conclusion).strip() if conclusion is not None else None
        return PaperInsightsResponse(
            summary=str(data["summary"]).strip(),
            conclusion=conclusion_text or None,
            conclusionAvailable=bool(conclusion_text),
            resolvedAbstract=abstract,
            model=MODEL,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Paper insight generation error: {str(e)}")
