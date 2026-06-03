import os
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config import MODEL
from routers.json_utils import extract_json

load_dotenv()

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = """You are a friendly research assistant helping a student define their research profile through conversation.

Your goal is to understand the student's research interests and extract the following profile fields through natural dialogue:
- domain: The research field (e.g., "Healthcare / AI", "Education", "Climate Science")
- population: The target population or subject group (e.g., "Emergency dept. clinicians", "University students")
- focus: The specific research focus or problem (e.g., "Diagnostic accuracy & trust", "Learning outcomes")
- method: The research method (e.g., "Systematic review", "RCT", "Qualitative study")
- reviewType: The type of review (e.g., "Literature review", "Meta-analysis", "Scoping review")

Ask clarifying questions naturally to fill in any missing fields. Be conversational, warm, and encouraging.
Keep responses concise (2-4 sentences max).

IMPORTANT: You must always respond with valid JSON in this exact format:
{
  "reply": "Your conversational response here",
  "profile_updates": {
    "domain": "extracted value or null",
    "population": "extracted value or null",
    "focus": "extracted value or null",
    "method": "extracted value or null",
    "reviewType": "extracted value or null"
  }
}

Only include a field in profile_updates if you are confident you extracted it from this specific message. Use null for fields you haven't extracted yet or aren't sure about."""


class ChatMessageInput(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ProfileUpdates(BaseModel):
    domain: str | None = None
    population: str | None = None
    focus: str | None = None
    method: str | None = None
    reviewType: str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessageInput]
    new_message: str


class ChatResponse(BaseModel):
    reply: str
    profile_updates: ProfileUpdates



@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    input_messages = []
    for msg in req.messages:
        if msg.role in ("user", "assistant"):
            input_messages.append({"role": msg.role, "content": msg.content})
    input_messages.append({"role": "user", "content": req.new_message})

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=SYSTEM_PROMPT,
            input=input_messages,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")

    raw = (response.output_text or "").strip()

    data = extract_json(raw)
    if data is None:
        # Couldn't find any JSON — treat the whole text as a plain reply
        return ChatResponse(reply=raw, profile_updates=ProfileUpdates())

    reply = data.get("reply", "")
    updates_raw = data.get("profile_updates", {})

    profile_updates = ProfileUpdates(
        domain=updates_raw.get("domain") or None,
        population=updates_raw.get("population") or None,
        focus=updates_raw.get("focus") or None,
        method=updates_raw.get("method") or None,
        reviewType=updates_raw.get("reviewType") or None,
    )

    return ChatResponse(reply=reply, profile_updates=profile_updates)
