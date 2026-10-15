"""Model configuration shared by all Responses API requests."""
import os
from pathlib import Path
from dotenv import load_dotenv

# Native startup: backend settings first, then root fallbacks. Exported settings win.
_backend = Path(__file__).resolve().parent
load_dotenv(_backend / ".env")
load_dotenv(_backend.parent / ".env")

MODEL = os.getenv("OPENAI_MODEL", "gpt-6-sol").strip()
REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "none").strip()
WEB_REASONING_EFFORT = os.getenv("OPENAI_WEB_REASONING_EFFORT", "low").strip()


def response_options(web_search=False):
    effort = WEB_REASONING_EFFORT if web_search else REASONING_EFFORT
    if not MODEL:
        raise ValueError("OPENAI_MODEL must not be empty")
    if effort not in {"none", "low", "medium", "high", "xhigh", "max"}:
        raise ValueError(f"Invalid OpenAI reasoning effort: {effort}")
    if MODEL.startswith(("gpt-6-astra", "gpt-6.1-sol")) and effort == "none":
        raise ValueError(f"{MODEL} requires reasoning effort low or higher")
    return {"model": MODEL, "reasoning": {"effort": effort}}
