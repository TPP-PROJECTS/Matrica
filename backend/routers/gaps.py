from routers.json_utils import extract_json
import json
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from config import response_options
from routers.rob_catalog import RobSummaryInfo, TOOLS_BY_ID, concerning_domains

router = APIRouter()
client = AsyncOpenAI()


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
    focus_columns: list[str] = []
    focus_system_columns: list[str] = []
    profile: ProfileInfo = ProfileInfo()
    topics: list[TopicInfo] = []
    themes: list[ThemeInfo] = []
    rob_summaries: list[RobSummaryInfo] = []
    custom_system_prompt: str | None = None


class GenerateGapResponse(BaseModel):
    statement: str


GAP_SYSTEM_PROMPT = """You are a senior systematic review methodologist writing the research gap section of a publishable paper.

Your job is NOT to report matrix coverage, confidence scores, or generic "AI found a gap" claims. Your job is to infer a real scholarly gap by comparing:
1. What the researcher wants to discuss or investigate (profile + selected topics)
2. What the reviewed papers actually report (literature matrix)
3. What remains absent, thin, contradictory, methodologically weak, or disconnected from the intended research focus. When a risk-of-bias appraisal is supplied, it — not the study-design labels in the matrix — is the evidence for any claim about methodological weakness.
4. Where relevant, what the system landscape shows or fails to show (system matrix)

Definition of a valid paper-level gap:
- A question, population, setting, mechanism, comparison, outcome, method, or implementation issue that is important to the research focus but is not adequately answered by the reviewed papers.
- It must be grounded in specific evidence from the matrix: name papers or groups of papers and describe what they did find before stating what they did not resolve.
- Low confidence, missing cells, or inferred values are NOT themselves the gap. They are only signals that may help identify a deeper substantive gap.

Write a cohesive 3–4 paragraph gap analysis suitable for an introduction or discussion section:
1. Paragraph 1: Establish the state of knowledge. Say what the papers collectively show, using concrete findings from named papers.
2. Paragraph 2: Identify the main unresolved issue/tension. Explain the mismatch between the researcher's intended focus and what the literature actually covers.
3. Paragraph 3: Deepen the gap with methodological, population, outcome, implementation, or system-comparison limitations. Reference specific papers/systems where possible.
4. Final paragraph: State the research opportunity in precise terms: what a new study/review should examine, for whom, and why it matters.

Rules:
- Be specific, analytical, and evidence-led.
- Do not invent studies, results, populations, systems, or claims.
- Do not write "there is a gap because confidence is low"; translate data-quality issues into substantive research limitations only when justified.
- Prefer paper-level reasoning over template phrases.
- Use academic prose, third person, suitable for a journal manuscript.
- Each paragraph should be 3–5 sentences.
- If evidence is sparse, say exactly what is sparse and why that limits interpretation.
- When focus schema axes are provided, make those axes the centre of the analysis. Cross-compare papers/systems on that same axis and infer what the field still does not know in that direction. Do not merely explain what the schema axis means.
- A poor answer explains the schema axis (for example, "outcome indicators are important"). A good answer compares the actual extracted values under that axis across papers/systems, then states the gap created by their inconsistency, absence, narrowness, or lack of connection to the review focus.

Respond with valid JSON only — no markdown: {"statement": "paragraph1\\n\\nparagraph2\\n\\n..."}
"""


def _summarise_lit(rows: list[MatrixRowInfo], cols: list[str]) -> str:
    data_cols = [c for c in cols if c not in ('#', 'Title', 'Authors', 'Year')]
    if not rows:
        return '(no literature data)'
    lines = []
    for r in rows:
        filled = {}
        for c in data_cols:
            cell = r.cells.get(c)
            if cell and cell.value:
                filled[c] = cell.value[:180]
        missing = [c for c in data_cols if not r.cells.get(c) or not r.cells[c].value]
        summary = '; '.join(f'{k}: {v}' for k, v in list(filled.items())[:8])
        lines.append(
            f'• [{r.year or "?"}] {r.title} — {summary or "(no extracted findings)"}'
            + (f' | Not addressed in matrix: {", ".join(missing[:6])}' if missing else '')
        )
    return '\n'.join(lines)


