from routers.json_utils import extract_json
import json
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from config import MODEL

router = APIRouter()
client = AsyncOpenAI()


class ProfileInfo(BaseModel):
    domain: str = ''
    population: str = ''
    focus: str = ''
    method: str = ''
    reviewType: str = ''


class CellInfo(BaseModel):
    value: str = ''
    confidenceScore: float = 0.5
    confidenceLevel: str = 'medium'
    evidenceType: str = 'inferred'
    extractionMethod: str = 'inferred'


class MatrixRowInfo(BaseModel):
    title: str
    authors: str = ''
    year: int | None = None
    cells: dict[str, CellInfo] = {}


class SystemRowInfo(BaseModel):
    name: str
    vendor: str = ''
    category: str = ''
    cells: dict[str, CellInfo] = {}


class ThemeInfo(BaseModel):
    name: str
    coverageLabel: str = ''
    blocks: list[dict] = []


class GenerateGapRequest(BaseModel):
    matrix_rows: list[MatrixRowInfo] = []
    system_rows: list[SystemRowInfo] = []
    columns: list[str] = []
    system_columns: list[str] = []
    profile: ProfileInfo = ProfileInfo()
    themes: list[ThemeInfo] = []
    custom_system_prompt: str | None = None


class GenerateGapResponse(BaseModel):
    statement: str


GAP_SYSTEM_PROMPT = """You are an expert systematic review methodologist writing a gap statement for a research paper introduction.
You have access to TWO evidence sources:
1. A LITERATURE MATRIX — structured data extracted from academic papers
2. A SYSTEM REVIEW MATRIX — comparative data on software/clinical systems

Your task: write a cohesive 3–4 paragraph gap statement that:
- Acknowledges what the existing literature AND system landscape have established
- Identifies specific gaps in the evidence (missing data, low confidence, contested findings, absent populations)
- Identifies gaps in the system landscape (missing system types, unassessed dimensions, limited comparative evidence)
- Concludes with the specific research opportunity that these combined gaps create

Rules:
- Be specific — reference actual paper titles (shortened) and system names from the data
- Do NOT invent findings. If data is sparse, say so
- Write in academic, third-person prose suitable for a journal introduction
- Each paragraph should be 3–5 sentences
- The final paragraph must frame the gap as a clear research opportunity

Respond with valid JSON only — no markdown: {"statement": "paragraph1\\n\\nparagraph2\\n\\n..."}
"""


def _summarise_lit(rows: list[MatrixRowInfo], cols: list[str]) -> str:
    data_cols = [c for c in cols if c not in ('#', 'Title', 'Authors', 'Year')]
    if not rows:
        return '(no literature data)'
    lines = []
    for r in rows:
        filled = {c: r.cells[c].value[:100] for c in data_cols if r.cells.get(c) and r.cells[c].value}
        conf_vals = [r.cells[c].confidenceScore for c in data_cols if r.cells.get(c) and r.cells[c].value]
        avg_conf = round(sum(conf_vals) / len(conf_vals)) if conf_vals else 0
        missing = [c for c in data_cols if not r.cells.get(c) or not r.cells[c].value]
        summary = '; '.join(f'{k}: {v}' for k, v in list(filled.items())[:4])
        lines.append(
            f'• [{r.year or "?"}] {r.title} (avg conf {avg_conf}%) — {summary or "(no data)"}'
            + (f' | MISSING: {", ".join(missing[:3])}' if missing else '')
        )
    return '\n'.join(lines)


def _summarise_sys(rows: list[SystemRowInfo], cols: list[str]) -> str:
    if not rows:
        return '(no system review data)'
    lines = []
    for r in rows:
        filled = {c: r.cells[c].value[:100] for c in cols if r.cells.get(c) and r.cells[c].value}
        missing = [c for c in cols if not r.cells.get(c) or not r.cells[c].value]
        summary = '; '.join(f'{k}: {v}' for k, v in list(filled.items())[:4])
        lines.append(
            f'• {r.name} ({r.vendor or r.category}) — {summary or "(no data)"}'
            + (f' | MISSING: {", ".join(missing[:3])}' if missing else '')
        )
    return '\n'.join(lines)


@router.post('/gaps/generate', response_model=GenerateGapResponse)
async def generate_gap_statement(req: GenerateGapRequest):
    lit_summary = _summarise_lit(req.matrix_rows, req.columns)
    sys_summary = _summarise_sys(req.system_rows, req.system_columns)

    theme_context = ''
    if req.themes:
        theme_context = '\nSYNTHESIS THEMES (from prior step):\n' + '\n'.join(
            f'• {t.name} ({t.coverageLabel})'
            + (f': {t.blocks[2].get("content", "")[:150]}…' if len(t.blocks) > 2 and isinstance(t.blocks[2], dict) else '')
            for t in req.themes
        )

    user_content = f"""Write a gap statement for this systematic review.

RESEARCH PROFILE:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}
Method: {req.profile.method}
Review type: {req.profile.reviewType}
{theme_context}

LITERATURE MATRIX ({len(req.matrix_rows)} papers):
{lit_summary}

SYSTEM REVIEW ({len(req.system_rows)} systems):
{sys_summary}

Write 3–4 paragraphs as a gap statement. Integrate evidence from BOTH sources.
Respond with JSON: {{"statement": "para1\\n\\npara2\\n\\npara3"}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or GAP_SYSTEM_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or '')
        if data is None:
            raise HTTPException(status_code=500, detail='AI returned invalid JSON')
        statement = str(data.get('statement', '')).strip()
        if not statement:
            raise ValueError('empty statement')
        return GenerateGapResponse(statement=statement)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Gap statement generation error: {str(e)}')
