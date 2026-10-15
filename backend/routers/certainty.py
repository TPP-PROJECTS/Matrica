"""
Certainty-of-evidence drafting for a synthesised finding: GRADE for effects and
associations, GRADE-CERQual for qualitative findings.

The framework's domains and allowed judgements arrive with the request — the
frontend holds the one definition of each framework, and the rule that turns
domain judgements into an overall level runs there too. The model is asked
only for what needs reading: a statement of the finding, a starting level for
GRADE, and a judgement with a reason for each domain. It never returns an
overall rating, so the rating a reviewer reports is always the one the
framework's rule gives from judgements they can see and change.

A domain the model leaves out, or answers with a value the framework does not
have, comes back unanswered rather than defaulted: an invented "not serious"
would quietly raise the rating, and an invented "serious" would lower it for
no stated reason.
"""
from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel

from config import response_options
from routers.json_utils import extract_json

router = APIRouter()
client = AsyncOpenAI()

MAX_PAPERS = 60


class Option(BaseModel):
    id: str
    label: str


class DomainSpec(BaseModel):
    id: str
    label: str
    question: str
    options: list[Option]
    upgrade_only: bool = False


class FrameworkSpec(BaseModel):
    id: str
    name: str
    instructions: str = ""
    start_levels: list[str] = []
    domains: list[DomainSpec]


class EvidencePaper(BaseModel):
    title: str
    year: int | None = None
    design: str = ""
    rob_overall: str = ""
    rob_confirmed: bool = False
    retracted: bool = False
    values: dict[str, str] = {}


class ThemeSpec(BaseModel):
    name: str
    synthesis: str = ""


class AssessRequest(BaseModel):
    framework: FrameworkSpec
    theme: ThemeSpec
    papers: list[EvidencePaper]
    profile: dict = {}
    review_question: str = ""


class DomainDraft(BaseModel):
    judgement: str
    rationale: str


class AssessResponse(BaseModel):
    finding: str
    start_level: str | None = None
    domains: dict[str, DomainDraft]


PROMPT = """You are a systematic reviewer rating the certainty of evidence for one finding of a \
review, using the framework named in the request. You are given the finding's theme, the review's \
own synthesis text for it, and the extracted data of every study that contributes to it.

First, state the finding being rated in one or two plain sentences, as a review's summary-of-findings \
table would — what the evidence shows, not what the review hopes. If the synthesis text shows the \
evidence is mixed, say so in the finding.

Then judge each domain of the framework from the supplied evidence ONLY:
- Use exactly one of the option ids listed for the domain.
- Give a one- or two-sentence rationale naming what in the evidence drove the judgement: which \
studies, which designs, which inconsistent results, how few participants.
- When the supplied data cannot settle a domain, say so in the rationale and choose the more \
cautious option — the absence of reported problems is not evidence of their absence. A body of \
evidence of three small studies is not "not serious" for imprecision because no one reported a \
confidence interval.
- Use the risk-of-bias appraisal where one is given. A study marked as retracted must not \
support the finding; say so under risk of bias or methodological limitations.

Do NOT give an overall certainty rating. It is derived from your domain judgements by the \
framework's rule, outside this step.

Respond with valid JSON only — no markdown, no commentary."""


def _paper_block(i: int, p: EvidencePaper) -> str:
    rob = f"{p.rob_overall}{'' if p.rob_confirmed else ' (AI draft, not yet confirmed)'}" if p.rob_overall else "not appraised"
    values = "\n".join(f"    {k}: {v}" for k, v in p.values.items()) or "    (no values)"
    return (
        f"[{i}] {p.title} ({p.year or 'n.d.'})"
        f"{' — RETRACTED' if p.retracted else ''}\n"
        f"  Design: {p.design or 'not recorded'}\n"
        f"  Risk of bias: {rob}\n"
        f"  Extracted data:\n{values}"
    )


@router.post("/certainty/assess", response_model=AssessResponse)
async def assess_certainty(req: AssessRequest):
    fw = req.framework
    if not fw.domains:
        raise HTTPException(status_code=422, detail="The framework has no domains to judge")
    if not req.papers:
        raise HTTPException(status_code=422, detail="No studies contribute to this theme yet")

    domain_block = "\n".join(
        f"- {d.id} — {d.label}{' (upgrading factor: judge only if the start level is low, otherwise answer the first option)' if d.upgrade_only else ''}\n"
        f"  {d.question}\n"
        f"  Options: {', '.join(f'{o.id} ({o.label})' for o in d.options)}"
        for d in fw.domains
    )
    start_line = (
        f"Start level: choose one of {', '.join(fw.start_levels)} and return it as start_level.\n"
        if fw.start_levels else ""
    )
    papers = req.papers[:MAX_PAPERS]
    profile = "; ".join(f"{k}: {v}" for k, v in req.profile.items() if v)

    user_content = f"""FRAMEWORK: {fw.name}
{fw.instructions}
{start_line}
DOMAINS:
{domain_block}

REVIEW: {profile or "(no profile)"}
{f"REVIEW QUESTION: {req.review_question}" if req.review_question else ""}

THEME: {req.theme.name}
SYNTHESIS TEXT FOR THIS THEME:
{req.theme.synthesis or "(none written yet)"}

CONTRIBUTING STUDIES ({len(papers)}):
{chr(10).join(_paper_block(i + 1, p) for i, p in enumerate(papers))}

Respond with JSON:
{{
  "finding": "...",
  {'"start_level": "' + '|'.join(fw.start_levels) + '",' if fw.start_levels else ''}
  "domains": {{ "<domain id>": {{"judgement": "<option id>", "rationale": "..."}} }}
}}
"""

    try:
        response = await client.responses.create(**response_options(), instructions=PROMPT, input=user_content)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Certainty assessment error: {e}")

    data = extract_json(response.output_text or "")
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="The model returned no usable JSON")
    return parse_assessment(data, fw)


def parse_assessment(data: dict, fw: FrameworkSpec) -> AssessResponse:
    """Keep only answers the framework allows; anything else comes back unanswered."""
    raw_domains = data.get("domains") if isinstance(data.get("domains"), dict) else {}
    domains: dict[str, DomainDraft] = {}
    for spec in fw.domains:
        raw = raw_domains.get(spec.id) if isinstance(raw_domains.get(spec.id), dict) else {}
        judgement = str(raw.get("judgement", "")).strip().lower().replace(" ", "_")
        allowed = {o.id for o in spec.options}
        domains[spec.id] = DomainDraft(
            judgement=judgement if judgement in allowed else "",
            rationale=str(raw.get("rationale", "") or ""),
        )
    start = str(data.get("start_level", "") or "").strip().lower()
    return AssessResponse(
        finding=str(data.get("finding", "") or "").strip(),
        start_level=start if start in fw.start_levels else (fw.start_levels[0] if fw.start_levels else None),
        domains=domains,
    )
