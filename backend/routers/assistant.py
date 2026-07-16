import os
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config import MODEL
from routers.json_utils import extract_json as _extract_json

load_dotenv()

router = APIRouter()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ── Research memory models ────────────────────────────────────────────────────

class ProfileMemory(BaseModel):
    domain: str = ''
    population: str = ''
    focus: str = ''
    method: str = ''
    reviewType: str = ''

class ThemeBlock(BaseModel):
    id: str = ''
    block_type: str
    title: str
    content_preview: str

class ThemeMemory(BaseModel):
    id: str = ''
    name: str
    coverage: str
    paper_count: int
    blocks: list[ThemeBlock] = []

class GapMemory(BaseModel):
    id: str = ''
    label: str
    type: str
    selected: bool = False

class PaperMemory(BaseModel):
    id: str = ''
    title: str
    authors: str
    year: int
    status: str

class SearchResultMemory(BaseModel):
    id: str = ''
    title: str
    authors: str
    year: int
    relevance: int = 0
    in_review: bool = False
    status: str | None = None

class SystemMemory(BaseModel):
    id: str = ''
    name: str
    selected: bool = False
    category: str = ''

class TopicMemory(BaseModel):
    id: str = ''
    title: str
    selected: bool = False

class RQMemory(BaseModel):
    id: str = ''
    text: str

class FinalTopicMemory(BaseModel):
    id: str = ''
    title: str

class DesignMemory(BaseModel):
    id: str = ''
    name: str

class ResearchContext(BaseModel):
    current_step: int = 1
    profile: ProfileMemory = ProfileMemory()
    all_systems: list[SystemMemory] = []
    selected_systems: list[str] = []
    selected_topics: list[str] = []
    all_topics: list[TopicMemory] = []
    total_queries: int = 0
    total_results: int = 0
    search_results: list[SearchResultMemory] = []
    review_papers: list[PaperMemory] = []
    lit_matrix_columns: list[str] = []
    sys_matrix_columns: list[str] = []
    themes: list[ThemeMemory] = []
    selected_gaps: list[GapMemory] = []
    all_gaps: list[GapMemory] = []
    gap_statement: str = ''
    selected_rq: str | None = None
    all_rqs: list[RQMemory] = []
    final_topic_title: str | None = None
    all_final_topics: list[FinalTopicMemory] = []
    study_design: str | None = None
    all_study_designs: list[DesignMemory] = []
    paper_structure_sections: list[str] = []


class AssistantMessageInput(BaseModel):
    role: str
    content: str


class AssistantRequest(BaseModel):
    messages: list[AssistantMessageInput]
    new_message: str
    research_context: ResearchContext = ResearchContext()
    orchestration_trace_id: str | None = None
    # Action catalogue supplied by the frontend action registry (single source of
    # truth). When present it replaces the built-in ACTIONS_SPEC so new actions
    # become chatbot-operable without editing this file.
    available_actions: str | None = None


class ActionPayload(BaseModel):
    type: str
    label: str
    detail: str | None = None
    payload: dict


class AssistantResponse(BaseModel):
    reply: str
    actions: list[ActionPayload] = []


# ── System prompt ─────────────────────────────────────────────────────────────

STEP_LABELS = {
    1: 'Chat & Define Topic', 2: 'System Review', 3: 'Explore & Search',
    4: 'Select Paper', 5: 'Matrix', 6: 'Synthesis',
    7: 'Gap & Statement', 8: 'Final Question',
}

# Fallback only. The frontend action registry (lib/actionRegistry) generates the
# real catalogue and sends it as `available_actions`; it is authoritative because
# it is derived from the reducer's own AppAction types. Without it we must not
# invent action names the client cannot dispatch.
ACTIONS_SPEC = """
## AVAILABLE ACTIONS
(none available — this client did not send an action catalogue)
Answer conversationally and return an empty "actions" array.
"""

