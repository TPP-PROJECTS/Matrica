"""
Canonical catalog of risk-of-bias / quality appraisal instruments.

Quality appraisal is the step between "these studies are eligible" and "this is
what the evidence says". Without it a review reports a badly confounded cohort
study and a well-conducted trial as though they carried equal weight, which is
the single most common reason a review is rejected or disbelieved.

The instruments here are fixed, published tools. Their domains, the wording of
their signalling questions, and their allowed judgements are all part of the
instrument — a reviewer cites "RoB 2" and a reader is entitled to assume the
standard domains were applied. So they are held as data and never generated:
the LLM's job is to answer them from a paper, not to decide what they are.

Instruments implemented:
  RoB 2      Cochrane risk-of-bias tool for randomised trials (Sterne 2019)
  ROBINS-I   Risk Of Bias In Non-randomised Studies of Interventions (Sterne 2016)
  AMSTAR 2   Appraisal of systematic reviews (Shea 2017)
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class RobSummaryInfo(BaseModel):
    """One study's appraisal, as the downstream steps need to see it.

    Shared by the synthesis and gap endpoints so both read the appraisal the
    same way. `confirmed` travels with it because an unconfirmed AI draft is a
    weaker warrant than a reviewer's own judgement, and neither step should
    treat the two as interchangeable.

    `domains` carries the raw domainId -> judgement map rather than a
    pre-digested verdict: which judgements count as a concern is a property of
    the instrument, and the instrument lives here, so the frontend ships what it
    has and this module decides what it means.
    """
    title: str
    tool: str = ''
    overall: str = ''
    confirmed: bool = False
    domains: dict[str, str] = {}


def _d(domain_id: str, label: str, question: str, critical: bool = False) -> dict:
    """One appraisal domain. `critical` is AMSTAR 2's weighting of its items."""
    return {"id": domain_id, "label": label, "question": question, "critical": critical}


# ── Judgement scales ──────────────────────────────────────────────────────────
# Each instrument has its own, and they are not interchangeable: ROBINS-I's
# "Serious" has no equivalent in RoB 2, and collapsing them would misreport the
# appraisal.

ROB2_JUDGEMENTS = [
    {"value": "low", "label": "Low risk", "tone": "good"},
    {"value": "some_concerns", "label": "Some concerns", "tone": "warn"},
    {"value": "high", "label": "High risk", "tone": "bad"},
    {"value": "no_information", "label": "No information", "tone": "unknown"},
]

ROBINS_I_JUDGEMENTS = [
    {"value": "low", "label": "Low risk", "tone": "good"},
    {"value": "moderate", "label": "Moderate risk", "tone": "warn"},
    {"value": "serious", "label": "Serious risk", "tone": "bad"},
    {"value": "critical", "label": "Critical risk", "tone": "bad"},
    {"value": "no_information", "label": "No information", "tone": "unknown"},
]

AMSTAR2_JUDGEMENTS = [
    {"value": "yes", "label": "Yes", "tone": "good"},
    {"value": "partial_yes", "label": "Partial yes", "tone": "warn"},
    {"value": "no", "label": "No", "tone": "bad"},
    {"value": "no_information", "label": "No information", "tone": "unknown"},
]


# ── RoB 2 — randomised trials ─────────────────────────────────────────────────

ROB2_DOMAINS = [
    _d(
        "randomisation",
        "Bias arising from the randomisation process",
        "Was the allocation sequence random and adequately concealed until participants were "
        "enrolled? Do baseline differences between groups suggest a problem with randomisation?",
    ),
    _d(
        "deviations",
        "Bias due to deviations from intended interventions",
        "Were participants and carers aware of their assigned intervention, and did any "
        "deviations from it arise because of the trial context? Was an appropriate analysis "
        "(e.g. intention-to-treat) used to estimate the effect of assignment?",
    ),
    _d(
        "missing_data",
        "Bias due to missing outcome data",
        "Were outcome data available for all, or nearly all, randomised participants? Is there "
        "evidence that the result was not biased by missing data, and could missingness depend "
        "on the true value of the outcome?",
    ),
    _d(
        "measurement",
        "Bias in measurement of the outcome",
        "Was the method of measuring the outcome appropriate and comparable between groups? "
        "Were outcome assessors aware of the intervention received, and — this is what decides "
        "the domain — COULD that awareness have influenced the measurement? That depends on the "
        "outcome, not on whether the trial was blinded. For an objective outcome that cannot be "
        "swayed by an assessor's belief (all-cause mortality, laboratory values, a registry-linked "
        "event), an open-label trial is still low risk on this domain. Downgrade for lack of "
        "blinding only where the outcome involves judgement: clinician-rated severity, "
        "patient-reported symptoms, adjudicated composite endpoints, cause-specific death.",
    ),
    _d(
        "reporting",
        "Bias in selection of the reported result",
        "Was the analysis carried out in accordance with a pre-specified plan finalised before "
        "unblinded outcome data were available? Is the reported result likely to have been "
        "selected from multiple outcome measurements or analyses?",
    ),
]


