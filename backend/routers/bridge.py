"""
Orchestration bridge endpoint.

Accepts the standard orchestration External Component Registry protocol:
  POST /api/bridge  { message: str, trace_id: str }
  →  { reply: str }

This lets orchestration register topic-generator as an HTTP external component
and route governed messages to it without any changes to the orchestration project.
"""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routers.assistant import AssistantRequest, assistant_chat

logger = logging.getLogger(__name__)
router = APIRouter()


class BridgeRequest(BaseModel):
    message: str
    trace_id: str


class BridgeResponse(BaseModel):
    reply: str


@router.post("/bridge", response_model=BridgeResponse)
async def bridge(req: BridgeRequest):
    """
    Proxy entry point for the orchestration External Component Registry.
    Forwards the incoming message to the research assistant and returns its reply.
    """
    logger.info("[bridge] trace_id=%s message_len=%d", req.trace_id, len(req.message))
    try:
        result = await assistant_chat(
            AssistantRequest(
                messages=[],
                new_message=req.message,
                # Inject trace_id so the assistant knows this request originated
                # from orchestration; useful for correlated log searches.
                orchestration_trace_id=req.trace_id,
            )
        )
        logger.info("[bridge] trace_id=%s reply_len=%d", req.trace_id, len(result.reply))
        return BridgeResponse(reply=result.reply)
    except Exception as e:
        logger.error("[bridge] trace_id=%s error=%s", req.trace_id, e)
        raise HTTPException(status_code=502, detail=f"Bridge error: {e}")
