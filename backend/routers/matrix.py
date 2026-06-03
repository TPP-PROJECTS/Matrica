from routers.json_utils import extract_json
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from config import MODEL

router = APIRouter()
client = AsyncOpenAI()

SYSTEM_PROMPT = """You are an expert systematic review methodologist.
Generate concise, specific column names for a literature review extraction matrix.
Respond with valid JSON only — no markdown, no commentary.
"""


class PaperInfo(BaseModel):
    title: str
    abstract: str = ''
    authors: str = ''
    year: int | None = None


class TopicInfo(BaseModel):
    title: str
    description: str = ''
    type: str = ''


class ProfileInfo(BaseModel):
    domain: str = ''
    population: str = ''
    focus: str = ''
    method: str = ''
    reviewType: str = ''


class GenerateColumnsRequest(BaseModel):
    papers: list[PaperInfo]
    topics: list[TopicInfo]
    profile: ProfileInfo
    custom_system_prompt: str | None = None


class GenerateColumnsResponse(BaseModel):
    columns: list[str]


class SystemInfo(BaseModel):
    name: str
    category: str = ''
    vendor: str = ''
    description: str = ''


class GenerateSystemColumnsRequest(BaseModel):
    systems: list[SystemInfo]
    profile: ProfileInfo
    topics: list[TopicInfo] = []
    custom_system_prompt: str | None = None


SYSTEM_REVIEW_PROMPT = """You are an expert in health technology assessment and systematic review methodology.
Generate concise, specific column names for a system review comparison matrix.
Respond with valid JSON only — no markdown, no commentary.
"""


@router.post("/matrix/generate-system-columns", response_model=GenerateColumnsResponse)
async def generate_system_columns(req: GenerateSystemColumnsRequest):
    system_list = '\n'.join(
        f'- {s.name} ({s.category}){f" by {s.vendor}" if s.vendor else ""}{f": {s.description[:150]}" if s.description else ""}'
        for s in req.systems[:20]
    )
    topic_list = '\n'.join(f'- [{t.type}] {t.title}' for t in req.topics) if req.topics else '(none)'

    user_content = f"""Design comparison columns for a system review matrix that evaluates these software systems.

RESEARCH PROFILE:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}
Method: {req.profile.method}

SYSTEMS BEING REVIEWED ({len(req.systems)} total):
{system_list}

RESEARCH TOPICS:
{topic_list}

Generate 5–8 meaningful column names for comparing these systems side-by-side.
Focus on dimensions relevant to THIS domain (e.g. core functionality, evidence base, integration, regulatory status, user adoption, limitations — tailored to the specific systems).
Do NOT include System Name, Vendor, or Category — those are fixed columns.
Keep names short (2–4 words each).

Respond with JSON:
{{"columns": ["Column Name 1", "Column Name 2", ...]}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or SYSTEM_REVIEW_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or "")
        if data is None:
            raise HTTPException(status_code=500, detail="AI returned invalid JSON")
        columns = data.get("columns", [])
        if not columns:
            raise ValueError("empty columns")
        return GenerateColumnsResponse(columns=columns)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"System column generation error: {str(e)}")


class CellData(BaseModel):
    value: str
    evidenceType: str
    confidenceScore: float
    confidenceLevel: str
    extractionMethod: str


class AutofillRowRequest(BaseModel):
    paper: PaperInfo
    columns: list[str]
    profile: ProfileInfo
    topics: list[TopicInfo] = []
    custom_system_prompt: str | None = None


class AutofillRowResponse(BaseModel):
    cells: dict[str, CellData]


class AutofillSystemRowRequest(BaseModel):
    system: SystemInfo
    columns: list[str]
    profile: ProfileInfo
    custom_system_prompt: str | None = None


AUTOFILL_LITERATURE_PROMPT = """You are an expert systematic reviewer extracting structured data from research paper abstracts.
For each column, extract or infer the relevant information.
Rules:
- evidenceType: "extracted" if clearly stated, "inferred" if reasoned from context, "not_available" if truly absent
- confidenceScore: integer 0–100
- confidenceLevel: "high" (≥75), "medium" (45–74), "low" (15–44), "none" (<15)
- extractionMethod: "verbatim" (direct quote), "summarised" (condensed from text), "inferred" (reasoned), "not_available"
- value: concise, max 2–3 sentences; write "—" if not_available
Respond with valid JSON only — no markdown, no extra text.
"""

AUTOFILL_SYSTEM_PROMPT = """You are an expert in health information technology and systematic review methodology.
For each column, use your knowledge of this software system to fill in the comparison data.
Rules:
- evidenceType: "extracted" if this is documented public knowledge, "inferred" if you are reasoning from related knowledge, "not_available" if genuinely unknown
- confidenceScore: integer 0–100 reflecting certainty of the information
- confidenceLevel: "high" (≥75), "medium" (45–74), "low" (15–44), "none" (<15)
- extractionMethod: "verbatim", "summarised", "inferred", or "not_available"
- value: concise, max 2–3 sentences; write "—" if not_available
Respond with valid JSON only — no markdown, no extra text.
"""


class CellEvidenceRequest(BaseModel):
    cell_value: str
    column_name: str
    # Literature context
    paper_title: str = ""
    paper_abstract: str = ""
    paper_authors: str = ""
    paper_year: int | None = None
    # System context
    system_name: str = ""
    system_vendor: str = ""
    system_description: str = ""
    # Research context
    domain: str = ""
    focus: str = ""


class CellEvidenceResponse(BaseModel):
    reasoning: str
    sources: list[str]


CELL_EVIDENCE_PROMPT = """You are an expert systematic reviewer auditing a data extraction matrix.
Given a cell value and its source context, reason step-by-step to identify:
1. The specific evidence that supports this extracted value (quote or paraphrase the relevant text)
2. How confident you are in this extraction and why
3. Any caveats or alternative interpretations
4. Suggested primary sources or references to verify

