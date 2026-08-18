"""Risk-of-bias appraisal.

The tests that matter here are about honesty rather than plumbing: the
instrument must arrive intact, and a model that skips domains or invents a
judgement value must not be able to quietly shorten or reword the instrument
the reviewer will go on to cite.
"""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("OPENAI_API_KEY", "sk-test-not-used")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers import rob  # noqa: E402
from routers.rob_catalog import (  # noqa: E402
    AMSTAR2_DOMAINS,
    ROB2_DOMAINS,
    ROBINS_I_DOMAINS,
    TOOLS_BY_ID,
    get_rob_tool,
    list_rob_tools,
)


# ── Catalog ───────────────────────────────────────────────────────────────────

def test_the_three_instruments_are_offered():
    ids = {t["id"] for t in list_rob_tools()["tools"]}
    assert ids == {"rob2", "robins_i", "amstar2"}


def test_rob2_has_its_five_published_domains():
    assert len(ROB2_DOMAINS) == 5
    assert [d["id"] for d in ROB2_DOMAINS] == [
        "randomisation", "deviations", "missing_data", "measurement", "reporting",
    ]


def test_robins_i_has_its_seven_published_domains():
    assert len(ROBINS_I_DOMAINS) == 7
    assert ROBINS_I_DOMAINS[0]["id"] == "confounding"


def test_amstar2_has_sixteen_items_of_which_seven_are_critical():
    assert len(AMSTAR2_DOMAINS) == 16
    critical = [d["id"] for d in AMSTAR2_DOMAINS if d["critical"]]
    # Shea et al. designate items 2, 4, 7, 9, 11, 13 and 15 as critical.
    assert critical == ["q2", "q4", "q7", "q9", "q11", "q13", "q15"]


def test_each_instrument_keeps_its_own_judgement_scale():
    # ROBINS-I's "serious" has no RoB 2 equivalent; collapsing the scales would
    # misreport the appraisal.
    assert "serious" in [j["value"] for j in TOOLS_BY_ID["robins_i"]["judgements"]]
    assert "serious" not in [j["value"] for j in TOOLS_BY_ID["rob2"]["judgements"]]
    assert "partial_yes" in [j["value"] for j in TOOLS_BY_ID["amstar2"]["judgements"]]


def test_every_instrument_offers_a_no_information_judgement():
    # Without it the model has no way to say the text does not report something.
    for tool in TOOLS_BY_ID.values():
        assert "no_information" in [j["value"] for j in tool["judgements"]]


def test_every_domain_carries_a_signalling_question():
    for tool in TOOLS_BY_ID.values():
        for domain in tool["domains"]:
            assert domain["question"].strip(), f'{tool["id"]}/{domain["id"]}'


def test_an_unknown_tool_is_a_404():
    with pytest.raises(HTTPException) as exc:
        get_rob_tool("newcastle_ottawa")
    assert exc.value.status_code == 404


# ── Assessment ────────────────────────────────────────────────────────────────

def paper():
    return rob.RobPaper(title="A trial", abstract="We randomised 240 adults.", year=2020)


def run_assess(model_json: str, tool_id: str = "rob2"):
    class FakeResponse:
        output_text = model_json

    class FakeResponses:
        async def create(self, **_kwargs):
            return FakeResponse()

    class FakeClient:
        responses = FakeResponses()

    original = rob.client
    rob.client = FakeClient()
    try:
        return asyncio.run(rob.assess_risk_of_bias(
            rob.AssessRequest(toolId=tool_id, paper=paper())
        ))
    finally:
        rob.client = original


def test_a_domain_the_model_skipped_comes_back_unanswered_not_missing():
    """A silently shortened instrument is not the instrument being cited."""
    result = run_assess('{"domains": [{"domainId": "randomisation", "judgement": "low", '
                        '"rationale": "Randomised.", "supportQuote": "We randomised 240 adults."}], '
                        '"overall": "some_concerns", "overallRationale": "..."}')
    assert [d.domainId for d in result.domains] == [d["id"] for d in ROB2_DOMAINS]
    skipped = [d for d in result.domains if d.domainId != "randomisation"]
    assert all(d.judgement == "no_information" for d in skipped)


def test_a_judgement_outside_the_scale_falls_back_to_no_information():
    """Better to report nothing than to report a rating the instrument lacks."""
    result = run_assess('{"domains": [{"domainId": "randomisation", "judgement": "probably fine"}], '
                        '"overall": "", "overallRationale": ""}')
    randomisation = next(d for d in result.domains if d.domainId == "randomisation")
    assert randomisation.judgement == "no_information"


def test_a_robins_i_judgement_is_rejected_on_a_rob2_assessment():
    result = run_assess('{"domains": [{"domainId": "randomisation", "judgement": "serious"}], '
                        '"overall": "", "overallRationale": ""}')
    randomisation = next(d for d in result.domains if d.domainId == "randomisation")
    assert randomisation.judgement == "no_information"


def test_judgement_values_are_normalised_for_case_and_spacing():
    result = run_assess('{"domains": [{"domainId": "randomisation", "judgement": "Some Concerns"}], '
                        '"overall": "", "overallRationale": ""}')
    randomisation = next(d for d in result.domains if d.domainId == "randomisation")
    assert randomisation.judgement == "some_concerns"


def test_the_supporting_quote_is_carried_through_for_checking():
    result = run_assess('{"domains": [{"domainId": "randomisation", "judgement": "low", '
                        '"rationale": "r", "supportQuote": "We randomised 240 adults."}], '
                        '"overall": "low", "overallRationale": "All domains low."}')
    randomisation = next(d for d in result.domains if d.domainId == "randomisation")
    assert randomisation.supportQuote == "We randomised 240 adults."
    assert result.overall == "low"


def test_an_amstar2_assessment_returns_all_sixteen_items():
    result = run_assess('{"domains": [], "overall": "", "overallRationale": ""}', tool_id="amstar2")
    assert len(result.domains) == 16


def test_assessing_with_an_unknown_tool_is_a_404():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(rob.assess_risk_of_bias(
            rob.AssessRequest(toolId="nope", paper=paper())
        ))
    assert exc.value.status_code == 404


def test_unparseable_model_output_is_a_502_not_a_crash():
    with pytest.raises(HTTPException) as exc:
        run_assess("I could not assess that paper.")
    assert exc.value.status_code == 502
