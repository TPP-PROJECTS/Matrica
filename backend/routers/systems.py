from routers.json_utils import extract_json
import os
import re
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config import MODEL

load_dotenv()

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEMS_PROMPT = """You are a domain expert in software systems and research tools. Given a researcher's profile and topics, identify 5-8 real, widely-used software systems, clinical platforms, or AI tools that are directly relevant to the research domain and would be appropriate subjects for a systematic review.

For each system provide:
- name: the official product/system name
- description: 2-3 sentences explaining what it does and why it's relevant to this research
- category: one of "clinical_system", "ai_platform", "decision_support", "health_platform", "research_tool", "other"
- url: the official website URL (must be a real URL, or null if unknown)
- vendor: the company or organisation that makes it

Respond ONLY with valid JSON:
{
  "systems": [
    {
      "name": "...",
      "description": "...",
      "category": "clinical_system",
      "url": "https://...",
      "vendor": "..."
    }
  ]
}"""


class SystemRecommendRequest(BaseModel):
    domain: str
    population: str = ""
    focus: str = ""
    method: str = ""
    reviewType: str = ""
    topics: list[dict] = []


class SystemCard(BaseModel):
    id: str
    name: str
    description: str
    category: str
    url: str | None
    vendor: str


class SystemRecommendResponse(BaseModel):
    systems: list[SystemCard]


@router.post("/systems/recommend", response_model=SystemRecommendResponse)
async def recommend_systems(req: SystemRecommendRequest):
    profile_parts = [f"Research Domain: {req.domain}"]
    if req.population:
        profile_parts.append(f"Target Population: {req.population}")
    if req.focus:
        profile_parts.append(f"Research Focus: {req.focus}")
    if req.method:
        profile_parts.append(f"Method: {req.method}")
    if req.reviewType:
        profile_parts.append(f"Review Type: {req.reviewType}")

    if req.topics:
        topic_titles = [t.get("title", "") for t in req.topics[:5] if t.get("title")]
        if topic_titles:
            profile_parts.append(f"Research Topics: {', '.join(topic_titles)}")

    user_content = (
        "Search the web and find real software systems relevant to this research profile. "
        "Return systems that researchers in this domain commonly study or evaluate:\n\n"
        + "\n".join(profile_parts)
    )

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=SYSTEMS_PROMPT,
            input=user_content,
            tools=[{"type": "web_search_preview"}],
        )
    except Exception:
        # Fall back without web search if not supported
        try:
            response = await client.responses.create(
                model=MODEL,
                instructions=SYSTEMS_PROMPT,
                input=user_content,
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")

    data = extract_json(response.output_text or "")
    if data is None:
        raise HTTPException(status_code=502, detail="Invalid JSON from model")

    systems = []
    for i, s in enumerate(data.get("systems", [])):
        systems.append(SystemCard(
            id=f"sys-{i + 1}",
            name=s.get("name", ""),
            description=s.get("description", ""),
            category=s.get("category", "other"),
            url=s.get("url") or None,
            vendor=s.get("vendor", ""),
        ))

    return SystemRecommendResponse(systems=systems)
