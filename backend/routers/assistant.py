import os
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config import MODEL

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
    block_type: str
    title: str
    content_preview: str

class ThemeMemory(BaseModel):
    name: str
    coverage: str
    paper_count: int
    blocks: list[ThemeBlock] = []

class GapMemory(BaseModel):
    label: str
    type: str

class PaperMemory(BaseModel):
    title: str
    authors: str
    year: int
    status: str

class SearchResultMemory(BaseModel):
    title: str
    authors: str
    year: int
    relevance: int = 0
    in_review: bool = False
    status: str | None = None

class SystemMemory(BaseModel):
    name: str
    selected: bool = False
    category: str = ''

class ResearchContext(BaseModel):
    current_step: int = 1
    profile: ProfileMemory = ProfileMemory()
    all_systems: list[SystemMemory] = []
    selected_systems: list[str] = []
    selected_topics: list[str] = []
    all_topics: list[str] = []
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
    all_rqs: list[str] = []
    final_topic_title: str | None = None
    all_final_topics: list[str] = []
    study_design: str | None = None
    all_study_designs: list[str] = []
    paper_structure_sections: list[str] = []


class AssistantMessageInput(BaseModel):
    role: str
    content: str


class AssistantRequest(BaseModel):
    messages: list[AssistantMessageInput]
    new_message: str
    research_context: ResearchContext = ResearchContext()


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

ACTIONS_SPEC = """
## AVAILABLE ACTIONS
You may include any of the following in the "actions" array when the user asks you to make changes.
Always confirm what you will do in your reply, then include the action.

### Profile & Session
- UPDATE_PROFILE: Update one profile field
  payload: { "field": "domain"|"population"|"focus"|"method"|"reviewType", "value": "string" }
  label: e.g. "Update domain"  detail: e.g. "→ AI in clinical settings"

- SET_SESSION_TITLE: Rename this research session
  payload: { "title": "string" }

### Navigation
- NAVIGATE_TO_STEP: Jump to a workflow step
  payload: { "step": 1-8 }
  label: e.g. "Go to Step 3 · Explore & Search"

### Step 2 — Systems
- SELECT_SYSTEM: Select or deselect a system by name
  payload: { "name": "exact system name", "selected": true|false }

### Step 3 — Topics
- SELECT_TOPIC: Select or deselect a topic by title
  payload: { "title": "exact topic title", "selected": true|false }

### Step 4 — Papers
- ADD_PAPER_TO_REVIEW: Add a paper to the review list
  payload: { "title": "exact paper title", "status": "included"|"maybe" }

- REMOVE_PAPER_FROM_REVIEW: Remove a paper from the review list
  payload: { "title": "exact paper title" }

- UPDATE_PAPER_STATUS: Change a paper's review status
  payload: { "title": "exact paper title", "status": "included"|"maybe"|"saved" }

### Step 5 — Matrix
- SET_LIT_MATRIX_COLUMNS: Replace all literature matrix column names
  payload: { "columns": ["col1", "col2", ...] }

- SET_SYS_MATRIX_COLUMNS: Replace all system matrix column names
  payload: { "columns": ["col1", "col2", ...] }

### Step 6 — Synthesis
- UPDATE_SYNTHESIS_BLOCK: Rewrite a synthesis block's content
  payload: { "theme_name": "exact theme name", "block_title": "exact block title", "content": "new full content" }

### Step 7 — Gaps & RQ
- UPDATE_GAP_STATEMENT: Rewrite the gap statement
  payload: { "text": "new gap statement text" }

- SELECT_GAP: Select or deselect a gap dimension
  payload: { "label": "exact gap label", "selected": true|false }

- SELECT_RQ: Set the active research question by its text
  payload: { "text": "exact RQ text" }

### Step 8 — Final
- SELECT_FINAL_TOPIC: Choose a final research topic
  payload: { "title": "exact topic title" }

- SELECT_STUDY_DESIGN: Choose a study design
  payload: { "name": "exact design name" }

### Prompts
- SET_CUSTOM_PROMPT: Override the AI prompt for a generation step
  Valid prompt_key values: topics-generate, queries-generate, synthesis-generate,
  synthesis-block, gaps-generate, final-topics, final-structure,
  matrix-lit-columns, matrix-sys-columns, matrix-lit-autofill, matrix-sys-autofill
  payload: { "prompt_key": "key", "custom_prompt": "new prompt text" }
  label: e.g. "Override prompt: topics-generate"
"""

