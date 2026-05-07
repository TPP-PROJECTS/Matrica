import json
import re as _re
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any
from openai import OpenAI
from config import MODEL

router = APIRouter()
client = OpenAI()

# ── Shared request models ──────────────────────────────────────────────────────

class ThemeBlock(BaseModel):
    blockType: str
    content: str

class ThemeSummary(BaseModel):
    name: str
    coverageLabel: str
    blocks: list[ThemeBlock]

class ProfileModel(BaseModel):
    domain: str = ''
    population: str = ''
    focus: str = ''
    method: str = ''
    reviewType: str = ''

class GapInput(BaseModel):
    label: str
    description: str
    type: str = ''

class BaseContext(BaseModel):
    gap_statement: str = ''
    profile: ProfileModel = ProfileModel()
    themes: list[ThemeSummary] = []
    gaps: list[GapInput] = []
    custom_system_prompt: str | None = None

def build_context_text(ctx: BaseContext) -> str:
    theme_text = '\n'.join(
        f"- {t.name} ({t.coverageLabel}): " +
        '; '.join(b.content[:150] for b in t.blocks if b.content)
        for t in ctx.themes
    ) or '(none)'
    gap_text = '\n'.join(
        f"- [{g.type}] {g.label}: {g.description}" for g in ctx.gaps
    ) or '(none selected)'
    return f"""Gap Statement:
{ctx.gap_statement or '(not yet written)'}

Research Profile:
- Domain: {ctx.profile.domain or '(not specified)'}
- Population: {ctx.profile.population or '(not specified)'}
- Focus: {ctx.profile.focus or '(not specified)'}
- Method: {ctx.profile.method or '(not specified)'}
- Review type: {ctx.profile.reviewType or '(not specified)'}

Synthesis Themes:
{theme_text}

Selected Gap Dimensions:
{gap_text}"""

def parse_json(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    raw = _re.sub(r'^```(?:json)?\s*', '', raw)
    raw = _re.sub(r'\s*```$', '', raw)
    return json.loads(raw)


# ── Endpoint 1: generate final topic options ──────────────────────────────────

TOPICS_SYSTEM = """\
You are a senior research methodology expert. A student has completed a structured literature review process:
they have synthesised themes, identified knowledge gaps, and written a gap statement.

Your task: synthesise ALL of this into 3–4 refined, publication-ready FINAL RESEARCH TOPIC options.

These final topics are NOT the student's initial brainstorming ideas. They are the outcome of the research process —
sharper, more specific, and grounded in what the literature actually reveals.

Each topic must:
- Directly address one or more of the identified gaps
- Be scoped appropriately for a publishable paper (not too broad, not too narrow)
- Have a clear rationale explaining why the synthesis points to this topic
- Come with 3 research questions in different formats

Return ONLY raw JSON (no markdown, no code fences):
{
  "topics": [
    {
      "id": "ft1",
      "title": "...",
      "description": "2–3 sentence elaboration of the topic scope and focus",
      "rationale": "1–2 sentences explaining how this topic emerges from the synthesis and gaps",
      "keyThemes": ["theme name 1", "theme name 2"],
      "researchQuestions": [
        {
          "format": "pico",
          "label": "PICO / Evidence Synthesis",
          "text": "...",
          "recommended": true
        },
        {
          "format": "predictive",
          "label": "Predictive / Explanatory",
          "text": "...",
          "recommended": false
        },
        {
          "format": "phenomenological",
          "label": "Qualitative / Interpretive",
          "text": "...",
          "recommended": false
        }
      ]
    }
  ],
  "study_designs": [
    {
      "id": "sd1",
      "name": "Systematic Review",
      "recommended": true,
      "hint": "Best for synthesising existing evidence"
    }
  ]
}

Rules:
- Topics must be SPECIFIC to the student's domain and gap statement — never generic.
- The recommended RQ format must match what's methodologically strongest for each topic.
- The recommended study design must match the research context and gap type.
- Do not return markdown. Return only raw JSON.
"""

@router.post("/final-question/generate-topics")
def generate_topics(ctx: BaseContext):
    user_msg = build_context_text(ctx) + "\n\nGenerate 3–4 refined final research topic options with research questions."
    response = client.responses.create(
        model=MODEL,
        input=[
            {"role": "system", "content": ctx.custom_system_prompt or TOPICS_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    )
    return parse_json(response.output_text)


# ── Endpoint 2: generate paper structure ─────────────────────────────────────

class TopicDetail(BaseModel):
    id: str
    title: str
    description: str
    rationale: str = ''
    keyThemes: list[str] = []

class StructureRequest(BaseContext):
    topic: TopicDetail
    study_design: str = 'Systematic Review'

STRUCTURE_SYSTEM = """\
You are a senior academic research methodology expert. Generate a complete, publication-ready paper structure
for a specific research topic and study design.

CRITICAL requirements:
- Every section name, purpose, and bullet must be SPECIFIC to this exact topic — never generic boilerplate.
- The study design determines the structural framework:
  * Systematic Review → PRISMA framework, GRADE evidence certainty, quality appraisal tools
  * Scoping Review → JBI/Arksey-O'Malley framework, concept mapping, evidence gap mapping
  * Meta-Analysis → PRISMA-MA, pooled effect sizes, heterogeneity (I²), forest plots
  * RCT → CONSORT-AI, allocation concealment, SAP pre-registration, intention-to-treat
  * Cohort Study → STROBE, longitudinal follow-up, exposure-outcome temporality
  * Qualitative → epistemological stance, thematic/IPA/grounded theory, transferability
  * Mixed Methods → convergent/sequential design, integration rationale
- Include the research question explicitly as a bullet in the Introduction section.
- 5–7 sections total, 5–7 substantive bullets each.
- Section names should reflect the topic content, not just "Introduction" / "Methods".

Return ONLY raw JSON (no markdown, no code fences):
{
  "sections": [
    {
      "number": 1,
      "name": "<topic-specific section name>",
      "purpose": "<one sentence stating what this section achieves>",
      "bullets": ["<specific bullet 1>", "<specific bullet 2>", ...]
    }
  ]
}
"""

@router.post("/final-question/generate-structure")
def generate_structure(req: StructureRequest):
    context = build_context_text(req)
    user_msg = f"""{context}

Selected Final Topic:
- Title: {req.topic.title}
- Description: {req.topic.description}
- Rationale: {req.topic.rationale}
- Key Themes: {', '.join(req.topic.keyThemes) or '(none)'}

Study Design: {req.study_design}

Generate a complete, academically rigorous paper structure for this topic using the {req.study_design} framework.
Every bullet point must be specific to "{req.topic.title}" — not generic."""

    response = client.responses.create(
        model=MODEL,
        input=[
            {"role": "system", "content": req.custom_system_prompt or STRUCTURE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    )
    return parse_json(response.output_text)


# ── Legacy endpoint (kept for backward compatibility) ─────────────────────────
@router.post("/final-question/generate")
def generate_final_question_legacy(ctx: BaseContext):
    return generate_topics(ctx)
