"""
AI-assisted risk-of-bias appraisal.

The model's job here is narrow on purpose. It answers the fixed signalling
questions of a published instrument against the text of one paper, and it is
instructed to answer "no information" whenever the text does not support a
judgement — which, for an abstract alone, is most of the time. Randomisation
concealment, blinding of outcome assessors and pre-specified analysis plans are
almost never described in an abstract, and a tool that rates them confidently
from one is worse than a tool that offers nothing: it manufactures the
appearance of an appraisal the reviewer never performed.

So every judgement carries a quote from the source, and the frontend checks
that quote against the paper. An assessment is a draft for a human to confirm,
never a result.
"""
from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel

from config import MODEL
from routers.json_utils import extract_json
from routers.rob_catalog import TOOLS_BY_ID

router = APIRouter()
client = AsyncOpenAI()


class RobPaper(BaseModel):
    title: str
    abstract: str = ""
    authors: str = ""
    year: int | None = None
    fullText: str = ""


class AssessRequest(BaseModel):
    toolId: str
    paper: RobPaper
    custom_system_prompt: str | None = None


class DomainJudgement(BaseModel):
    domainId: str
    judgement: str
    rationale: str
    supportQuote: str = ""


class AssessResponse(BaseModel):
    toolId: str
    domains: list[DomainJudgement]
    overall: str
    overallRationale: str


ASSESS_PROMPT = """You are a systematic reviewer carrying out a risk-of-bias assessment using a \
published appraisal instrument. You are given one study and the instrument's domains.

Answer each domain from the supplied text ONLY.

The single most important rule: if the supplied text does not contain the information a domain \
asks about, the judgement is "no_information". Abstracts almost never describe allocation \
concealment, blinding of outcome assessors, handling of missing data, or whether the analysis \
plan was pre-specified. Answering "low risk" because nothing looked wrong is a serious error — \
absence of a description is not evidence of good conduct. A reviewer reading your output must be \
able to tell what the paper actually reported apart from what it simply did not mention.

Answer the question each domain actually asks, rather than applying a rule of thumb attached to
its name. Several domains turn on whether a feature COULD have biased THIS study's result, not on
whether the feature is present: an unblinded trial measuring all-cause mortality is not biased by
its lack of blinding, and saying otherwise downgrades every pragmatic trial in the review for a
problem it does not have. Read the domain's wording and apply it to the outcome and design in
front of you.

For each domain return:
- judgement: exactly one of the allowed values listed for the instrument
- rationale: one or two sentences saying what in the text drove the judgement, or stating plainly \
that the text does not report it
- supportQuote: the sentence from the supplied text that the judgement rests on, copied CHARACTER \
FOR CHARACTER. This quote is checked against the source, so a paraphrased or tidied one will fail \
that check. Use "" when the judgement is "no_information" or is a reasoned inference rather than \
something the text states — an empty quote is a correct answer.

Then give the overall judgement by applying the instrument's stated rule, and one or two sentences \
of overallRationale explaining how the domains combined.

Respond with valid JSON only — no markdown, no commentary."""


@router.post("/rob/assess", response_model=AssessResponse)
async def assess_risk_of_bias(req: AssessRequest):
    tool = TOOLS_BY_ID.get(req.toolId)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Unknown appraisal tool: {req.toolId}")

    allowed = [j["value"] for j in tool["judgements"]]
    domain_block = "\n".join(
        f'- {d["id"]} — {d["label"]}\n  {d["question"]}' for d in tool["domains"]
    )

    source_text = req.paper.abstract or ""
    full_text_section = (
        f"\nFULL TEXT (extracted from an open-access PDF; may be noisy or truncated):\n{req.paper.fullText}\n"
        if req.paper.fullText else ""
    )

    user_content = f"""INSTRUMENT: {tool["name"]} — {tool["fullName"]}
Applies to: {tool["appliesTo"]}
Allowed judgements: {", ".join(allowed)}
Overall rule: {tool["overallRule"]}

DOMAINS TO ASSESS:
{domain_block}

STUDY UNDER APPRAISAL:
Title: {req.paper.title}
Authors: {req.paper.authors or "Unknown"}
Year: {req.paper.year or "Unknown"}
Abstract: {source_text or "(no abstract available)"}
{full_text_section}
Respond with JSON:
{{
  "domains": [
    {{"domainId": "...", "judgement": "one of: {"|".join(allowed)}", "rationale": "...", "supportQuote": "exact sentence, or \\"\\""}}
  ],
  "overall": "...",
  "overallRationale": "..."
}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or ASSESS_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or "")
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail="Appraisal model returned no usable JSON")

        by_id = {
            str(d.get("domainId")): d
            for d in (data.get("domains") or [])
            if isinstance(d, dict)
        }

        # Build the response from the instrument's own domain list rather than
        # from whatever the model returned. A domain the model skipped must
        # appear as unanswered, not vanish — a silently shortened instrument is
        # not the instrument the reviewer will cite.
        domains: list[DomainJudgement] = []
        for spec in tool["domains"]:
            raw = by_id.get(spec["id"], {})
            judgement = str(raw.get("judgement", "")).strip().lower().replace(" ", "_")
            if judgement not in allowed:
                judgement = "no_information"
            domains.append(DomainJudgement(
                domainId=spec["id"],
                judgement=judgement,
                rationale=str(raw.get("rationale", "") or ""),
                supportQuote=str(raw.get("supportQuote", "") or ""),
            ))

        return AssessResponse(
            toolId=req.toolId,
            domains=domains,
            overall=str(data.get("overall", "") or ""),
            overallRationale=str(data.get("overallRationale", "") or ""),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risk-of-bias assessment error: {str(e)}")