def build_system_prompt(ctx: ResearchContext, trace_id: str | None = None,
                        actions_spec: str | None = None) -> str:
    step = ctx.current_step
    p = ctx.profile

    sections: list[str] = []

    if any([p.domain, p.population, p.focus, p.method, p.reviewType]):
        lines = ['## Research Profile']
        if p.domain:      lines.append(f'- Domain: {p.domain}')
        if p.population:  lines.append(f'- Population: {p.population}')
        if p.focus:       lines.append(f'- Focus: {p.focus}')
        if p.method:      lines.append(f'- Method: {p.method}')
        if p.reviewType:  lines.append(f'- Review type: {p.reviewType}')
        sections.append('\n'.join(lines))

    if ctx.all_systems:
        lines = [f'## Systems ({len(ctx.selected_systems)} selected of {len(ctx.all_systems)})']
        for s in ctx.all_systems:
            mark = '✓' if s.selected else '○'
            lines.append(f'{mark} [{s.id}] {s.name} [{s.category}]')
        sections.append('\n'.join(lines))
    elif ctx.selected_systems:
        sections.append('## Selected Systems\n' + '\n'.join(f'- {s}' for s in ctx.selected_systems))

    if ctx.all_topics:
        lines = [f'## Topics ({len(ctx.selected_topics)} selected of {len(ctx.all_topics)})']
        for t in ctx.all_topics:
            mark = '✓' if t.selected else '○'
            lines.append(f'{mark} [{t.id}] {t.title}')
        sections.append('\n'.join(lines))

    if ctx.total_queries > 0:
        sections.append(f'## Queries\n- {ctx.total_queries} search queries generated')

    if ctx.search_results:
        not_in_review = [r for r in ctx.search_results if not r.in_review]
        in_review     = [r for r in ctx.search_results if r.in_review]
        lines = [f'## Search Results Pool ({len(ctx.search_results)} papers; use the [id] for paperId)']
        # Show papers not yet in review list first (these are the ones that can be added)
        if not_in_review:
            lines.append('### Available to add:')
            for r in not_in_review[:40]:
                lines.append(f'  [{r.id}] "{r.title}" — {r.authors} ({r.year}) [relevance:{r.relevance}]')
        if in_review:
            lines.append(f'### Already in review list: {len(in_review)} papers')
        sections.append('\n'.join(lines))

    if ctx.review_papers:
        included = [p for p in ctx.review_papers if p.status == 'included']
        maybe    = [p for p in ctx.review_papers if p.status == 'maybe']
        lines = [f'## Review List ({len(ctx.review_papers)} papers)']
        for paper in included[:15]:
            lines.append(f'[included] [{paper.id}] {paper.title} — {paper.authors} ({paper.year})')
        for paper in maybe[:10]:
            lines.append(f'[maybe] [{paper.id}] {paper.title} — {paper.authors} ({paper.year})')
        sections.append('\n'.join(lines))

    if ctx.lit_matrix_columns or ctx.sys_matrix_columns:
        lines = ['## Matrix Columns']
        if ctx.lit_matrix_columns:
            lines.append(f'Literature: {", ".join(ctx.lit_matrix_columns)}')
        if ctx.sys_matrix_columns:
            lines.append(f'Systems: {", ".join(ctx.sys_matrix_columns)}')
        sections.append('\n'.join(lines))

    if ctx.themes:
        lines = [f'## Synthesis Themes ({len(ctx.themes)})']
        for theme in ctx.themes:
            lines.append(f'\n### [{theme.id}] {theme.name} [{theme.coverage}, {theme.paper_count} papers]')
            for block in theme.blocks:
                preview = block.content_preview[:120] + ('…' if len(block.content_preview) > 120 else '')
                lines.append(f'  [{block.id}] ({block.block_type}) {block.title}: {preview}')
        sections.append('\n'.join(lines))

    if ctx.all_gaps:
        lines = [f'## Gap Dimensions ({len(ctx.selected_gaps)} selected)']
        for g in ctx.all_gaps:
            mark = '✓' if g.selected else '○'
            lines.append(f'{mark} [{g.id}] {g.label} ({g.type})')
        sections.append('\n'.join(lines))

    if ctx.gap_statement:
        sections.append(f'## Gap Statement\n{ctx.gap_statement}')

    if ctx.all_rqs:
        lines = ['## Research Questions']
        for rq in ctx.all_rqs:
            mark = '✓' if rq.text == ctx.selected_rq else '○'
            lines.append(f'{mark} [{rq.id}] {rq.text}')
        sections.append('\n'.join(lines))

    if ctx.all_final_topics:
        lines = ['## Final Topic Options']
        for t in ctx.all_final_topics:
            mark = '✓' if t.title == ctx.final_topic_title else '○'
            lines.append(f'{mark} [{t.id}] {t.title}')
        sections.append('\n'.join(lines))

    if ctx.all_study_designs:
        lines = ['## Study Designs']
        for d in ctx.all_study_designs:
            mark = '✓' if d.name == ctx.study_design else '○'
            lines.append(f'{mark} [{d.id}] {d.name}')
        sections.append('\n'.join(lines))

    if ctx.paper_structure_sections:
        sections.append('## Paper Structure\n' + '\n'.join(f'- {s}' for s in ctx.paper_structure_sections))

    memory_block = '\n\n'.join(sections) if sections else 'No research data collected yet.'

    # Prefer the catalogue the frontend sent (its action registry is authoritative);
    # fall back to the built-in spec for older clients.
    actions_block = actions_spec.strip() if actions_spec and actions_spec.strip() else ACTIONS_SPEC

    return f"""You are an intelligent Research Assistant embedded in a systematic review tool.
The student is on Step {step} of 8: {STEP_LABELS.get(step, f'Step {step}')}.

===== RESEARCH MEMORY =====
{memory_block}
===== END MEMORY =====

{actions_block}

## RESPONSE FORMAT
Always respond with valid JSON only — no markdown, no code blocks:
{{
  "reply": "Your conversational reply (friendly, concise, 2-4 sentences)",
  "actions": [
    {{
      "type": "ACTION_TYPE",
      "label": "Human-readable action title",
      "detail": "Optional detail string, e.g. the new value",
      "payload": {{ ...action-specific fields... }}
    }}
  ]
}}

Rules:
- "actions" may be an empty array [] if no changes are needed
- Only include actions when the user clearly requests a change
- Reference items by the [id] shown next to them in RESEARCH MEMORY — never invent an id
- If the item the user means is not in RESEARCH MEMORY, say so instead of guessing an id
- Tell the user what you're doing in "reply", then let the action card handle execution
- You can batch multiple related actions in one response
- For long text rewrites (gap statement, synthesis blocks), include the full new text""" + (
        f"\n\n## Orchestration Trace\ntrace_id: {trace_id}" if trace_id else ""
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post('/chat/assistant', response_model=AssistantResponse)
async def assistant_chat(req: AssistantRequest):
    system_prompt = build_system_prompt(
        req.research_context, req.orchestration_trace_id, req.available_actions,
    )

    input_messages = [
        {'role': msg.role, 'content': msg.content}
        for msg in req.messages
        if msg.role in ('user', 'assistant')
    ]
    input_messages.append({'role': 'user', 'content': req.new_message})

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=system_prompt,
            input=input_messages,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'OpenAI error: {str(e)}')

    raw = (response.output_text or '').strip()
    data = _extract_json(raw)
    if data is None:
        # Model didn't return JSON — treat entire response as plain reply
        return AssistantResponse(reply=raw, actions=[])

    reply = data.get('reply', '')
    raw_actions = data.get('actions', [])

    actions = []
    for a in raw_actions:
        if isinstance(a, dict) and 'type' in a and 'payload' in a:
            actions.append(ActionPayload(
                type=a['type'],
                label=a.get('label', a['type']),
                detail=a.get('detail'),
                payload=a['payload'],
            ))

    return AssistantResponse(reply=reply, actions=actions)