Be precise and scholarly. If this is a system comparison, draw on publicly known information about the software.
Respond ONLY with valid JSON: {"reasoning": "...", "sources": ["source1", "source2"]}
"""


@router.post("/matrix/cell-evidence", response_model=CellEvidenceResponse)
async def get_cell_evidence(req: CellEvidenceRequest):
    is_literature = bool(req.paper_title)

    if is_literature:
        context = f"""PAPER:
Title: {req.paper_title}
Authors: {req.paper_authors or "Unknown"}
Year: {req.paper_year or "Unknown"}
Abstract: {req.paper_abstract or "(no abstract)"}

EXTRACTED VALUE for column "{req.column_name}":
{req.cell_value}

Research domain: {req.domain}
Research focus: {req.focus}

Explain step-by-step what in the abstract supports this extracted value.
Identify the specific sentence(s) or reasoning that led to this extraction.
List any direct quotes or references that serve as evidence."""
    else:
        context = f"""SYSTEM UNDER REVIEW:
Name: {req.system_name}
Vendor: {req.system_vendor or "Unknown"}
Description: {req.system_description or "(none)"}

EXTRACTED VALUE for column "{req.column_name}":
{req.cell_value}

Research domain: {req.domain}
Research focus: {req.focus}

Explain what publicly known information supports this value.
Identify specific documentation, publications, or well-known facts that serve as evidence.
List any concrete sources (official docs, peer-reviewed papers, reputable reviews) that can verify this."""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=CELL_EVIDENCE_PROMPT,
            input=context,
        )
        data = extract_json(response.output_text or "")
        return CellEvidenceResponse(
            reasoning=data.get("reasoning", ""),
            sources=data.get("sources", []),
        )
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cell evidence error: {str(e)}")


@router.post("/matrix/autofill-row", response_model=AutofillRowResponse)
async def autofill_literature_row(req: AutofillRowRequest):
    col_list = '\n'.join(f'- {c}' for c in req.columns)
    topic_list = '\n'.join(f'  [{t.type}] {t.title}' for t in req.topics) or '(none)'

    user_content = f"""Extract data from this paper for each column listed below.

