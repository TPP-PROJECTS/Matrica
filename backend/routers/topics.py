import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config import response_options
from routers.json_utils import extract_json

load_dotenv()

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

TOPICS_SYSTEM_PROMPT = """You are an academic research assistant. Given a researcher's profile, generate 5-7 specific, actionable research topic suggestions for a systematic literature review.

Each topic must have:
- A concise, academic title (max 12 words)
- A 2-3 sentence description of the research angle
- 3-4 relevant academic tags/keywords
- A rationale explaining why it fits the profile (1-2 sentences)
- A type: one of "population", "design", "risk", "review"
  - population: focuses on a specific group/cohort
  - design: focuses on study design or methodology
  - risk: focuses on risks, harms, or safety concerns
  - review: focuses on synthesising existing evidence
- profileMatch: "profile_match" if directly from stated profile, "inferred" if you extrapolated
- confidence: "high", "medium", or "low"
- selected: true for the 2-3 most relevant topics, false for others

Respond ONLY with valid JSON in this exact structure:
{
  "topics": [
    {
      "id": "ai-t1",
      "type": "population",
      "title": "...",
      "description": "...",
      "tags": ["tag1", "tag2", "tag3"],
      "rationale": "...",
      "profileMatch": "profile_match",
      "selected": true,
      "confidence": "high"
    }
  ]
}"""


class GenerateRequest(BaseModel):
    keyword: str
    count: int = 10
    language: str = "zh"


class Topic(BaseModel):
    id: int
    title: str
    description: str
    tags: list[str]


class GenerateResponse(BaseModel):
    topics: list[Topic]
    keyword: str


KEYWORD_TOPICS_SYSTEM_PROMPT = """You are an academic research assistant.
Generate specific, researchable topic ideas for the supplied keyword. These are
AI-generated research directions, not claims about published studies.

Return valid JSON only:
{"topics": [{"title": "...", "description": "...", "tags": ["...", "..."]}]}

Use the requested language. Do not invent citations, paper titles, authors,
datasets, statistics, products, or study findings."""


class ProfileRequest(BaseModel):
    domain: str
    population: str = ""
    focus: str = ""
    method: str = ""
    reviewType: str = ""
    custom_system_prompt: str | None = None


class TopicCardResponse(BaseModel):
    id: str
    type: str
    title: str
    description: str
    tags: list[str]
    rationale: str
    profileMatch: str | None
    selected: bool
    confidence: str


class TopicsFromProfileResponse(BaseModel):
    topics: list[TopicCardResponse]


@router.post("/topics/generate", response_model=GenerateResponse)
async def generate_topics(req: GenerateRequest):
    keyword = req.keyword.strip()
    if not keyword:
        raise HTTPException(status_code=422, detail="Keyword is required")
    count = min(max(req.count, 1), 20)
    try:
        response = await client.responses.create(
            **response_options(),
            instructions=KEYWORD_TOPICS_SYSTEM_PROMPT,
            input=(
                f"Keyword: {keyword}\n"
                f"Number of topic ideas: {count}\n"
                f"Response language: {req.language}"
            ),
        )
        data = extract_json(response.output_text or "")
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail="AI returned invalid topic JSON")
        raw_topics = data.get("topics")
        if not isinstance(raw_topics, list) or not raw_topics:
            raise HTTPException(status_code=502, detail="AI returned no topic ideas")
        topics = [
            Topic(
                id=index + 1,
                title=str(item.get("title", "")).strip(),
                description=str(item.get("description", "")).strip(),
                tags=[str(tag).strip() for tag in item.get("tags", []) if str(tag).strip()],
            )
            for index, item in enumerate(raw_topics[:count])
            if isinstance(item, dict) and str(item.get("title", "")).strip()
        ]
        if not topics:
            raise HTTPException(status_code=502, detail="AI returned no valid topic ideas")
        return GenerateResponse(topics=topics, keyword=keyword)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(error)}")


@router.post("/topics/generate-profile", response_model=TopicsFromProfileResponse)
async def generate_topics_from_profile(req: ProfileRequest):
    profile_parts = [f"Research Domain: {req.domain}"]
    if req.population:
        profile_parts.append(f"Target Population: {req.population}")
    if req.focus:
        profile_parts.append(f"Research Focus: {req.focus}")
    if req.method:
        profile_parts.append(f"Method: {req.method}")
    if req.reviewType:
        profile_parts.append(f"Review Type: {req.reviewType}")

    user_content = "Generate research topics for this profile:\n\n" + "\n".join(profile_parts)

    try:
        response = await client.responses.create(
            **response_options(),
            instructions=req.custom_system_prompt or TOPICS_SYSTEM_PROMPT,
            input=user_content,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")

    data = extract_json(response.output_text or "")
    if data is None:
        raise HTTPException(status_code=502, detail="Invalid JSON from OpenAI")

    topics = []
    for i, t in enumerate(data.get("topics", [])):
        topics.append(TopicCardResponse(
            id=t.get("id", f"ai-t{i+1}"),
            type=t.get("type", "population"),
            title=t.get("title", ""),
            description=t.get("description", ""),
            tags=t.get("tags", []),
            rationale=t.get("rationale", ""),
            profileMatch=t.get("profileMatch") or None,
            selected=t.get("selected", i < 2),
            confidence=t.get("confidence", "medium"),
        ))

    return TopicsFromProfileResponse(topics=topics)
