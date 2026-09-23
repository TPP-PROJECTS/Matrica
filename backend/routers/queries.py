import os
import json
from routers.json_utils import extract_json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config import MODEL
from routers.search import DEFAULT_SOURCE_KEYS, SOURCES

load_dotenv()

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# The prompt is assembled with a plain substitution rather than str.format:
# it ends in a literal JSON example, and every brace in that example would have
# to be doubled for format() — which it was not, so every default-prompt request
# raised KeyError and the endpoint answered 500.
DATABASES_PLACEHOLDER = "{databases}"

QUERIES_SYSTEM_PROMPT = """You are an expert academic librarian generating structured database search queries for a systematic literature review.

{databases}

For each research topic provided, generate 1-2 Boolean search queries.

A topic may be a research theme or a named system the review appraises. For a
system, write queries that retrieve its published evaluations, validation
studies, implementation reports and official documentation.

Each query must have:
- text: a well-formed Boolean query using AND/OR with parentheses and double-quoted phrases
- qualityScore: integer 0-100 rating the query's expected precision/recall balance
- priority: "high" for the most important query per topic, "med" for secondary
- topicId: copied EXACTLY from the id in square brackets before the topic it belongs to

Respond ONLY with valid JSON (the topicId below is an example — use the real ids):
{
  "queries": [
    {
      "topicId": "<id from the list above>",
      "text": "...",
      "qualityScore": 78,
      "priority": "high"
    }
  ]
}"""

# How each database reads a query. A query written for PubMed's MeSH syntax and
# a query written for a relevance-ranked index are not the same string, so the
# librarian has to be told which ones it is writing for — telling it about a
# fixed pair while the search ran against five would produce queries tuned for
# databases the review is not using.
_QUERY_SYNTAX = {
    "openalex": "OpenAlex (relevance search — Boolean operators are stripped automatically)",
    "pubmed": "PubMed (Boolean and MeSH-style syntax, fully supported)",
    "europepmc": "Europe PMC (full Boolean syntax with field prefixes)",
    "crossref": "Crossref (bibliographic relevance search — Boolean operators are stripped)",
    "semanticscholar": "Semantic Scholar (relevance search — Boolean operators are stripped)",
}


def databases_brief(keys: list[str]) -> str:
    """The paragraph telling the model which databases the query must serve."""
    known = [k for k in keys if k in SOURCES] or DEFAULT_SOURCE_KEYS
    lines = "\n".join(f"- {_QUERY_SYNTAX.get(k, SOURCES[k].name)}" for k in known)
    return (
        "This tool executes every query against the following databases:\n"
        f"{lines}\n"
        "Write queries that work well across all of them."
    )


def searched_database_names(keys: list[str]) -> list[str]:
    """Display names for the selected databases, for the query card's label."""
    known = [k for k in keys if k in SOURCES] or DEFAULT_SOURCE_KEYS
    return [SOURCES[k].name for k in known]


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
    # Database keys the review searches. None keeps the historical pair.
    sources: list[str] | None = None


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

    keys = req.sources if req.sources is not None else DEFAULT_SOURCE_KEYS
    instructions = (
        req.custom_system_prompt
        or QUERIES_SYSTEM_PROMPT.replace(DATABASES_PLACEHOLDER, databases_brief(keys))
    )

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=instructions,
            input=user_content,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")

    data = extract_json(response.output_text or "")
    if data is None:
        raise HTTPException(status_code=502, detail="Invalid JSON from OpenAI")

    # A query whose topicId is not one of the ids we sent belongs to no topic
    # the caller knows about, and the UI — which lists queries under their topic
    # or system — would simply not show it. Models do copy the id out of the
    # example, so the id is checked and, failing that, attributed to the first
    # subject rather than dropped.
    known_ids = [t.id for t in req.topics]

    def resolve_topic_id(raw: object) -> str:
        candidate = raw if isinstance(raw, str) else ""
        if candidate in known_ids:
            return candidate
        return known_ids[0] if known_ids else candidate

    queries = []
    for i, q in enumerate(data.get("queries", [])):
        queries.append(QueryCardResponse(
            id=f"q-ai-{i + 1}",
            queryN=i + 1,
            topicId=resolve_topic_id(q.get("topicId")),
            text=q.get("text", ""),
            qualityScore=int(q.get("qualityScore", 70)),
            priority=q.get("priority", "med"),
            databases=searched_database_names(keys),
            resultCount=0,
            stale=False,
        ))

    return QueryGenerateResponse(queries=queries)
