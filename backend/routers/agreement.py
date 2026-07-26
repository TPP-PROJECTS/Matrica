"""
Inter-rater agreement.

Two reviewers screening the same records will agree on most of them purely by
chance — if 95% of records are excluded, two people excluding everything agree
95% of the time while demonstrating nothing. Cohen's kappa is raw agreement
corrected for that chance baseline, and it is what a methods section reports.

Kappa applies to *categorical* judgements (include / exclude). It does not apply
to free-text data extraction, where two reviewers write prose that is neither
identical nor a fixed set of categories; that case is reported as a per-field
agreement rate and a discrepancy list instead. Both are implemented here, kept
apart on purpose so neither gets used for the other's data.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field


# ── Categorical agreement (screening decisions) ───────────────────────────────

@dataclass
class KappaResult:
    """Cohen's kappa plus the raw figures it was derived from."""
    n: int                          # items both reviewers judged
    observed_agreement: float       # proportion agreed outright
    expected_agreement: float       # proportion expected by chance alone
    kappa: float
    interpretation: str
    disagreements: list[str] = field(default_factory=list)   # item keys


def _interpret(kappa: float) -> str:
    """Landis & Koch (1977) benchmarks — the labels reviews conventionally cite."""
    if kappa < 0.00:
        return "poor"
    if kappa < 0.21:
        return "slight"
    if kappa < 0.41:
        return "fair"
    if kappa < 0.61:
        return "moderate"
    if kappa < 0.81:
        return "substantial"
    return "almost perfect"


def cohens_kappa(
    rater_a: dict[str, str],
    rater_b: dict[str, str],
) -> KappaResult:
    """Cohen's kappa over the items both raters judged.

    Items only one rater judged are excluded rather than treated as a
    disagreement — an unjudged item carries no opinion to disagree with, and
    counting it as one would understate agreement whenever a reviewer simply
    has not finished.
    """
    shared = sorted(set(rater_a) & set(rater_b))
    n = len(shared)
    if n == 0:
        return KappaResult(0, 0.0, 0.0, 0.0, "not enough data")

    agreed = sum(1 for k in shared if rater_a[k] == rater_b[k])
    observed = agreed / n

    # Chance agreement: for each category, the product of the two raters'
    # marginal rates of using it, summed over categories.
    counts_a = Counter(rater_a[k] for k in shared)
    counts_b = Counter(rater_b[k] for k in shared)
    expected = sum(
        (counts_a.get(cat, 0) / n) * (counts_b.get(cat, 0) / n)
        for cat in set(counts_a) | set(counts_b)
    )

    if expected >= 1.0:
        # Both raters used a single category for everything. Agreement is total
        # but entirely explained by chance, so kappa is undefined (0/0). Report
        # it as 1.0 only when they genuinely agreed, and say so in words.
        kappa = 1.0 if observed == 1.0 else 0.0
        return KappaResult(
            n, observed, expected, kappa,
            "undefined — both reviewers used only one category",
            [k for k in shared if rater_a[k] != rater_b[k]],
        )

    kappa = (observed - expected) / (1 - expected)
    return KappaResult(
        n=n,
        observed_agreement=round(observed, 4),
        expected_agreement=round(expected, 4),
        kappa=round(kappa, 4),
        interpretation=_interpret(kappa),
        disagreements=[k for k in shared if rater_a[k] != rater_b[k]],
    )


# ── Free-text agreement (data extraction) ─────────────────────────────────────

def _normalise(value: str) -> str:
    """Fold away differences no adjudicator would count as a disagreement."""
    return " ".join((value or "").lower().split())


@dataclass
class FieldAgreement:
    """Agreement on one matrix column across the papers both reviewers filled."""
    column: str
    n: int
    matched: int
    agreement_pct: float
    discrepancies: list[dict] = field(default_factory=list)


def extraction_agreement(
    owner_cells: dict[str, dict[str, str]],
    reviewer_cells: dict[str, dict[str, str]],
    columns: list[str],
) -> list[FieldAgreement]:
    """Per-column agreement between two independent extractions.

    Cells are keyed paperId -> column -> value. Only cells both reviewers filled
    are compared; a blank on either side means no second opinion exists, not a
    disagreement. Matching is exact after normalising case and whitespace —
    anything subtler is a judgement call, so near-misses are surfaced as
    discrepancies for a human to adjudicate rather than silently scored.
    """
    results: list[FieldAgreement] = []
    for col in columns:
        compared = 0
        matched = 0
        discrepancies: list[dict] = []
        for paper_id, owner_row in owner_cells.items():
            reviewer_row = reviewer_cells.get(paper_id) or {}
            a = (owner_row or {}).get(col, "")
            b = reviewer_row.get(col, "")
            if not a.strip() or not b.strip():
                continue
            compared += 1
            if _normalise(a) == _normalise(b):
                matched += 1
            else:
                discrepancies.append({"paperId": paper_id, "owner": a, "reviewer": b})
        results.append(FieldAgreement(
            column=col,
            n=compared,
            matched=matched,
            agreement_pct=round(matched / compared * 100, 1) if compared else 0.0,
            discrepancies=discrepancies,
        ))
    return results
