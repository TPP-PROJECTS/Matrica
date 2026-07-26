import json
import re as _re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from openai import OpenAI
from config import MODEL
from routers.study_design_catalog import STUDY_DESIGN_CATALOG, CATALOG_BY_ID

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
  ]
}

Rules:
- Topics must be SPECIFIC to the student's domain and gap statement — never generic.
- The recommended RQ format must match what's methodologically strongest for each topic.
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


# ── Endpoint 2: study design catalog (fixed enum) ─────────────────────────────

@router.get("/final-question/study-designs")
def list_study_designs():
    """Return the full fixed catalog of study designs with their frameworks."""
    return {
        "designs": [
            {
                "id": d["id"],
                "name": d["name"],
                "category": d["category"],
                "guideline": d["guideline"],
                "hint": d["hint"],
                "sections": [s["name"] for s in d["sections"]],
            }
            for d in STUDY_DESIGN_CATALOG
        ]
    }


# ── Endpoint 3: match topic → study design (LLM only selects, never invents) ──

MATCH_SYSTEM = """\
You are a senior research methodology consultant. You are given a research topic and a FIXED catalog
of study designs. Your only task is to SELECT — from the catalog and nothing else — the designs that
best fit the topic.

Selection logic:
- What kind of knowledge does the topic seek (synthesis of evidence? causal effect? experience?
  prevalence? measurement? artifact building?) — match it to the design whose purpose fits.
- Respect feasibility for a student research project derived from a literature review.
- Prefer the most methodologically defensible option, not the most ambitious one.

Return ONLY raw JSON (no markdown):
{
  "matches": [
    {"id": "<catalog id>", "reason": "<one sentence: why this design fits this topic>"},
    {"id": "<catalog id>", "reason": "..."},
    {"id": "<catalog id>", "reason": "..."}
  ]
}
Rules:
- Exactly 3 matches, ranked best-first.
- "id" MUST be one of the catalog ids given. Never invent ids or names.
"""

class MatchRequest(BaseContext):
    topic_title: str
    topic_description: str = ''
    topic_rationale: str = ''

