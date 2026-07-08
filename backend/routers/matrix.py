from routers.json_utils import extract_json
import io
import json
import re
import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from openai import AsyncOpenAI
from config import MODEL
from routers.search import reconstruct_abstract

router = APIRouter()
client = AsyncOpenAI()

SYSTEM_PROMPT = """You are a senior systematic review methodologist who designs data-extraction forms following the Cochrane Handbook, JBI extraction guidance, and Garrard's Matrix Method.

Your task is to propose column headers for a literature review extraction matrix.

Design principles you must follow:
1. Together, the columns must let a reader reconstruct each study at a glance, in this canonical order: study design & methodology → sample and setting → intervention / exposure / phenomenon of interest → measures and instruments → key findings → quality, limitations and gaps.
2. One column = one construct. Never merge two constructs into a single column (no "Design & Sample").
3. Every column must be answerable from a title and abstract alone; do not propose columns that require full-text tables or appendices.
4. Use precise methodological vocabulary ("Study Design", "Sampling Strategy", "Outcome Measures", "Effect Direction", "Theoretical Framework") — never vague labels such as "Details", "Information", "Notes" or "Other".
5. Adapt column choice to the review type: scoping reviews need mapping/characterisation columns (concepts, contexts, evidence types); effectiveness reviews need PICO-aligned columns (intervention, comparator, outcomes, effect estimates); qualitative syntheses need phenomenon, methodology and key-theme columns.
6. At least two columns must be tailored to the reviewer's stated domain, population and focus rather than generic.
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
    exclude_columns: list[str] = []
    custom_system_prompt: str | None = None


class GenerateColumnsResponse(BaseModel):
    columns: list[str]
    descriptions: dict[str, str] = {}


def _parse_columns(data: dict) -> tuple[list[str], dict[str, str]]:
    """Accept either ["Name", ...] or [{"name": ..., "description": ...}, ...]."""
    names: list[str] = []
    descs: dict[str, str] = {}
    for item in data.get("columns", []):
        if isinstance(item, dict):
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            names.append(name)
            desc = str(item.get("description", "")).strip()
            if desc:
                descs[name] = desc
        elif isinstance(item, str) and item.strip():
            names.append(item.strip())
    return names, descs


class SystemInfo(BaseModel):
    name: str
    category: str = ''
    vendor: str = ''
    description: str = ''


class GenerateSystemColumnsRequest(BaseModel):
    systems: list[SystemInfo]
    profile: ProfileInfo
    topics: list[TopicInfo] = []
    exclude_columns: list[str] = []
    custom_system_prompt: str | None = None


def _exclude_note(exclude_columns: list[str]) -> str:
    if not exclude_columns:
        return ''
    listed = '\n'.join(f'- {c}' for c in exclude_columns)
    return (
        "\n\nCOLUMNS ALREADY IN THE MATRIX — do NOT propose any of these again, "
        "and do NOT propose close synonyms or overlapping dimensions. "
        "Suggest only genuinely NEW, complementary columns that add information not already captured:\n"
        f"{listed}"
    )


SYSTEM_REVIEW_PROMPT = """You are a health-informatics evaluation specialist who designs technology comparison frameworks, drawing on health technology assessment (HTA) practice, the NASSS framework, and ISO/IEC 25010 software quality characteristics.

Your task is to propose column headers for a matrix that compares software systems side-by-side in a systematic technology review.

Design principles you must follow:
1. One column = one comparison dimension on which the listed systems genuinely differ; avoid dimensions where every system would have the same answer.
2. Cover the evaluation lifecycle in order: intended use & target users → core functional capabilities → underlying technology or algorithmic approach → evidence base & validation studies → integration & interoperability (standards, EHR/data exchange) → regulatory or certification status → deployment maturity & adoption → known limitations.
   Select the 5–8 dimensions from this lifecycle that matter most for the systems and research focus at hand.
3. Use professional evaluation terminology ("Validation Evidence", "Interoperability Standards", "Regulatory Status", "Deployment Maturity") — never vague labels such as "Details", "Features", "Notes" or "Other".
4. At least one column must be tailored to the reviewer's stated research domain and focus rather than generic.
5. Every column must be fillable from publicly documented knowledge about the system (websites, publications, regulatory databases).
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
{_exclude_note(req.exclude_columns)}

Generate 5–8 comparison dimensions (column names) for evaluating these systems side-by-side.
Choose the dimensions where THESE systems meaningfully differ and that matter most for the stated research focus — e.g. intended use, core capabilities, underlying technology, validation evidence, interoperability, regulatory status, adoption, limitations.
Do NOT include System Name, Vendor, or Category — those are fixed columns.
Order the columns from intended use through to limitations. Keep names short (2–4 words each) and use professional evaluation terminology.
For each column also give a one-sentence description of what it captures and how it is judged; when the column is categorical, list the expected values in the description (e.g. "One of: FDA-cleared, CE-marked, none").

