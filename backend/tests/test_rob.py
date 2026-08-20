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

def test_instruments_span_every_research_tradition_the_tool_supports():
    ids = {t["id"] for t in list_rob_tools()["tools"]}
    # Clinical intervention research, which is where the step started...
    assert {"rob2", "robins_i", "amstar2"} <= ids
    # ...and the traditions it originally left out entirely.
    assert {"probast", "quadas2", "casp_qualitative", "axis"} <= ids
    assert {"mmat_qualitative", "mmat_rct", "mmat_nonrandomised",
            "mmat_descriptive", "mmat_mixed"} <= ids


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


def test_every_instrument_offers_a_way_to_say_the_report_does_not_say():
    # Instruments name it differently — no_information, unclear, can't tell —
    # but every one must offer it, or the model has no honest answer available
    # when the paper is silent. The tone is what the code keys on.
    for tool_id, tool in TOOLS_BY_ID.items():
        tones = [j["tone"] for j in tool["judgements"]]
        assert "unknown" in tones, tool_id


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


def test_the_fallback_uses_the_instrument_own_unknown_value():
    """A hardcoded "no_information" is outside PROBAST's and CASP's scales."""
    for tool_id, expected in (("probast", "unclear"), ("casp_qualitative", "cant_tell")):
        result = run_assess('{"domains": [], "overall": "", "overallRationale": ""}', tool_id=tool_id)
        assert {d.judgement for d in result.domains} == {expected}, tool_id


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


# ── Feeding the appraisal downstream ──────────────────────────────────────────
# The gap step is asked to identify what is "methodologically weak". Before the
# appraisal was passed in it could only infer that from design labels in the
# extraction matrix, which is a much weaker claim than naming the domain that
# actually failed.

from routers.gaps import _summarise_rob  # noqa: E402
from routers.rob_catalog import RobSummaryInfo, concerning_domains  # noqa: E402


def summary(**over) -> RobSummaryInfo:
    base = dict(
        title="A trial", tool="rob2", overall="high", confirmed=True,
        domains={"randomisation": "low", "confounding": "serious"},
    )
    base.update(over)
    return RobSummaryInfo(**base)


def test_concerning_domains_names_the_ones_that_failed():
    s = summary(tool="robins_i", domains={"confounding": "serious", "selection": "low"})
    assert concerning_domains(s) == ["Bias due to confounding"]


def test_no_information_counts_as_a_concern():
    # A trial that never reports how it concealed allocation has not shown that
    # it did; treating that as neutral would launder silence into quality.
    s = summary(domains={"randomisation": "no_information"})
    assert concerning_domains(s) == ["Bias arising from the randomisation process"]


def test_a_clean_study_raises_no_concerns():
    s = summary(domains={"randomisation": "low", "measurement": "low"})
    assert concerning_domains(s) == []


def test_domains_from_another_instrument_are_ignored():
    # 'confounding' is a ROBINS-I domain and has no meaning under RoB 2.
    s = summary(tool="rob2", domains={"confounding": "serious"})
    assert concerning_domains(s) == []


def test_an_unknown_tool_yields_no_concerns_rather_than_guessing():
    assert concerning_domains(summary(tool="newcastle_ottawa")) == []


def test_gap_context_names_the_failing_domains():
    text = _summarise_rob([summary(tool="robins_i", domains={"confounding": "serious"})])
    assert "Bias due to confounding" in text
    assert "RoB" in text or "ROBINS-I" in text


def test_gap_context_flags_unconfirmed_drafts():
    text = _summarise_rob([summary(confirmed=False)])
    assert "not confirmed" in text
    assert "provisional" in text


def test_gap_context_omits_the_caveat_when_everything_is_confirmed():
    text = _summarise_rob([summary(confirmed=True)])
    assert "unconfirmed AI drafts" not in text


def test_gap_context_tells_the_model_not_to_infer_quality_from_design_labels():
    text = _summarise_rob([summary()])
    assert "rather than inferring study quality from design labels" in text


def test_gap_context_separates_poor_reporting_from_poor_conduct():
    text = _summarise_rob([summary(domains={"randomisation": "no_information"})])
    assert "reporting rather than in conduct" in text