def _summarise_sys(rows: list[SystemRowInfo], cols: list[str]) -> str:
    if not rows:
        return '(no system review data)'
    lines = []
    for r in rows:
        filled = {}
        for c in cols:
            cell = r.cells.get(c)
            if cell and cell.value:
                filled[c] = cell.value[:160]
        missing = [c for c in cols if not r.cells.get(c) or not r.cells[c].value]
        summary = '; '.join(f'{k}: {v}' for k, v in list(filled.items())[:6])
        lines.append(
            f'• {r.name} ({r.vendor or r.category}) — {summary or "(no data)"}'
            + (f' | Not assessed: {", ".join(missing[:5])}' if missing else '')
        )
    return '\n'.join(lines)


def _summarise_lit_axes(rows: list[MatrixRowInfo], focus_cols: list[str]) -> str:
    if not focus_cols:
        return '(no focused literature schema axis selected)'
    if not rows:
        return '(no literature data)'
    sections = []
    for col in focus_cols:
        lines = [f'AXIS: {col}']
        values = []
        missing = []
        for r in rows:
            cell = r.cells.get(col)
            if cell and cell.value:
                value = cell.value.strip().replace('\n', ' ')
                values.append(f'  - [{r.year or "?"}] {r.title}: {value[:260]}')
            else:
                missing.append(r.title)
        lines.extend(values or ['  - No papers report a substantive finding on this axis.'])
        if missing:
            lines.append(f'  - Papers not addressing this axis: {", ".join(missing[:10])}')
        sections.append('\n'.join(lines))
    return '\n\n'.join(sections)


def _summarise_sys_axes(rows: list[SystemRowInfo], focus_cols: list[str]) -> str:
    if not focus_cols:
        return '(no focused system schema axis selected)'
    if not rows:
        return '(no system review data)'
    sections = []
    for col in focus_cols:
        lines = [f'AXIS: {col}']
        values = []
        missing = []
        for r in rows:
            cell = r.cells.get(col)
            if cell and cell.value:
                value = cell.value.strip().replace('\n', ' ')
                values.append(f'  - {r.name} ({r.vendor or r.category}): {value[:240]}')
            else:
                missing.append(r.name)
        lines.extend(values or ['  - No systems are substantively assessed on this axis.'])
        if missing:
            lines.append(f'  - Systems not assessed on this axis: {", ".join(missing[:10])}')
        sections.append('\n'.join(lines))
    return '\n\n'.join(sections)


def _summarise_rob(summaries: list[RobSummaryInfo]) -> str:
    """Render the quality appraisal as raw material for a gap argument.

    The gap step has always been asked to identify what is "methodologically
    weak", but until the appraisal was passed in it could only guess at that
    from whatever the extraction matrix happened to contain — typically a
    "Study Design" column saying "cohort". Naming the domains that actually
    failed is what lets the analysis say *what* a future study would have to do
    differently, which is the difference between a gap a reviewer accepts and
    one they dismiss as a restatement of the study-design list.
    """
    if not summaries:
        return ""

    tool_id = next((s.tool for s in summaries if s.tool), "")
    tool = TOOLS_BY_ID.get(tool_id)
    tool_name = tool["name"] if tool else "an appraisal instrument"
    labels = {j["value"]: j["label"] for j in tool["judgements"]} if tool else {}

    lines = []
    for summary in summaries:
        concerns = concerning_domains(summary)
        rating = labels.get(summary.overall, summary.overall) or "not rated"
        line = f"• {summary.title} — overall {rating}"
        if concerns:
            line += f"; problems in: {', '.join(concerns)}"
        if not summary.confirmed:
            line += " [AI draft, not confirmed by the reviewer]"
        lines.append(line)

    unconfirmed = sum(1 for s in summaries if not s.confirmed)
    caveat = (
        f"\n{unconfirmed} of {len(summaries)} appraisals are unconfirmed AI drafts. Where the "
        "argument rests on those, present the methodological limitation as provisional."
        if unconfirmed else ""
    )

    return f"""

RISK-OF-BIAS APPRAISAL ({tool_name}):
{chr(10).join(lines)}

Use these ratings directly rather than inferring study quality from design labels in the matrix.
A domain that repeatedly fails across studies is one of the strongest gaps available: it means the
question has been asked but not yet answered credibly, and it tells the reader exactly what a new
study would have to do differently. Where a domain is rated "no information" across many studies,
the gap is in reporting rather than in conduct — say so, and do not claim the studies were poorly
conducted on that basis.{caveat}
"""