Respond with JSON:
{{"columns": [{{"name": "Column Name", "description": "what it captures / how it is judged; list expected values if categorical"}}, ...]}}
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
        columns, descriptions = _parse_columns(data)
        if not columns:
            raise ValueError("empty columns")
        return GenerateColumnsResponse(columns=columns, descriptions=descriptions)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"System column generation error: {str(e)}")


# ── Up-front schema assessment (Matrix Schema step, before systems/papers exist) ──

class AssessSystemSchemaRequest(BaseModel):
    profile: ProfileInfo
    topics: list[TopicInfo] = []
    exclude_columns: list[str] = []
    custom_system_prompt: str | None = None


class AssessSystemSchemaResponse(BaseModel):
    recommended: bool
    rationale: str
    columns: list[str]
    descriptions: dict[str, str] = {}


SYSTEM_SCHEMA_ASSESS_PROMPT = SYSTEM_REVIEW_PROMPT + """

Before proposing columns, first JUDGE whether a *system/technology comparison matrix* is even
appropriate for this review. It is appropriate only when the research question centres on comparing
software systems, digital tools, apps, platforms, devices or algorithms. It is NOT appropriate for
reviews of clinical interventions, epidemiology, psychosocial phenomena, policy, or education where no
software artefacts are being compared.

Respond with valid JSON only, no markdown:
{"recommended": true/false, "rationale": "<one sentence>", "columns": [{"name": "Col 1", "description": "what it captures; list expected values if categorical"}, ...]}
If recommended is false, return an empty columns array.
"""


@router.post("/matrix/assess-system-schema", response_model=AssessSystemSchemaResponse)
async def assess_system_schema(req: AssessSystemSchemaRequest):
    topic_list = '\n'.join(f'- [{t.type}] {t.title}: {t.description}' for t in req.topics) if req.topics else '(none yet)'

    user_content = f"""Decide whether this systematic review needs a technology/system comparison matrix,
and if so propose its comparison columns.

RESEARCH PROFILE:
Domain: {req.profile.domain}
Population: {req.profile.population}
Focus: {req.profile.focus}
Method: {req.profile.method}
Review type: {req.profile.reviewType}

RESEARCH TOPICS:
{topic_list}
{_exclude_note(req.exclude_columns)}

If a system comparison matrix is warranted, generate 5–8 comparison dimensions (column names), ordered
from intended use through to limitations, using professional evaluation terminology. Do NOT include
System Name, Vendor, or Category — those are fixed columns. For each column give a one-sentence
description of what it captures and how it is judged; when categorical, list the expected values.

Respond with JSON:
{{"recommended": true/false, "rationale": "<one sentence>", "columns": [{{"name": "Column Name", "description": "what it captures; list expected values if categorical"}}, ...]}}
"""

    try:
        response = await client.responses.create(
            model=MODEL,
            instructions=req.custom_system_prompt or SYSTEM_SCHEMA_ASSESS_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or "")
        if data is None:
            raise HTTPException(status_code=500, detail="AI returned invalid JSON")
        recommended = bool(data.get("recommended", False))
        columns, descriptions = _parse_columns(data) if recommended else ([], {})
        return AssessSystemSchemaResponse(
            recommended=recommended,
            rationale=str(data.get("rationale", "")),
            columns=columns,
            descriptions=descriptions,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"System schema assessment error: {str(e)}")


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
{_exclude_note(req.exclude_columns)}

Generate 5–8 extraction column names for capturing key information from these papers.
Follow the canonical extraction order (design → sample/setting → intervention or phenomenon → measures → findings → quality/limitations), adapt the columns to the stated review type, and make at least two columns specific to this domain and focus.
Every column must be answerable from a title and abstract alone.
Do NOT include Title, Authors, or Year — those are fixed columns.
Keep names short (2–4 words each) and use precise methodological terminology.
For each column also give a one-sentence description of what it captures and how it is measured; when the column is categorical, list the expected values in the description (e.g. "One of: RCT, cohort, case-control, qualitative").

Respond with JSON:
{{"columns": [{{"name": "Column Name", "description": "what it captures / how it is measured; list expected values if categorical"}}, ...]}}
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
        columns, descriptions = _parse_columns(data)
        if not columns:
            raise ValueError("empty columns")
        return GenerateColumnsResponse(columns=columns, descriptions=descriptions)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Matrix column generation error: {str(e)}")


# ── Manual paper ingestion (file upload / URL) ────────────────────────────────

