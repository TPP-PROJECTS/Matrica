import json
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from config import MODEL

router = APIRouter()
client = AsyncOpenAI()


# ── Request / Response models ─────────────────────────────────────────────────

class ProfileInfo(BaseModel):
    domain: str = ''
    population: str = ''
    focus: str = ''
    method: str = ''
    reviewType: str = ''


class TopicInfo(BaseModel):
    title: str
    description: str = ''
    type: str = ''


class CellInfo(BaseModel):
    value: str = ''
    confidenceScore: float = 0.5
    confidenceLevel: str = 'medium'
    evidenceType: str = 'inferred'


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


class GenerateSynthesisRequest(BaseModel):
    matrix_rows: list[MatrixRowInfo] = []
    system_rows: list[SystemRowInfo] = []
    columns: list[str] = []
    system_columns: list[str] = []
    profile: ProfileInfo
    topics: list[TopicInfo] = []
    custom_system_prompt: str | None = None


class SynthesisBlockOut(BaseModel):
    id: str
    blockType: str   # 'focus' | 'patterns' | 'unclear' | 'missing'
    title: str
    content: str
    paperCount: int
    avgConfidence: float
    isLowConfidence: bool


class ThemeOut(BaseModel):
    id: str
    name: str
    paperCount: int
    totalPapers: int
    coverageLabel: str   # 'Dense' | 'Moderate' | 'Sparse'
    profileMatch: str | None
    sourceColumns: list[str]
    blocks: list[SynthesisBlockOut]


class GenerateSynthesisResponse(BaseModel):
    themes: list[ThemeOut]


# ── Prompt ────────────────────────────────────────────────────────────────────

SYNTHESIS_SYSTEM_PROMPT = """You are an expert systematic review methodologist performing narrative synthesis.
You have TWO data sources: a LITERATURE MATRIX (papers) and a SYSTEM REVIEW MATRIX (software systems).
Synthesise ACROSS BOTH SOURCES — each theme and each block should integrate evidence from papers AND systems where relevant.

For each theme produce exactly 4 synthesis blocks (in this order):
- "focus"    → "What research focuses on" — research questions, designs used, AND which systems are commonly studied/deployed
- "patterns" → "Patterns in the evidence" — recurring findings across papers AND consistent capabilities/limitations across systems
- "unclear"  → "What is still unclear" — contested paper findings AND unverified system claims or missing comparative evidence
- "missing"  → "Entirely missing" — gaps in literature AND gaps in the system landscape (missing system types, unassessed dimensions)

Rules:
- Identify 2–4 distinct themes. Each theme name should be concise (3–5 words).
- paperCount = number of matrix rows that contribute to this theme
- totalPapers = total number of matrix rows provided
- avgConfidence = mean confidenceScore (0–100) of cells in this theme / 100 (so 0.0–1.0)
- isLowConfidence = true if avgConfidence < 0.6
- coverageLabel: "Dense" if paperCount/totalPapers ≥ 0.6, "Moderate" if ≥ 0.3, else "Sparse"
- profileMatch: "profile_match" if highly relevant to the research profile, "inferred" if tangentially related, null if not relevant
- sourceColumns: which column names from the LITERATURE matrix drive this theme (2–4 columns)
- Content must integrate both paper AND system evidence — explicitly reference paper titles or system names.
- Do NOT invent data. If system data is absent for a theme, acknowledge that.

Respond with valid JSON only — no markdown, no commentary.
"""


# ── Helper: format matrix for the prompt ─────────────────────────────────────

def _format_lit_matrix(rows: list[MatrixRowInfo], columns: list[str]) -> str:
    if not rows:
        return '(no literature papers)'
    lines = []
    for r in rows:
        cells_str = ' | '.join(
            f'{c}: {r.cells[c].value[:120] if r.cells.get(c) and r.cells[c].value else "—"}'
            for c in columns if c not in ('#', 'Title', 'Authors', 'Year')
        )
        lines.append(f'• [{r.year or "?"}] {r.title} — {cells_str}')
    return '\n'.join(lines)


