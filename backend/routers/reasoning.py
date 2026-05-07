import os
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config import MODEL

load_dotenv()

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

REASON_SYSTEM_PROMPT = """You are an academic research advisor explaining why a specific research topic is relevant to a researcher's profile.

Given a topic and a research profile, write a clear, helpful explanation (3-5 sentences) covering:
1. How the topic directly connects to the researcher's domain and focus
2. Why this angle is valuable for a systematic review in their area
3. What gap or contribution this topic addresses

Be specific — reference actual terms from the profile and topic. Write for a postgraduate student.
Respond ONLY with valid JSON: {"reasoning": "your explanation here"}"""


class ProfileContext(BaseModel):
    domain: str
    population: str = ""
    focus: str = ""
    method: str = ""
    reviewType: str = ""


class ReasonRequest(BaseModel):
    title: str
    description: str
    tags: list[str]
    rationale: str
    profile: ProfileContext


class ReasonResponse(BaseModel):
    reasoning: str


EXPLAIN_TYPE_PROMPT = """You are an expert in systematic review methodology. Explain in 2-3 clear sentences why a research topic is classified under a specific category.

Categories:
- population: the study focuses on a particular group, cohort, or set of subjects
- design: the study centres on a specific research design, methodology, or intervention structure
- risk: the study examines harms, risks, safety concerns, or adverse outcomes
- review: the study synthesises or maps existing evidence across multiple primary studies

Be specific — reference actual terms from the topic title and description.
Respond ONLY with valid JSON: {"explanation": "your explanation here"}"""


class ExplainTypeRequest(BaseModel):
    title: str
    description: str
    type: str


class ExplainTypeResponse(BaseModel):
    explanation: str


@router.post("/topics/explain-type", response_model=ExplainTypeResponse)
async def explain_type(req: ExplainTypeRequest):
    user_content = (
        f"Topic type: {req.type}\n"
        f"Title: {req.title}\n"
        f"Description: {req.description}"
    )
    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=EXPLAIN_TYPE_PROMPT,
            input=user_content,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")

    raw = response.output_text or ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Invalid JSON from OpenAI")

    return ExplainTypeResponse(explanation=data.get("explanation", ""))


@router.post("/topics/reason", response_model=ReasonResponse)
async def reason_topic(req: ReasonRequest):
    profile_parts = [f"Domain: {req.profile.domain}"]
    if req.profile.population:
        profile_parts.append(f"Population: {req.profile.population}")
    if req.profile.focus:
        profile_parts.append(f"Focus: {req.profile.focus}")
    if req.profile.method:
        profile_parts.append(f"Method: {req.profile.method}")
    if req.profile.reviewType:
        profile_parts.append(f"Review Type: {req.profile.reviewType}")

    user_content = (
        f"Research Profile:\n{chr(10).join(profile_parts)}\n\n"
        f"Topic: {req.title}\n"
        f"Description: {req.description}\n"
        f"Tags: {', '.join(req.tags)}"
    )

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=REASON_SYSTEM_PROMPT,
            input=user_content,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")

    raw = response.output_text or ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Invalid JSON from OpenAI")

    return ReasonResponse(reasoning=data.get("reasoning", ""))
