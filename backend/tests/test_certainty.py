"""Parsing of drafted certainty judgements: only what the framework allows survives."""
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENAI_API_KEY", "sk-test-not-used")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.certainty import FrameworkSpec, parse_assessment  # noqa: E402

GRADE = FrameworkSpec(
    id="grade", name="GRADE", start_levels=["high", "low"],
    domains=[
        {"id": "risk_of_bias", "label": "Risk of bias", "question": "?",
         "options": [{"id": "no_concern", "label": "Not serious"}, {"id": "serious", "label": "Serious"}]},
        {"id": "imprecision", "label": "Imprecision", "question": "?",
         "options": [{"id": "no_concern", "label": "Not serious"}, {"id": "serious", "label": "Serious"}]},
    ],
)


def test_valid_answers_are_kept():
    out = parse_assessment({
        "finding": " Apps reduce anxiety. ", "start_level": "LOW",
        "domains": {"risk_of_bias": {"judgement": "Serious", "rationale": "Unblinded."},
                    "imprecision": {"judgement": "no_concern", "rationale": "Large samples."}},
    }, GRADE)
    assert out.finding == "Apps reduce anxiety."
    assert out.start_level == "low"
    assert out.domains["risk_of_bias"].judgement == "serious"


def test_a_missing_or_invented_answer_comes_back_unanswered():
    out = parse_assessment({"domains": {"risk_of_bias": {"judgement": "moderate"}}}, GRADE)
    assert out.domains["risk_of_bias"].judgement == ""
    assert out.domains["imprecision"].judgement == ""


def test_an_invalid_start_level_falls_back_to_the_first():
    assert parse_assessment({"start_level": "medium"}, GRADE).start_level == "high"


def test_cerqual_has_no_start_level():
    cerqual = FrameworkSpec(id="cerqual", name="CERQual", domains=GRADE.domains)
    assert parse_assessment({}, cerqual).start_level is None
