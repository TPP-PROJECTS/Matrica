"""
LLM-assisted title/abstract screening.

Given a paper and the review's eligibility criteria, decide whether the paper
should be included, excluded, or left for a human — and, when excluding, say
which criterion it fails so the decision maps onto a PRISMA "excluded, with
reasons" row.

Two deliberate constraints keep this honest as *screening*, not guessing:
  - The model may only judge from the title and abstract it is given. Screening
    is a title/abstract pass by definition; anything needing the full text is a
    later stage.
  - When the abstract does not settle it, the model must return "uncertain"
    rather than pick a side. A forced binary from insufficient evidence is
    exactly the error human screeners are trained to avoid, and burying it as a
    confident include/exclude would be worse than leaving the call to a person.
"""
from __future__ import annotations

import html
import re

import httpx
from fastapi import APIRouter, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel

from config import response_options
from routers.json_utils import extract_json
from routers.search import (
    OPENALEX_URL,
    PUBMED_FETCH_URL,
    _UA,
    _resolve_openalex_id,
    parse_pubmed_abstracts,
    reconstruct_abstract,
)

router = APIRouter()
client = AsyncOpenAI()

# The customisable part of screening. The decision rules live here — not in the
# per-paper message — so the user can tune *how* papers are judged from the
# protocol panel's ⚙, while the response structure (in the user message below)
# stays fixed and cannot be edited into something the app can't parse.
SCREENING_SYSTEM_PROMPT = """You are a systematic-review screener performing a title/abstract eligibility check.
You judge only from the title and abstract provided — never assume facts not present in them.

Decide, using ONLY the title and abstract:
  - "exclude" if the paper clearly fails an exclusion criterion, OR clearly does not meet the inclusion criteria.
  - "include" if the paper clearly meets the inclusion criteria and fails no exclusion criterion.
  - "uncertain" if the abstract does not give enough information to decide either way. Do NOT guess; prefer "uncertain" over a weakly-supported include or exclude. If there is no abstract, this is almost always "uncertain".

When excluding, cite the single exclusion criterion the paper most clearly fails, or none if it is excluded only for not meeting the inclusion criteria.

Respond with valid JSON only: no markdown, no commentary."""


class Criterion(BaseModel):
    id: str
    label: str


class PaperInfo(BaseModel):
    title: str
    abstract: str = ""
    authors: str = ""
    year: int | None = None
    url: str = ""


class ProfileInfo(BaseModel):
    domain: str = ""
    population: str = ""
    focus: str = ""
    method: str = ""
    reviewType: str = ""


class ClassifyRequest(BaseModel):
    paper: PaperInfo
    inclusion: list[Criterion] = []
    exclusion: list[Criterion] = []
    profile: ProfileInfo = ProfileInfo()
    custom_system_prompt: str | None = None


class ClassifyResponse(BaseModel):
    decision: str                    # "include" | "exclude" | "uncertain"
    criterionId: str | None = None   # which exclusion criterion failed, if excluded
    reason: str = ""
    resolvedAbstract: str | None = None


def _criteria_block(inclusion: list[Criterion], exclusion: list[Criterion]) -> str:
    inc = "\n".join(f'  - [{c.id}] {c.label}' for c in inclusion) or "  (none specified)"
    exc = "\n".join(f'  - [{c.id}] {c.label}' for c in exclusion) or "  (none specified)"
    return f"INCLUSION criteria (a paper must meet these):\n{inc}\n\nEXCLUSION criteria (a paper failing any of these is out):\n{exc}"


def normalise_decision(data: dict, valid_exclusion_ids: set[str]) -> ClassifyResponse:
    """Turn a raw model response into a safe, well-formed decision.

    Everything that could make an unsafe decision leak through is clamped here:
    an unrecognised label falls back to "uncertain" (hand it to a human, never
    invent an include/exclude); a criterionId is dropped unless the decision is
    an exclusion AND the id names a real criterion, so a hallucinated id can
    never attach a paper to a reason that does not exist.
    """
    decision = str(data.get("decision", "")).lower().strip()
    if decision not in {"include", "exclude", "uncertain"}:
        decision = "uncertain"

    criterion_id = data.get("criterionId")
    if decision != "exclude" or criterion_id not in valid_exclusion_ids:
        criterion_id = None

    return ClassifyResponse(
        decision=decision,
        criterionId=criterion_id,
        reason=str(data.get("reason", "")).strip(),
    )


_FALSE_NO_ABSTRACT = re.compile(
    r"\b(?:no|without|missing|unavailable|not available)\b.{0,30}\babstract\b"
    r"|\babstract\b.{0,30}\b(?:missing|unavailable|not available|was not provided|is not provided)\b",
    re.IGNORECASE,
)


def remove_false_no_abstract_reason(
    result: ClassifyResponse,
    abstract: str,
) -> ClassifyResponse:
    """Prevent a model reason from contradicting the supplied paper data."""
    if not abstract.strip() or not _FALSE_NO_ABSTRACT.search(result.reason):
        return result
    reason = (
        "The available abstract does not provide enough evidence to make a reliable eligibility decision."
        if result.decision == "uncertain"
        else "Decision based on the supplied title and abstract."
    )
    return result.model_copy(update={"reason": reason})


