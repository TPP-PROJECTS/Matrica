import os
import json
from routers.json_utils import extract_json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config import MODEL

load_dotenv()

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

QUERIES_SYSTEM_PROMPT = """You are an expert academic librarian generating structured database search queries for a systematic literature review.

This tool executes every query against two free databases: PubMed (Boolean/MeSH-style syntax) and OpenAlex (relevance search — Boolean operators are stripped automatically). Write queries that work well across both.

For each research topic provided, generate 1-2 Boolean search queries.

Each query must have:
- text: a well-formed Boolean query using AND/OR with parentheses and double-quoted phrases
- qualityScore: integer 0-100 rating the query's expected precision/recall balance
- priority: "high" for the most important query per topic, "med" for secondary
- topicId: the id of the topic this query belongs to

Respond ONLY with valid JSON:
{
  "queries": [
    {
      "topicId": "ai-t1",
      "text": "...",
      "qualityScore": 78,
      "priority": "high"
    }
  ]
}"""

# The databases each query is actually executed against. Search always runs both
# and ignores any per-query hint, so we label deterministically rather than let
# the model invent databases the tool does not search (e.g. Scopus/CINAHL).
SEARCHED_DATABASES = ["OpenAlex", "PubMed"]


class TopicInput(BaseModel):
    id: str
    title: str
    description: str
    tags: list[str]


class ProfileContext(BaseModel):
    domain: str
    population: str = ""
    focus: str = ""
    method: str = ""
    reviewType: str = ""


class QueryGenerateRequest(BaseModel):
    topics: list[TopicInput]
    profile: ProfileContext
    custom_system_prompt: str | None = None


class QueryCardResponse(BaseModel):
    id: str
    queryN: int
    topicId: str
    text: str
    qualityScore: int
    priority: str
    databases: list[str]
    resultCount: int
    stale: bool


class QueryGenerateResponse(BaseModel):
    queries: list[QueryCardResponse]


@router.post("/queries/generate", response_model=QueryGenerateResponse)
async def generate_queries(req: QueryGenerateRequest):
    profile_parts = [f"Domain: {req.profile.domain}"]
    if req.profile.population:
        profile_parts.append(f"Population: {req.profile.population}")
    if req.profile.focus:
        profile_parts.append(f"Focus: {req.profile.focus}")
    if req.profile.method:
        profile_parts.append(f"Method: {req.profile.method}")
    if req.profile.reviewType:
        profile_parts.append(f"Review Type: {req.profile.reviewType}")

    topics_text = "\n".join(
        f"- [{t.id}] {t.title}: {t.description} (tags: {', '.join(t.tags)})"
        for t in req.topics
    )

    user_content = (
        f"Research Profile:\n{chr(10).join(profile_parts)}\n\n"
        f"Selected Topics:\n{topics_text}"
    )

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or QUERIES_SYSTEM_PROMPT,
            input=user_content,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")

    data = extract_json(response.output_text or "")
    if data is None:
        raise HTTPException(status_code=502, detail="Invalid JSON from OpenAI")

    queries = []
    for i, q in enumerate(data.get("queries", [])):
        queries.append(QueryCardResponse(
            id=f"q-ai-{i + 1}",
            queryN=i + 1,
            topicId=q.get("topicId", ""),
            text=q.get("text", ""),
            qualityScore=int(q.get("qualityScore", 70)),
            priority=q.get("priority", "med"),
            databases=SEARCHED_DATABASES,
            resultCount=0,
            stale=False,
        ))

    return QueryGenerateResponse(queries=queries)