# ── ROBINS-I — non-randomised studies of interventions ────────────────────────

ROBINS_I_DOMAINS = [
    _d(
        "confounding",
        "Bias due to confounding",
        "Is the effect of intervention likely to be confounded by prognostic variables that "
        "predict intervention received? Did the authors identify and appropriately control for "
        "all important confounding domains?",
    ),
    _d(
        "selection",
        "Bias in selection of participants into the study",
        "Was selection into the study related to both the intervention and the outcome, and did "
        "start of follow-up coincide with start of intervention?",
    ),
    _d(
        "classification",
        "Bias in classification of interventions",
        "Were intervention groups clearly defined, and was the information used to classify them "
        "recorded at the time of intervention rather than reconstructed afterwards?",
    ),
    _d(
        "deviations",
        "Bias due to deviations from intended interventions",
        "Were there deviations from the intended intervention beyond what would be expected in "
        "usual practice, and were they balanced between groups?",
    ),
    _d(
        "missing_data",
        "Bias due to missing data",
        "Were outcome data available for all, or nearly all, participants, and were participants "
        "excluded due to missing data on intervention status or confounders?",
    ),
    _d(
        "measurement",
        "Bias in measurement of outcomes",
        "COULD the outcome measure have been influenced by knowledge of the intervention "
        "received, and were methods of outcome assessment comparable across groups? Whether "
        "assessors were blinded matters only to the extent the outcome is open to judgement: an "
        "objective outcome (death from any cause, a laboratory value, a linked registry record) "
        "is not biased by an unblinded assessor, whereas a rated or self-reported one can be.",
    ),
    _d(
        "reporting",
        "Bias in selection of the reported result",
        "Is the reported effect estimate likely to have been selected, on the basis of the "
        "results, from multiple outcome measurements, analyses or subgroups?",
    ),
]


# ── AMSTAR 2 — systematic reviews ─────────────────────────────────────────────
# Seven items are designated critical by Shea et al.; failing one drops the whole
# review's confidence rating, so the flag is part of the instrument's data.

AMSTAR2_DOMAINS = [
    _d("q1", "1. PICO components in research questions and inclusion criteria",
       "Did the research questions and inclusion criteria include the components of PICO "
       "(population, intervention, comparator, outcome)?"),
    _d("q2", "2. Protocol registered before the review was conducted",
       "Did the report contain an explicit statement that the review methods were established "
       "before the review, and justify any deviations from the protocol?", critical=True),
    _d("q3", "3. Study designs for inclusion explained",
       "Did the review authors explain their selection of the study designs for inclusion?"),
    _d("q4", "4. Comprehensive literature search strategy",
       "Did the review authors search at least two databases, provide keywords and/or the search "
       "strategy, justify publication restrictions, and search beyond databases (trial "
       "registries, reference lists, grey literature)?", critical=True),
    _d("q5", "5. Study selection performed in duplicate",
       "Did at least two reviewers independently screen studies, or did one screen with a second "
       "checking a sample and achieving good agreement?"),
    _d("q6", "6. Data extraction performed in duplicate",
       "Did at least two reviewers independently extract data, or was there good agreement "
       "between reviewers on a sample?"),
    _d("q7", "7. Excluded studies listed and exclusions justified",
       "Did the review authors provide a list of the studies excluded at full text, and justify "
       "each exclusion?", critical=True),
    _d("q8", "8. Included studies described in adequate detail",
       "Did the review describe populations, interventions, comparators, outcomes, research "
       "designs and settings of the included studies?"),
    _d("q9", "9. Satisfactory technique for assessing risk of bias",
       "Did the review authors use a satisfactory technique for assessing risk of bias in the "
       "individual studies, covering the sources of bias appropriate to their designs?",
       critical=True),
    _d("q10", "10. Sources of funding of included studies reported",
       "Did the review authors report on the sources of funding for the studies they included?"),
    _d("q11", "11. Appropriate methods for statistical combination",
       "If meta-analysis was performed, were appropriate methods used for statistical combination "
       "of results, with justification of the model and investigation of heterogeneity?",
       critical=True),
    _d("q12", "12. Impact of risk of bias on the meta-analysis assessed",
       "If meta-analysis was performed, did the authors assess the potential impact of risk of "
       "bias in individual studies on the pooled result?"),
    _d("q13", "13. Risk of bias accounted for when interpreting results",
       "Did the review authors account for risk of bias in individual studies when interpreting "
       "or discussing the results of the review?", critical=True),
    _d("q14", "14. Heterogeneity explained and discussed",
       "Did the review authors provide a satisfactory explanation for, and discussion of, any "
       "heterogeneity observed in the results?"),
    _d("q15", "15. Publication bias investigated and its impact discussed",
       "If quantitative synthesis was performed, did the authors carry out an adequate "
       "investigation of publication bias and discuss its likely impact?", critical=True),
    _d("q16", "16. Conflicts of interest reported",
       "Did the review authors report any potential sources of conflict of interest, including "
       "any funding they received for conducting the review?"),
]