def build_system_prompt(ctx: ResearchContext) -> str:
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
            lines.append(f'{mark} {s.name} [{s.category}]')
        sections.append('\n'.join(lines))
    elif ctx.selected_systems:
        sections.append('## Selected Systems\n' + '\n'.join(f'- {s}' for s in ctx.selected_systems))

    if ctx.all_topics:
        lines = [f'## Topics ({len(ctx.selected_topics)} selected of {len(ctx.all_topics)})']
        for t in ctx.all_topics:
            mark = '✓' if t in ctx.selected_topics else '○'
            lines.append(f'{mark} {t}')
        sections.append('\n'.join(lines))

    if ctx.total_queries > 0:
        sections.append(f'## Queries\n- {ctx.total_queries} search queries generated')

    if ctx.search_results:
        not_in_review = [r for r in ctx.search_results if not r.in_review]
        in_review     = [r for r in ctx.search_results if r.in_review]
        lines = [f'## Search Results Pool ({len(ctx.search_results)} papers, use exact titles for ADD_PAPER_TO_REVIEW)']
        # Show papers not yet in review list first (these are the ones that can be added)
        if not_in_review:
            lines.append('### Available to add:')
            for r in not_in_review[:40]:
                lines.append(f'  "{r.title}" — {r.authors} ({r.year}) [relevance:{r.relevance}]')
        if in_review:
            lines.append(f'### Already in review list: {len(in_review)} papers')
        sections.append('\n'.join(lines))

    if ctx.review_papers:
        included = [p for p in ctx.review_papers if p.status == 'included']
        maybe    = [p for p in ctx.review_papers if p.status == 'maybe']
        lines = [f'## Review List ({len(ctx.review_papers)} papers)']
        for paper in included[:15]:
            lines.append(f'[included] {paper.title} — {paper.authors} ({paper.year})')
        for paper in maybe[:10]:
            lines.append(f'[maybe] {paper.title} — {paper.authors} ({paper.year})')
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
            lines.append(f'\n### {theme.name} [{theme.coverage}, {theme.paper_count} papers]')
            for block in theme.blocks:
                preview = block.content_preview[:120] + ('…' if len(block.content_preview) > 120 else '')
                lines.append(f'  [{block.block_type}] {block.title}: {preview}')
        sections.append('\n'.join(lines))

    if ctx.all_gaps:
        lines = [f'## Gap Dimensions ({len(ctx.selected_gaps)} selected)']
        for g in ctx.all_gaps:
            mark = '✓' if any(sg.label == g.label for sg in ctx.selected_gaps) else '○'
            lines.append(f'{mark} {g.label} ({g.type})')
        sections.append('\n'.join(lines))

    if ctx.gap_statement:
        sections.append(f'## Gap Statement\n{ctx.gap_statement}')

    if ctx.all_rqs:
        lines = ['## Research Questions']
        for rq in ctx.all_rqs:
            mark = '✓' if rq == ctx.selected_rq else '○'
            lines.append(f'{mark} {rq}')
        sections.append('\n'.join(lines))

    if ctx.all_final_topics:
        lines = ['## Final Topic Options']
        for t in ctx.all_final_topics:
            mark = '✓' if t == ctx.final_topic_title else '○'
            lines.append(f'{mark} {t}')
        sections.append('\n'.join(lines))

    if ctx.all_study_designs:
        lines = ['## Study Designs']
        for d in ctx.all_study_designs:
            mark = '✓' if d == ctx.study_design else '○'
            lines.append(f'{mark} {d}')
        sections.append('\n'.join(lines))

    if ctx.paper_structure_sections:
        sections.append('## Paper Structure\n' + '\n'.join(f'- {s}' for s in ctx.paper_structure_sections))

    memory_block = '\n\n'.join(sections) if sections else 'No research data collected yet.'

    return f"""You are an intelligent Research Assistant embedded in a systematic review tool.
The student is on Step {step} of 8: {STEP_LABELS.get(step, f'Step {step}')}.

===== RESEARCH MEMORY =====
{memory_block}
===== END MEMORY =====

{ACTIONS_SPEC}

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
- Use exact names/titles as they appear in RESEARCH MEMORY when referencing items
- Tell the user what you're doing in "reply", then let the action card handle execution
- You can batch multiple related actions in one response
- For long text rewrites (gap statement, synthesis blocks), include the full new text"""


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post('/chat/assistant', response_model=AssistantResponse)
async def assistant_chat(req: AssistantRequest):
    system_prompt = build_system_prompt(req.research_context)

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

    # Strip markdown code fences if present
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[-1]
        if raw.endswith('```'):
            raw = raw.rsplit('```', 1)[0]
    raw = raw.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
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