def test_no_appraisal_adds_nothing_to_the_prompt():
    assert _summarise_rob([]) == ""


# ── Coverage across every research field the tool supports ───────────────────
# The appraisal step originally shipped with three clinical instruments while
# the study-design catalog offered 54 designs spanning AI, education, HCI and
# qualitative research. Appraising a machine-learning model with RoB 2 yields
# five domains of "no information" about a randomisation that never happened, so
# every design must resolve either to a real instrument or to an explicit
# statement that none exists.

from routers.rob_catalog import (  # noqa: E402
    APPRAISAL_GUIDANCE,
    RECOMMENDED_TOOLS,
    ROB_TOOLS,
    recommend_for_design,
)
from routers.study_design_catalog import STUDY_DESIGN_CATALOG  # noqa: E402


def test_every_study_design_gets_an_instrument_or_an_explanation():
    unmet = [
        d["id"] for d in STUDY_DESIGN_CATALOG
        if d["id"] not in RECOMMENDED_TOOLS and d["id"] not in APPRAISAL_GUIDANCE
    ]
    assert unmet == [], f"designs with neither instrument nor guidance: {unmet}"


def test_every_recommendation_names_a_real_instrument():
    known = {t["id"] for t in ROB_TOOLS}
    for design, tools in RECOMMENDED_TOOLS.items():
        assert tools, f"{design} maps to an empty list"
        for t in tools:
            assert t in known, f"{design} recommends unknown instrument {t}"


def test_an_ai_model_study_is_sent_to_probast_not_rob2():
    rec = recommend_for_design("ai_model_study")
    assert [t["id"] for t in rec["recommended"]][0] == "probast"
    assert "rob2" not in [t["id"] for t in rec["recommended"]]


def test_a_qualitative_study_is_not_sent_to_a_trials_instrument():
    for design in ("ethnography", "grounded_theory", "phenomenology"):
        ids = [t["id"] for t in recommend_for_design(design)["recommended"]]
        assert ids[0] == "casp_qualitative"
        assert "rob2" not in ids and "robins_i" not in ids


def test_a_trial_still_goes_to_rob2():
    assert [t["id"] for t in recommend_for_design("rct")["recommended"]][0] == "rob2"


def test_a_cross_sectional_survey_goes_to_axis():
    assert [t["id"] for t in recommend_for_design("survey_study")["recommended"]][0] == "axis"


def test_a_design_without_an_instrument_returns_named_concerns():
    rec = recommend_for_design("design_science")
    assert rec["recommended"] == []
    assert rec["guidance"] is not None
    assert len(rec["guidance"]["concerns"]) >= 4
    assert "no risk-of-bias instrument" in rec["guidance"]["note"] or "frameworks" in rec["guidance"]["note"]


def test_ai_benchmark_concerns_name_data_leakage_and_contamination():
    concerns = " ".join(APPRAISAL_GUIDANCE["ai_model_study"]["concerns"]).lower()
    assert "leakage" in concerns
    assert "contamination" in concerns
    assert "baseline" in concerns


def test_an_unmapped_design_returns_empty_rather_than_guessing():
    rec = recommend_for_design("not_a_real_design")
    assert rec["recommended"] == []
    assert rec["guidance"] is None


def test_checklist_instruments_do_not_pretend_to_score():
    # MMAT, CASP and AXIS all warn against summing their items; the rule text is
    # what the UI shows, so it has to say so.
    for tool_id in ("mmat_qualitative", "casp_qualitative", "axis"):
        rule = TOOLS_BY_ID[tool_id]["overallRule"].lower()
        assert "score" in rule


def test_mmat_variants_all_carry_the_two_screening_questions():
    for tool_id in ("mmat_qualitative", "mmat_rct", "mmat_nonrandomised",
                    "mmat_descriptive", "mmat_mixed"):
        ids = [d["id"] for d in TOOLS_BY_ID[tool_id]["domains"]]
        assert ids[:2] == ["s1", "s2"], tool_id


def test_probast_analysis_domain_asks_about_leakage():
    analysis = next(d for d in TOOLS_BY_ID["probast"]["domains"] if d["id"] == "analysis")
    q = analysis["question"].lower()
    assert "held out" in q or "leaked" in q
    assert "calibration" in q
