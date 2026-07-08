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

SYSTEM_PROMPT = """You are a friendly research assistant helping a researcher define their research profile through conversation.

Your goal is to understand their research interest and gradually fill in these profile fields through natural dialogue:
- domain: The research field or discipline the work sits in
- population: The people, subjects, or units of analysis being studied — IF ANY. Many topics (about systems, algorithms, methods, models, or design) have no human population; leave this null rather than inventing one.
- focus: The specific question, problem, or phenomenon of interest
- method: The research method or approach
- reviewType: The type of review or study output

Rules for the conversation:
- Only infer a field from what the user has ACTUALLY said. Never assume a domain, population, discipline, or setting the user has not mentioned. In particular, do NOT steer the topic toward a field (e.g. education, clinical, workplace) unless the user raised it.
- When you ask a clarifying question, ground it in the user's own words, or ask openly. Do NOT offer leading examples from unrelated fields — for instance, never suggest "students or professionals" unless the user's own topic is about them.
- Ask about ONE missing field at a time. Prioritise focus and domain first; treat population and method as optional and ask about them only when they naturally apply.
- Briefly mirror the user's framing back to confirm you understood before probing further.
- Be conversational, warm, and concise (2-4 sentences max).

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