class IngestedPaper(BaseModel):
    title: str
    authors: str = ''
    year: int | None = None
    abstract: str = ''
    url: str = ''
    source: str = 'upload'


PAPER_METADATA_PROMPT = """You are a bibliographic metadata extraction specialist.
Given raw text from a research paper (or a web page describing it), identify:
- title: the full paper title
- authors: author names as "A. Name, B. Name" — first three, then " et al." if more
- year: publication year as an integer, or null if not determinable
- abstract: the paper's abstract verbatim if present; otherwise a faithful 3–5 sentence summary of the paper's aim, methods and findings from the available text; empty string if impossible
Respond ONLY with valid JSON: {"title": "...", "authors": "...", "year": 2021, "abstract": "..."}
"""

DOI_RE = re.compile(r'10\.\d{4,9}/[^\s"<>]+')
_UA = {"User-Agent": "ResearchAI-tool (research@example.com)"}


async def _extract_paper_metadata(text: str, hint: str = '') -> dict:
    response = await client.responses.create(
        model=MODEL,
        instructions=PAPER_METADATA_PROMPT,
        input=f"{hint}\n\nDOCUMENT TEXT:\n{text}" if hint else f"DOCUMENT TEXT:\n{text}",
    )
    data = extract_json(response.output_text or "")
    if not data or not data.get("title"):
        raise HTTPException(status_code=422, detail="Could not identify paper metadata in this document")
    return data


@router.post("/matrix/ingest-paper-file", response_model=IngestedPaper)
async def ingest_paper_file(file: UploadFile = File(...)):
    raw = await file.read()
    filename = file.filename or 'upload'
    text = ''

    if filename.lower().endswith('.pdf') or raw[:5] == b'%PDF-':
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            text = '\n'.join((p.extract_text() or '') for p in reader.pages[:8])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read PDF: {str(e)}")
    else:
        text = raw.decode('utf-8', errors='ignore')

    text = text.strip()[:15000]
    if len(text) < 40:
        raise HTTPException(status_code=422, detail="No extractable text found (scanned PDF without OCR?)")

    data = await _extract_paper_metadata(text, hint=f"FILENAME: {filename}")
    year = data.get("year")
    return IngestedPaper(
        title=str(data.get("title", "")).strip(),
        authors=str(data.get("authors", "") or ""),
        year=int(year) if year else None,
        abstract=str(data.get("abstract", "") or ""),
        url='',
        source='upload',
    )


class IngestUrlRequest(BaseModel):
    url: str


@router.post("/matrix/ingest-paper-url", response_model=IngestedPaper)
async def ingest_paper_url(req: IngestUrlRequest):
    raw = req.url.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="URL is empty")

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as http:
        # 1) DOI (raw DOI, doi.org link, or DOI embedded in a publisher URL) → OpenAlex metadata
        doi_match = DOI_RE.search(raw)
        if doi_match:
            doi = doi_match.group(0).rstrip('.,;)')
            try:
                r = await http.get(f"https://api.openalex.org/works/https://doi.org/{doi}", headers=_UA)
                if r.status_code == 200:
                    item = r.json()
                    authorships = item.get("authorships") or []
                    names = [a["author"]["display_name"] for a in authorships[:3] if a.get("author")]
                    authors = ", ".join(names) + (" et al." if len(authorships) > 3 else "")
                    return IngestedPaper(
                        title=item.get("title") or item.get("display_name") or "",
                        authors=authors,
                        year=item.get("publication_year"),
                        abstract=reconstruct_abstract(item.get("abstract_inverted_index")),
                        url=item.get("doi") or raw,
                        source='doi',
                    )
            except HTTPException:
                raise
            except Exception:
                pass  # fall through to page fetch

        # 2) Any other URL → fetch the page and extract metadata with the LLM
        url = raw if raw.startswith(('http://', 'https://')) else f'https://{raw}'
        try:
            r = await http.get(url, headers=_UA)
            r.raise_for_status()
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Could not fetch URL: {str(e)}")

        html = r.text
        # crude tag strip — enough for LLM metadata extraction
        page_text = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', html, flags=re.S | re.I)
        page_text = re.sub(r'<[^>]+>', ' ', page_text)
        page_text = re.sub(r'\s+', ' ', page_text).strip()[:15000]
        if len(page_text) < 40:
            raise HTTPException(status_code=422, detail="Page contained no readable text")

        data = await _extract_paper_metadata(page_text, hint=f"SOURCE URL: {url}")
        year = data.get("year")
        return IngestedPaper(
            title=str(data.get("title", "")).strip(),
            authors=str(data.get("authors", "") or ""),
            year=int(year) if year else None,
            abstract=str(data.get("abstract", "") or ""),
            url=url,
            source='url',
        )