ROB_TOOLS = [
    {
        "id": "rob2",
        "name": "RoB 2",
        "fullName": "Cochrane risk-of-bias tool for randomised trials, version 2",
        "appliesTo": "Randomised controlled trials",
        "reference": "Sterne JAC et al. BMJ 2019;366:l4898",
        "domains": ROB2_DOMAINS,
        "judgements": ROB2_JUDGEMENTS,
        # How the per-domain judgements roll up. Stated so the UI and the report
        # can show the rule alongside the result rather than an opaque verdict.
        "overallRule": (
            "Low risk of bias only if every domain is low. Some concerns if at least one domain "
            "raises some concerns but none is high risk. High risk if any domain is high risk, or "
            "if multiple domains raise some concerns in a way that substantially lowers confidence."
        ),
    },
    {
        "id": "robins_i",
        "name": "ROBINS-I",
        "fullName": "Risk Of Bias In Non-randomised Studies — of Interventions",
        "appliesTo": "Non-randomised / observational studies of interventions",
        "reference": "Sterne JAC et al. BMJ 2016;355:i4919",
        "domains": ROBINS_I_DOMAINS,
        "judgements": ROBINS_I_JUDGEMENTS,
        "overallRule": (
            "The overall judgement is the most severe judgement across domains: low only if every "
            "domain is low; critical if any domain is critical. A study judged critical in any "
            "domain is normally too problematic to include in a synthesis."
        ),
    },
    {
        "id": "amstar2",
        "name": "AMSTAR 2",
        "fullName": "A MeaSurement Tool to Assess systematic Reviews, version 2",
        "appliesTo": "Systematic reviews and meta-analyses",
        "reference": "Shea BJ et al. BMJ 2017;358:j4008",
        "domains": AMSTAR2_DOMAINS,
        "judgements": AMSTAR2_JUDGEMENTS,
        "overallRule": (
            "High confidence: no or one non-critical weakness. Moderate: more than one "
            "non-critical weakness. Low: one critical flaw, with or without non-critical "
            "weaknesses. Critically low: more than one critical flaw. Critical items are 2, 4, 7, "
            "9, 11, 13 and 15."
        ),
    },
]

TOOLS_BY_ID = {tool["id"]: tool for tool in ROB_TOOLS}

# Judgement "tones" that represent a problem with the study rather than a clean
# bill of health. 'unknown' is deliberately included: on these instruments "no
# information" is not neutral — a trial that never reports how it concealed
# allocation has not demonstrated that it did.
_CONCERNING_TONES = {"warn", "bad", "unknown"}


def concerning_domains(summary: RobSummaryInfo) -> list[str]:
    """Human-readable labels of the domains where this study fell down.

    The gap analysis needs the specific weakness ("confounding was not
    adequately controlled") rather than a bare overall rating, because a gap
    argument has to name what future work would have to do differently.
    """
    tool = TOOLS_BY_ID.get(summary.tool)
    if tool is None:
        return []
    tones = {j["value"]: j["tone"] for j in tool["judgements"]}
    labels = {d["id"]: d["label"] for d in tool["domains"]}
    return [
        labels[domain_id]
        for domain_id, judgement in summary.domains.items()
        if domain_id in labels and tones.get(judgement) in _CONCERNING_TONES
    ]


@router.get("/rob/tools")
def list_rob_tools() -> dict:
    """The instruments a reviewer can choose from, with their full domain sets."""
    return {"tools": ROB_TOOLS}


@router.get("/rob/tools/{tool_id}")
def get_rob_tool(tool_id: str) -> dict:
    tool = TOOLS_BY_ID.get(tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Unknown appraisal tool: {tool_id}")
    return tool
