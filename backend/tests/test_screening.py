"""The parts of LLM screening that must be safe regardless of what the model
returns. The model call itself is not exercised here; normalise_decision is the
gate every raw response passes through."""
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENAI_API_KEY", "sk-test-not-used")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.screening import (  # noqa: E402
    ClassifyResponse,
    Criterion,
    _criteria_block,
    normalise_decision,
    remove_false_no_abstract_reason,
)


VALID = {"ex-design", "ex-population"}


def test_clean_include_passes_through():
    r = normalise_decision({"decision": "include", "criterionId": None, "reason": "meets PICO"}, VALID)
    assert r.decision == "include"
    assert r.criterionId is None
    assert r.reason == "meets PICO"


def test_exclude_keeps_a_valid_criterion_id():
    r = normalise_decision({"decision": "exclude", "criterionId": "ex-design", "reason": "case report"}, VALID)
    assert r.decision == "exclude"
    assert r.criterionId == "ex-design"


def test_unrecognised_decision_falls_back_to_uncertain():
    # A label the app cannot act on must never be applied as include/exclude.
    r = normalise_decision({"decision": "maybe include", "reason": "x"}, VALID)
    assert r.decision == "uncertain"


def test_missing_decision_is_uncertain():
    assert normalise_decision({}, VALID).decision == "uncertain"


def test_hallucinated_criterion_id_is_dropped():
    # The model cited a reason id that does not exist; it must not be attached,
    # or PRISMA would group exclusions under a phantom reason.
    r = normalise_decision({"decision": "exclude", "criterionId": "ex-made-up", "reason": "x"}, VALID)
    assert r.decision == "exclude"
    assert r.criterionId is None


def test_criterion_id_is_cleared_when_not_excluding():
    # An include with a stray criterionId should not carry an exclusion reason.
    r = normalise_decision({"decision": "include", "criterionId": "ex-design", "reason": "x"}, VALID)
    assert r.criterionId is None


def test_decision_label_is_case_insensitive():
    assert normalise_decision({"decision": "EXCLUDE", "criterionId": "ex-design"}, VALID).decision == "exclude"


def test_reason_defaults_to_empty_string():
    assert normalise_decision({"decision": "uncertain"}, VALID).reason == ""


def test_reason_cannot_claim_a_supplied_abstract_is_missing():
    result = ClassifyResponse(
        decision="uncertain",
        reason="No abstract was available, so eligibility cannot be assessed.",
    )
    cleaned = remove_false_no_abstract_reason(result, "This is a real supplied abstract.")
    assert "no abstract" not in cleaned.reason.lower()
    assert "available abstract" in cleaned.reason.lower()


def test_criteria_block_lists_ids_for_the_model_to_cite():
    block = _criteria_block(
        [Criterion(id="in-1", label="adults")],
        [Criterion(id="ex-1", label="animals")],
    )
    assert "[in-1] adults" in block
    assert "[ex-1] animals" in block


def test_criteria_block_handles_empty_lists():
    block = _criteria_block([], [])
    assert "(none specified)" in block