async def fetch_real_abstract(paper: PaperInfo) -> str:
    """Fill a missing abstract from PubMed, OpenAlex, or Crossref.

    Every returned character comes from a bibliographic source. Failure across
    all sources returns an empty string; this function never generates a
    substitute abstract.
    """
    if paper.abstract.strip():
        return paper.abstract.strip()

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as http:
        pmid_match = re.search(
            r"(?:pubmed(?:\.ncbi\.nlm\.nih\.gov)?/|pmid[:/\s])(\d+)",
            paper.url,
            re.IGNORECASE,
        )
        if pmid_match:
            try:
                response = await http.get(
                    PUBMED_FETCH_URL,
                    params={"db": "pubmed", "id": pmid_match.group(1), "retmode": "xml"},
                    headers=_UA,
                )
                response.raise_for_status()
                abstract = parse_pubmed_abstracts(response.text).get(pmid_match.group(1), "")
                if abstract:
                    return abstract
            except Exception:
                pass

        try:
            wid = await _resolve_openalex_id(http, paper.url, paper.title, paper.year)
            if wid:
                response = await http.get(
                    f"{OPENALEX_URL}/{wid}",
                    params={"select": "abstract_inverted_index,ids"},
                    headers=_UA,
                )
                response.raise_for_status()
                work = response.json()
                abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
                if abstract:
                    return abstract

                # OpenAlex sometimes has the identity graph but not the abstract.
                # Follow its real PMID back to PubMed, which is authoritative for
                # biomedical abstracts.
                pmid_url = (work.get("ids") or {}).get("pmid") or ""
                linked_pmid = re.search(r"(\d+)", pmid_url)
                if linked_pmid:
                    pubmed_response = await http.get(
                        PUBMED_FETCH_URL,
                        params={"db": "pubmed", "id": linked_pmid.group(1), "retmode": "xml"},
                        headers=_UA,
                    )
                    pubmed_response.raise_for_status()
                    return parse_pubmed_abstracts(pubmed_response.text).get(linked_pmid.group(1), "")
        except Exception:
            pass

        # Crossref sometimes carries the publisher-deposited abstract even when
        # OpenAlex has the work identity but no abstract index.
        doi_match = re.search(r'10\.\d{4,9}/[^\s"<>]+', paper.url, re.IGNORECASE)
        if doi_match:
            doi = doi_match.group(0).rstrip('.,;)')
            try:
                crossref_response = await http.get(
                    f"https://api.crossref.org/works/{doi}",
                    headers=_UA,
                )
                crossref_response.raise_for_status()
                raw_abstract = str(
                    (crossref_response.json().get("message") or {}).get("abstract") or ""
                )
                if raw_abstract:
                    clean_abstract = re.sub(r"<[^>]+>", " ", html.unescape(raw_abstract))
                    clean_abstract = re.sub(r"\s+", " ", clean_abstract).strip()
                    if clean_abstract:
                        return clean_abstract
            except Exception:
                pass

    return ""


@router.post("/screening/classify", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest):
    if not req.inclusion and not req.exclusion:
        raise HTTPException(
            status_code=400,
            detail="Define at least one inclusion or exclusion criterion before screening.",
        )

    abstract = await fetch_real_abstract(req.paper)

    profile_text = (
        f"Domain: {req.profile.domain}\n"
        f"Population: {req.profile.population}\n"
        f"Focus: {req.profile.focus}\n"
        f"Method: {req.profile.method}\n"
        f"Review type: {req.profile.reviewType}"
    )

    # The data and the response contract only — the decision rules are in the
    # system prompt, so a customised prompt changes how papers are judged
    # without ever touching the JSON shape the frontend depends on.
    user_content = f"""Screen this paper against the review's eligibility criteria.

RESEARCH CONTEXT:
{profile_text}

{_criteria_block(req.inclusion, req.exclusion)}

PAPER:
Title: {req.paper.title}
Authors: {req.paper.authors}
Year: {req.paper.year}
Abstract: {abstract or '(no abstract available from the source databases)'}

Respond with JSON in this exact format:
{{
  "decision": "include" | "exclude" | "uncertain",
  "criterionId": "<exclusion criterion id you are citing, or null>",
  "reason": "<one sentence, citing what in the abstract drove the decision>"
}}
"""

    try:
        response = await client.responses.create(
            **response_options(),
            instructions=req.custom_system_prompt or SCREENING_SYSTEM_PROMPT,
            input=user_content,
        )
        data = extract_json(response.output_text or "")
        if not isinstance(data, dict):
            raise HTTPException(status_code=500, detail="AI returned invalid JSON")

        result = normalise_decision(data, {c.id for c in req.exclusion})
        result = remove_false_no_abstract_reason(result, abstract)
        return result.model_copy(update={"resolvedAbstract": abstract or None})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Screening error: {str(e)}")