def _format_sys_matrix(rows: list[SystemRowInfo], columns: list[str]) -> str:
    if not rows:
        return '(no systems)'
    lines = []
    for r in rows:
        cells_str = ' | '.join(
            f'{c}: {r.cells[c].value[:120] if r.cells.get(c) and r.cells[c].value else "—"}'
            for c in columns
        )
        lines.append(f'• {r.name} ({r.vendor or r.category}) — {cells_str}')
    return '\n'.join(lines)


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post('/synthesis/generate', response_model=GenerateSynthesisResponse)
async def generate_synthesis(req: GenerateSynthesisRequest):
    lit_section = _format_lit_matrix(req.matrix_rows, req.columns)
    sys_section = _format_sys_matrix(req.system_rows, req.system_columns)
    topic_list = '\n'.join(f'- [{t.type}] {t.title}' for t in req.topics) or '(none)'

    user_content = f"""Perform narrative synthesis for this systematic review.

RESEARCH PROFILE:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}
Method: {req.profile.method}
Review type: {req.profile.reviewType}

RESEARCH TOPICS:
{topic_list}

LITERATURE MATRIX ({len(req.matrix_rows)} papers, columns: {', '.join(c for c in req.columns if c not in ('#','Title','Authors','Year')) or 'none'}):
{lit_section}

SYSTEM REVIEW ({len(req.system_rows)} systems, columns: {', '.join(req.system_columns) or 'none'}):
{sys_section}

Generate 2–4 synthesis themes. For each theme produce the 4 required blocks.

Respond with JSON:
{{
  "themes": [
    {{
      "id": "th1",
      "name": "Theme name",
      "paperCount": 5,
      "totalPapers": {len(req.matrix_rows)},
      "coverageLabel": "Dense",
      "profileMatch": "profile_match",
      "sourceColumns": ["Column A", "Column B"],
      "blocks": [
        {{"id": "th1-focus",    "blockType": "focus",    "title": "What research focuses on", "content": "...", "paperCount": 5, "avgConfidence": 0.82, "isLowConfidence": false}},
        {{"id": "th1-patterns", "blockType": "patterns", "title": "Patterns in the evidence",  "content": "...", "paperCount": 4, "avgConfidence": 0.78, "isLowConfidence": false}},
        {{"id": "th1-unclear",  "blockType": "unclear",  "title": "What is still unclear",    "content": "...", "paperCount": 3, "avgConfidence": 0.55, "isLowConfidence": true}},
        {{"id": "th1-missing",  "blockType": "missing",  "title": "Entirely missing",         "content": "...", "paperCount": 2, "avgConfidence": 0.70, "isLowConfidence": false}}
      ]
    }}
  ]
}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or SYNTHESIS_SYSTEM_PROMPT,
            input=user_content,
        )
        raw = response.output_text or ''
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        data = json.loads(match.group() if match else raw)

        themes_raw = data.get('themes', [])
        if not themes_raw:
            raise ValueError('empty themes')

        themes: list[ThemeOut] = []
        for t in themes_raw:
            blocks: list[SynthesisBlockOut] = []
            for b in t.get('blocks', []):
                blocks.append(SynthesisBlockOut(
                    id=str(b.get('id', '')),
                    blockType=str(b.get('blockType', 'focus')),
                    title=str(b.get('title', '')),
                    content=str(b.get('content', '')),
                    paperCount=int(b.get('paperCount') or 0),
                    avgConfidence=float(b.get('avgConfidence') if b.get('avgConfidence') is not None else 0.5),
                    isLowConfidence=bool(b.get('isLowConfidence') or False),
                ))
            themes.append(ThemeOut(
                id=str(t.get('id') or f'th{len(themes)+1}'),
                name=str(t.get('name') or 'Theme'),
                paperCount=int(t.get('paperCount') or 0),
                totalPapers=int(t.get('totalPapers', len(req.matrix_rows))),
                coverageLabel=str(t.get('coverageLabel', 'Moderate')),
                profileMatch=t.get('profileMatch'),
                sourceColumns=list(t.get('sourceColumns', [])),
                blocks=blocks,
            ))

        return GenerateSynthesisResponse(themes=themes)

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail='AI returned invalid JSON')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Synthesis generation error: {str(e)}')


# ── Regenerate single block ───────────────────────────────────────────────────

class RegenerateBlockRequest(BaseModel):
    block_type: str          # 'focus' | 'patterns' | 'unclear' | 'missing' | 'custom'
    block_title: str         # analyst display name
    theme_name: str
    source_columns: list[str] = []
    matrix_rows: list[MatrixRowInfo] = []
    system_rows: list[SystemRowInfo] = []
    columns: list[str] = []
    system_columns: list[str] = []
    profile: ProfileInfo
    custom_system_prompt: str | None = None


class RegenerateBlockResponse(BaseModel):
    content: str
    paper_count: int
    avg_confidence: float
    is_low_confidence: bool


BLOCK_TYPE_INSTRUCTIONS = {
    'focus':    'Describe the main research questions, objectives, and methodological approaches used across the evidence. What are researchers studying and how?',
    'patterns': 'Identify recurring findings, agreements, and consistent trends across the evidence. What converges across multiple papers or systems?',
    'unclear':  'Identify what remains contested, methodologically weak, inconclusive, or insufficiently addressed in the current evidence base.',
    'missing':  'Identify what is entirely absent: topics not studied, populations not represented, outcomes not measured, methodologies not applied.',
    'custom':   'Answer the specific question or dimension named in the analyst title, drawing directly from the evidence provided.',
}

REGEN_SYSTEM_PROMPT = """You are an expert systematic review methodologist writing a single synthesis paragraph.
You have access to BOTH a literature matrix (papers) and a system review matrix (software systems).
Integrate evidence from BOTH sources where relevant — reference specific paper titles AND system names.
Write 3–5 sentences. Do NOT invent data. If one source is sparse, acknowledge it briefly.
Respond with valid JSON only — no markdown.
"""


@router.post('/synthesis/regenerate-block', response_model=RegenerateBlockResponse)
async def regenerate_block(req: RegenerateBlockRequest):
    data_cols = [c for c in req.columns if c not in ('#', 'Title', 'Authors', 'Year')]
    focus_cols = req.source_columns if req.source_columns else data_cols

    # Build a focused evidence summary
    lit_lines = []
    total_conf = []
    for r in req.matrix_rows:
        parts = []
        for c in focus_cols:
            cell = r.cells.get(c)
            if cell and cell.value:
                parts.append(f'{c}: {cell.value[:120]}')
                total_conf.append(cell.confidenceScore)
        if parts:
            lit_lines.append(f'• [{r.year or "?"}] {r.title} — ' + ' | '.join(parts))

    sys_lines = []
    for r in req.system_rows:
        parts = [f'{c}: {r.cells[c].value[:100]}' for c in req.system_columns if r.cells.get(c) and r.cells[c].value]
        if parts:
            sys_lines.append(f'• {r.name} — ' + ' | '.join(parts))

    avg_conf = (sum(total_conf) / len(total_conf) / 100) if total_conf else 0.5
    paper_count = len([r for r in req.matrix_rows if any(r.cells.get(c) and r.cells[c].value for c in focus_cols)])
    is_low = avg_conf < 0.6

    task_instruction = BLOCK_TYPE_INSTRUCTIONS.get(req.block_type, BLOCK_TYPE_INSTRUCTIONS['custom'])

    user_content = f"""Write one synthesis paragraph for this analyst block.

THEME: {req.theme_name}
ANALYST: {req.block_title}
TASK: {task_instruction}

RESEARCH PROFILE:
Domain: {req.profile.domain} | Focus: {req.profile.focus} | Population: {req.profile.population}

EVIDENCE (focused on columns: {', '.join(focus_cols) or 'all'}):
{''.join(lit_lines) or '(no literature data)'}
{(''.join(sys_lines)) if sys_lines else ''}

Write 3–5 sentences. Reference specific papers or systems where possible.
Respond with JSON: {{"content": "...", "paper_count": {paper_count}, "avg_confidence": {round(avg_conf, 2)}, "is_low_confidence": {str(is_low).lower()}}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or REGEN_SYSTEM_PROMPT,
            input=user_content,
        )
        raw = response.output_text or ''
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        data = json.loads(match.group() if match else raw)
        return RegenerateBlockResponse(
            content=str(data.get('content', '')),
            paper_count=int(data.get('paper_count', paper_count)),
            avg_confidence=float(data.get('avg_confidence', avg_conf)),
            is_low_confidence=bool(data.get('is_low_confidence', is_low)),
        )
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail='AI returned invalid JSON')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Block regeneration error: {str(e)}')
