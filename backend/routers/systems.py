from routers.json_utils import extract_json
import os
import re
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
    exclude_systems: list[str] = []


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

    if req.exclude_systems:
        excluded = "\n".join(f"- {name}" for name in req.exclude_systems)
        user_content += (
            "\n\nThe researcher has ALREADY selected the systems below. Do NOT return any of "
            "these again — suggest different, additional systems that complement them:\n"
            + excluded
        )

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=SYSTEMS_PROMPT,
            input=user_content,
            tools=[{"type": "web_search_preview"}],
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Verified web-backed system discovery failed; no unverified systems were substituted: {str(e)}",
        )

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


# ── Single-system lookup by name (manual add from Matrix) ─────────────────────

SYSTEM_LOOKUP_PROMPT = """You are a software-systems analyst. The user gives you the name of a software system, platform, or tool. Identify the real system they mean (correcting minor typos) and return its profile.

Respond ONLY with valid JSON:
{
  "found": true,
  "name": "official product name",
  "description": "2-3 sentences: what it does and its relevance",
  "category": "clinical_system" | "ai_platform" | "decision_support" | "health_platform" | "research_tool" | "other",
  "url": "https://official-site" or null,
  "vendor": "company or organisation"
}
If no real, identifiable system matches the name, respond {"found": false}."""


class SystemLookupRequest(BaseModel):
    name: str
    domain: str = ""
    focus: str = ""


class SystemLookupResponse(BaseModel):
    found: bool
    name: str = ""
    description: str = ""
    category: str = "other"
    url: str | None = None
    vendor: str = ""


@router.post("/systems/lookup", response_model=SystemLookupResponse)
async def lookup_system(req: SystemLookupRequest):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="System name is empty")

    context = f"System name to look up: {req.name.strip()}"
    if req.domain or req.focus:
        context += f"\nResearch context (for the relevance part of the description): domain = {req.domain}; focus = {req.focus}"

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=SYSTEM_LOOKUP_PROMPT,
            input=context,
            tools=[{"type": "web_search_preview"}],
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Verified web-backed system lookup failed; no unverified profile was substituted: {str(e)}",
        )

    data = extract_json(response.output_text or "")
    if data is None:
        raise HTTPException(status_code=502, detail="Invalid JSON from model")

    if not data.get("found"):
        return SystemLookupResponse(found=False)

    return SystemLookupResponse(
        found=True,
        name=data.get("name", req.name.strip()),
        description=data.get("description", ""),
        category=data.get("category", "other"),
        url=data.get("url") or None,
        vendor=data.get("vendor", ""),
    )