@router.post('/gaps/generate', response_model=GenerateGapResponse)
async def generate_gap_statement(req: GenerateGapRequest):
    lit_summary = _summarise_lit(req.matrix_rows, req.columns)
    rob_summary = _summarise_rob(req.rob_summaries)
    sys_summary = _summarise_sys(req.system_rows, req.system_columns)
    focused_lit = _summarise_lit_axes(req.matrix_rows, req.focus_columns)
    focused_sys = _summarise_sys_axes(req.system_rows, req.focus_system_columns)
    topic_context = '\n'.join(
        f'• [{t.type or "topic"}] {t.title}'
        + (f' — {t.description}' if t.description else '')
        for t in req.topics
    ) or '(no selected topics provided)'

    theme_context = ''
    if req.themes:
        theme_context = '\nSYNTHESIS THEMES (from prior step):\n' + '\n'.join(
            f'• {t.name} ({t.coverageLabel})'
            + ''.join(
                f'\n  - {str(b.get("title") or b.get("blockType") or "block")}: {str(b.get("content", ""))[:240]}'
                for b in t.blocks
                if isinstance(b, dict) and b.get("content")
            )
            for t in req.themes
        )

    custom_instruction = ''
    if req.custom_system_prompt:
        custom_instruction = f"""

ADDITIONAL USER INSTRUCTIONS:
{req.custom_system_prompt}
"""

    focused_mode = bool(req.focus_columns or req.focus_system_columns)

    if focused_mode:
        user_content = f"""FOCUSED AXIS CROSS-COMPARISON MODE.

Write a publishable gap analysis by cross-comparing the selected schema direction across all papers/systems.

RESEARCH PROFILE:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}
Method: {req.profile.method}
Review type: {req.profile.reviewType}

SELECTED TOPICS / INTENDED DISCUSSION TARGET:
{topic_context}
{theme_context}
{custom_instruction}

SELECTED SCHEMA DIRECTION:
Literature axis: {", ".join(req.focus_columns) or "none"}
System axis: {", ".join(req.focus_system_columns) or "none"}

CROSS-PAPER VALUES UNDER THE SELECTED DIRECTION:
{focused_lit}

CROSS-SYSTEM VALUES UNDER THE SELECTED DIRECTION:
{focused_sys}
{rob_summary}
TASK:
Compare the actual values above across papers/systems. Do not restate them row by row. Synthesise them into patterns:
1. What kinds of findings/outcomes/capabilities are being reported under this same direction?
2. Where do papers/systems converge?
3. Where do they diverge, use different measures, stay too generic, or fail to connect to the review focus?
4. What specific unanswered research gap emerges from that cross-comparison?

STRICT OUTPUT REQUIREMENTS:
- Do not explain what the schema direction means.
- Do not write a table-like inventory.
- Do not say the gap is simply missing rows.
- The first paragraph must compare at least two concrete papers/systems if available.
- The second paragraph must identify the cross-paper/system pattern or inconsistency.
- The final paragraph must state the gap as an unanswered research problem in this direction.
- If the selected direction is about results/outcomes/indicators/measures/evaluation, focus on whether the reviewed work uses comparable outcomes, meaningful endpoints, implementation outcomes, longitudinal outcomes, or system-linked validation.

Write 2–3 paragraphs. Respond with JSON: {{"statement": "para1\\n\\npara2\\n\\npara3"}}
"""
    else:
        user_content = f"""Write a publishable, evidence-led gap analysis for this systematic review.

RESEARCH PROFILE:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}
Method: {req.profile.method}
Review type: {req.profile.reviewType}

SELECTED TOPICS / INTENDED DISCUSSION TARGET:
{topic_context}
{theme_context}

LITERATURE MATRIX ({len(req.matrix_rows)} papers):
{lit_summary}

SYSTEM REVIEW ({len(req.system_rows)} systems):
{sys_summary}
{rob_summary}
{custom_instruction}

Analyse the mismatch between the intended discussion target and the actual evidence. Start from what the papers actually found, then identify what remains unresolved, under-explained, methodologically weak, or absent.

Do not simply list missing matrix cells or confidence scores. Use those only as clues for substantive gaps such as missing populations, untested interventions, absent implementation evidence, weak outcome measurement, lack of longitudinal evidence, lack of direct comparison, or lack of system validation.

Write 3–4 paragraphs as a gap statement. Integrate evidence from BOTH sources when system data is relevant; otherwise explain that the paper evidence is the primary basis.
Respond with JSON: {{"statement": "para1\\n\\npara2\\n\\npara3"}}
"""

    try:
        response = await client.responses.create(
            **response_options(),
            instructions=GAP_SYSTEM_PROMPT,
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