PAPER:
Title: {req.paper.title}
Authors: {req.paper.authors or "Unknown"}
Year: {req.paper.year or "Unknown"}
Abstract: {req.paper.abstract or "(no abstract available)"}

RESEARCH PROFILE:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}

RESEARCH TOPICS:
{topic_list}

COLUMNS TO FILL:
{col_list}

Respond with JSON:
{{
  "cells": {{
    "Column Name": {{
      "value": "...",
      "evidenceType": "extracted",
      "confidenceScore": 80,
      "confidenceLevel": "high",
      "extractionMethod": "summarised"
    }}
  }}
}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or AUTOFILL_LITERATURE_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or "")
        raw_cells = data.get("cells", {})
        cells: dict[str, CellData] = {}
        for col, cd in raw_cells.items():
            cells[col] = CellData(
                value=str(cd.get("value", "—")),
                evidenceType=cd.get("evidenceType", "inferred"),
                confidenceScore=int(cd.get("confidenceScore", 50)),
                confidenceLevel=cd.get("confidenceLevel", "medium"),
                extractionMethod=cd.get("extractionMethod", "inferred"),
            )
        return AutofillRowResponse(cells=cells)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Autofill error: {str(e)}")


@router.post("/matrix/autofill-system-row", response_model=AutofillRowResponse)
async def autofill_system_row(req: AutofillSystemRowRequest):
    col_list = '\n'.join(f'- {c}' for c in req.columns)

    user_content = f"""Fill comparison data for this software system for each column listed.

SYSTEM:
Name: {req.system.name}
Vendor: {req.system.vendor or "Unknown"}
Category: {req.system.category or "Other"}
Description: {req.system.description or "(no description provided)"}

RESEARCH CONTEXT:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}

COLUMNS TO FILL:
{col_list}

Respond with JSON:
{{
  "cells": {{
    "Column Name": {{
      "value": "...",
      "evidenceType": "extracted",
      "confidenceScore": 80,
      "confidenceLevel": "high",
      "extractionMethod": "summarised"
    }}
  }}
}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or AUTOFILL_SYSTEM_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or "")
        raw_cells = data.get("cells", {})
        cells: dict[str, CellData] = {}
        for col, cd in raw_cells.items():
            cells[col] = CellData(
                value=str(cd.get("value", "—")),
                evidenceType=cd.get("evidenceType", "inferred"),
                confidenceScore=int(cd.get("confidenceScore", 50)),
                confidenceLevel=cd.get("confidenceLevel", "medium"),
                extractionMethod=cd.get("extractionMethod", "inferred"),
            )
        return AutofillRowResponse(cells=cells)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"System autofill error: {str(e)}")


@router.post("/matrix/generate-columns", response_model=GenerateColumnsResponse)
async def generate_columns(req: GenerateColumnsRequest):
    paper_list = '\n'.join(
        f'- {p.title} ({p.year}) by {p.authors}' + (f' | {p.abstract[:200]}…' if p.abstract else '')
        for p in req.papers[:20]
    )
    topic_list = '\n'.join(
        f'- [{t.type}] {t.title}: {t.description}'
        for t in req.topics
    )

    user_content = f"""Design extraction columns for a systematic review matrix based on these papers and topics.

RESEARCH PROFILE:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}
Method: {req.profile.method}
Review type: {req.profile.reviewType}

PAPERS TO REVIEW ({len(req.papers)} total):
{paper_list}

RESEARCH TOPICS:
{topic_list}

Generate 5–8 meaningful data column names for extracting key information from these papers.
The columns should capture what matters most for THIS specific review (e.g. study design, sample, outcomes, measures, findings, limitations — but tailored to the domain).
Do NOT include Title, Authors, or Year — those are fixed columns.
Keep names short (2–4 words each).

Respond with JSON:
{{"columns": ["Column Name 1", "Column Name 2", ...]}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or SYSTEM_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or "")
        if data is None:
            raise HTTPException(status_code=500, detail="AI returned invalid JSON")
        columns = data.get("columns", [])
        if not columns:
            raise ValueError("empty columns")
        return GenerateColumnsResponse(columns=columns)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Matrix column generation error: {str(e)}")