@router.post("/final-question/match-design")
def match_design(req: MatchRequest):
    catalog_text = '\n'.join(
        f"- {d['id']}: {d['name']} [{d['category']}, {d['guideline']}] — {d['hint']}"
        for d in STUDY_DESIGN_CATALOG
    )
    user_msg = f"""{build_context_text(req)}

Research Topic to match:
- Title: {req.topic_title}
- Description: {req.topic_description}
- Rationale: {req.topic_rationale}

STUDY DESIGN CATALOG (choose ONLY from these ids):
{catalog_text}

Select the 3 best-fitting study designs for this topic, ranked best-first."""

    response = client.responses.create(
        model=MODEL,
        input=[
            {"role": "system", "content": req.custom_system_prompt or MATCH_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    )
    data = parse_json(response.output_text)
    # keep only valid catalog ids, preserving rank order
    matches = [
        {"id": m["id"], "reason": m.get("reason", "")}
        for m in data.get("matches", [])
        if m.get("id") in CATALOG_BY_ID
    ][:3]
    if not matches:
        raise HTTPException(
            status_code=502,
            detail="AI did not return a valid study design from the fixed catalog",
        )
    return {"matches": matches}


# ── Endpoint 4: generate paper structure (fixed framework, LLM fills outline) ─

class TopicDetail(BaseModel):
    id: str
    title: str
    description: str
    rationale: str = ''
    keyThemes: list[str] = []

class StructureRequest(BaseContext):
    topic: TopicDetail
    study_design: str = ''                    # display name for audit/display only
    study_design_id: str                      # fixed-catalog id; no implicit default

STRUCTURE_SYSTEM = """\
You are a senior academic who has published extensively in this domain and now designs the working
outline of a new article. You are given a research topic and the ANCHOR sections that the reporting
guideline requires (Introduction, Methods, … Conclusions). Your output is the COMPLETE list of
top-level sections of the future article:

1. Include EVERY anchor section, with its exact given name, in the given relative order.
2. INSERT additional top-level content sections where a real published article on this topic would
   have them — these carry LLM-generated, topic-specific printed titles. Typical insertions:
   * a Background / Related Work / conceptual-framing section right after the Introduction, titled
     with the topic's own constructs (e.g. "AI-Based Medication Alerts and the Problem of Override"),
   * additional thematic content sections where the design reports rich material (e.g. separate
     top-level chapters for major result domains, a taxonomy/framework section in reviews),
   * a standalone Implications / Recommendations section before the Conclusions when conventional.
   Do NOT invent bureaucratic filler sections — every added section must be a heading a reader
   would actually see printed in the journal.
3. A typical article has 7–10 top-level sections in total. Mark each section with
   "origin": "framework" (anchor) or "origin": "ai" (your insertion).

For EVERY section (anchor or inserted) produce:
- "purpose": one sentence stating what this section achieves FOR THIS SPECIFIC TOPIC.
- "subsections": 2–5 subsections, each with:
  * "title": the actual heading as it would be printed in the article. Substantive and
    topic-specific, never a placeholder:
      - Introduction subsections walk background → problem → gap → aim, but titled with the
        topic's own constructs (e.g. "Alert fatigue as an emerging patient-safety threat in ICUs",
        not "Background").
      - Methods subsections name the concrete procedures/instruments/analyses
        (e.g. "Semi-structured interviews with ICU nursing staff", "Reflexive thematic analysis").
      - Results/Findings subsections state the expected findings or themes as declarative headings,
        the way published papers title their result themes.
      - Discussion subsections carry the actual arguments (comparison with prior work, mechanisms,
        implications for design/practice/policy, limitations).
  * "content": 3–5 sentences of concrete writing instructions for that subsection: which claims to
    make, which constructs/variables/instruments/analyses to cover, what evidence or literature to
    marshal, and which tables/figures belong here (e.g. "Table 1: participant characteristics",
    "PRISMA flow diagram as Figure 1").

Quality bar: reading ONLY the subsection titles top-to-bottom must feel like the table of contents
of a real published article in this field — a coherent argument, not generic scaffolding.

Also:
- The research question must appear verbatim inside the content of the aim/objectives subsection
  of the Introduction.
- Use the guideline's own vocabulary (e.g. PRISMA flow diagram, CONSORT participant flow,
  COREQ reflexivity, GRADE certainty).

Return ONLY raw JSON (no markdown, no code fences):
{
  "sections": [
    {
      "number": 1,
      "name": "<anchor name verbatim, or your inserted printed title>",
      "origin": "framework" | "ai",
      "purpose": "<one sentence>",
      "subsections": [
        {"title": "<printed heading>", "content": "<3-5 sentence writing instructions>"}
      ]
    }
  ]
}
Every anchor section must appear with its exact given name and in the given relative order.
"""

@router.post("/final-question/generate-structure")
def generate_structure(req: StructureRequest):
    design = CATALOG_BY_ID.get(req.study_design_id)
    if design is None:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown study design id: {req.study_design_id}",
        )

    framework_text = '\n'.join(
        f"{i + 1}. {s['name']} — expected content: {s['note']}"
        for i, s in enumerate(design["sections"])
    )

    context = build_context_text(req)
    user_msg = f"""{context}

Selected Final Topic:
- Title: {req.topic.title}
- Description: {req.topic.description}
- Rationale: {req.topic.rationale}
- Key Themes: {', '.join(req.topic.keyThemes) or '(none)'}

Study Design: {design['name']}
Reporting Guideline: {design['guideline']}

ANCHOR SECTIONS required by the guideline (keep these names verbatim, in this order):
{framework_text}

Produce the COMPLETE top-level section list of the future article: all anchors PLUS the additional
topic-specific content sections a real published paper would have (7–10 sections total), each with
purpose and real-paper subsections. Everything must be specific to "{req.topic.title}" — not generic."""

    response = client.responses.create(
        model=MODEL,
        input=[
            {"role": "system", "content": req.custom_system_prompt or STRUCTURE_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
    )
    data = parse_json(response.output_text)

    # Merge: keep the LLM's full section list (anchors + inserted content sections),
    # but guarantee every guideline anchor is present, named verbatim, in relative order.
    anchor_names = [s["name"].strip().lower() for s in design["sections"]]

    def clean_subsections(raw) -> list[dict]:
        return [
            {
                "title": str(sub.get("title", "")).strip(),
                "content": str(sub.get("content", "")).strip(),
            }
            for sub in (raw or [])
            if str(sub.get("title", "")).strip()
        ]

    sections = []
    for s in data.get("sections", []):
        name = str(s.get("name", "")).strip()
        if not name:
            continue
        is_anchor = name.lower() in anchor_names
        sections.append({
            "name": name,
            "origin": "framework" if is_anchor else "ai",
            "purpose": str(s.get("purpose", "")).strip(),
            "bullets": s.get("bullets", []),  # legacy fallback if the model returns flat bullets
            "subsections": clean_subsections(s.get("subsections")),
        })

    # Insert any anchor the model dropped, right after the last preceding anchor present
    present = {s["name"].lower() for s in sections}
    for idx, fs in enumerate(design["sections"]):
        if fs["name"].lower() in present:
            continue
        insert_pos = 0
        for pos, s in enumerate(sections):
            if s["origin"] == "framework" and anchor_names.index(s["name"].lower()) < idx:
                insert_pos = pos + 1
        sections.insert(insert_pos, {
            "name": fs["name"], "origin": "framework",
            "purpose": fs["note"], "bullets": [], "subsections": [],
        })
        present.add(fs["name"].lower())

    for i, s in enumerate(sections):
        s["number"] = i + 1

    return {
        "sections": sections,
        "design": {"id": design["id"], "name": design["name"], "guideline": design["guideline"]},
    }


# ── Legacy endpoint (kept for backward compatibility) ─────────────────────────
@router.post("/final-question/generate")
def generate_final_question_legacy(ctx: BaseContext):
    return generate_topics(ctx)
