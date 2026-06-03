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

        user_content = f"""Evaluate how relevant this paper is to the researcher's profile.

RESEARCH PROFILE:
{profile_text}

PAPER:
Title: {req.paper.title}
Authors: {req.paper.authors}
Year: {req.paper.year}
Abstract: {req.paper.abstract or '(no abstract available)'}

Respond with JSON in this exact format:
{{
  "score": <integer 0-100>,
  "reasoning": "<2-3 sentences explaining the relevance judgement>",
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
        score = int(data.get("score", 0))
        return RecogniseResponse(
            score=score,
            level=score_to_level(score),
            reasoning=data.get("reasoning", ""),
            suggestions=data.get("suggestions"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recognise error: {str(e)}")
