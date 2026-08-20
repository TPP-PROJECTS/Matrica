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


# ── Judgement scales for the non-Cochrane instruments ─────────────────────────

# PROBAST and QUADAS-2 both rate risk of bias per domain on the same three-point
# scale, where "unclear" means the report does not say — which is a finding, not
# a neutral middle.
PROBAST_JUDGEMENTS = [
    {"value": "low", "label": "Low risk", "tone": "good"},
    {"value": "high", "label": "High risk", "tone": "bad"},
    {"value": "unclear", "label": "Unclear", "tone": "unknown"},
]

# MMAT, CASP and AXIS are criterion checklists rather than risk scales: each item
# is met, not met, or not determinable from the report.
CHECKLIST_JUDGEMENTS = [
    {"value": "yes", "label": "Yes", "tone": "good"},
    {"value": "no", "label": "No", "tone": "bad"},
    {"value": "cant_tell", "label": "Can't tell", "tone": "unknown"},
]


# ── PROBAST — prediction models, including machine-learning models ────────────
# Wolff RF et al. Ann Intern Med 2019;170:51-58. The instrument a review of
# AI/ML prediction models is expected to use: its Analysis domain is where the
# failures that actually sink such models live — optimistic validation, leakage
# between development and evaluation data, and performance reported without
# calibration.

PROBAST_DOMAINS = [
    _d(
        "participants",
        "1. Participants",
        "Were appropriate data sources used (cohort or nested case-control rather than a "
        "case-control design), and were the inclusions and exclusions of participants "
        "appropriate? For a model developed on routinely collected or scraped data, is the "
        "population it was built from the population it is meant to serve?",
    ),
    _d(
        "predictors",
        "2. Predictors",
        "Were predictors defined and assessed in the same way for all participants, and assessed "
        "without knowledge of the outcome? Would every predictor actually be available at the "
        "moment the model is intended to be used — or does the model rely on information that "
        "only exists after the outcome is known?",
    ),
    _d(
        "outcome",
        "3. Outcome",
        "Was the outcome determined appropriately, using a pre-specified or standard definition, "
        "and without knowledge of the predictor information? Were predictors themselves excluded "
        "from the outcome definition, and was the interval between predictor assessment and "
        "outcome determination appropriate?",
    ),
    _d(
        "analysis",
        "4. Analysis",
        "Were there enough participants with the event to support the number of predictors? Were "
        "continuous and categorical predictors handled sensibly, all enrolled participants "
        "included, and missing data handled appropriately? Were overfitting and optimism "
        "accounted for — that is, was performance measured on data genuinely held out from every "
        "step of development, including feature selection and hyperparameter tuning, rather than "
        "on data that leaked into fitting? Were relevant performance measures reported, including "
        "calibration and not discrimination alone?",
    ),
]


# ── QUADAS-2 — diagnostic accuracy studies ───────────────────────────────────
# Whiting PF et al. Ann Intern Med 2011;155:529-536.

QUADAS2_DOMAINS = [
    _d(
        "patient_selection",
        "1. Patient selection",
        "Was a consecutive or random sample of patients enrolled? Was a case-control design "
        "avoided, and did the study avoid inappropriate exclusions — such as dropping difficult "
        "or ambiguous cases, which inflates apparent accuracy?",
    ),
    _d(
        "index_test",
        "2. Index test",
        "Were the index test results interpreted without knowledge of the results of the "
        "reference standard? If a threshold was used, was it pre-specified rather than chosen "
        "after seeing which cut-off performed best?",
    ),
    _d(
        "reference_standard",
        "3. Reference standard",
        "Is the reference standard likely to correctly classify the target condition, and were "
        "its results interpreted without knowledge of the index test results?",
    ),
    _d(
        "flow_timing",
        "4. Flow and timing",
        "Was there an appropriate interval between the index test and the reference standard? Did "
        "all patients receive a reference standard, was it the same one for all, and were all "
        "patients included in the analysis?",
    ),
]


# ── MMAT — the one instrument built for mixed-design reviews ─────────────────
# Hong QN et al. Mixed Methods Appraisal Tool, version 2018.
#
# MMAT exists because a single review often includes qualitative studies, trials
# and surveys together, and appraising them with three unrelated instruments
# makes the results incomparable. It is one tool with five category-specific
# item sets; the reviewer applies the set matching each study. It is presented
# here as five entries because that is how it is used — you appraise one study
# against one category.
#
# MMAT deliberately discourages an overall numeric score: a study meeting four
# of five criteria is not "80% good", and reducing it to a number hides which
# criterion failed. Its own guidance is to report the items.

MMAT_SCREENING = [
    _d("s1", "S1. Clear research questions",
       "Are there clear research questions?"),
    _d("s2", "S2. Data address the questions",
       "Do the collected data allow the research questions to be addressed?"),
]

MMAT_QUALITATIVE_DOMAINS = MMAT_SCREENING + [
    _d("q1", "1.1 Appropriate approach",
       "Is the qualitative approach appropriate to answer the research question?"),
    _d("q2", "1.2 Adequate data collection",
       "Are the qualitative data collection methods adequate to address the research question?"),
    _d("q3", "1.3 Findings derived from data",
       "Are the findings adequately derived from the data?"),
    _d("q4", "1.4 Interpretation substantiated",
       "Is the interpretation of results sufficiently substantiated by the data?"),
    _d("q5", "1.5 Coherence throughout",
       "Is there coherence between the qualitative data sources, collection, analysis and "
       "interpretation?"),
]

MMAT_RCT_DOMAINS = MMAT_SCREENING + [
    _d("q1", "2.1 Randomisation performed appropriately",
       "Is randomisation appropriately performed?"),
    _d("q2", "2.2 Groups comparable at baseline",
       "Are the groups comparable at baseline?"),
    _d("q3", "2.3 Complete outcome data",
       "Are there complete outcome data?"),
    _d("q4", "2.4 Assessors blinded",
       "Are outcome assessors blinded to the intervention provided?"),
    _d("q5", "2.5 Adherence to the assigned intervention",
       "Did the participants adhere to the assigned intervention?"),
]

MMAT_NONRANDOMISED_DOMAINS = MMAT_SCREENING + [
    _d("q1", "3.1 Participants representative",
       "Are the participants representative of the target population?"),
    _d("q2", "3.2 Appropriate measurements",
       "Are measurements appropriate regarding both the outcome and the intervention or "
       "exposure?"),
    _d("q3", "3.3 Complete outcome data",
       "Are there complete outcome data?"),
    _d("q4", "3.4 Confounders accounted for",
       "Are the confounders accounted for in the design and analysis?"),
    _d("q5", "3.5 Intervention administered as intended",
       "During the study period, was the intervention administered (or exposure occurring) as "
       "intended?"),
]

MMAT_DESCRIPTIVE_DOMAINS = MMAT_SCREENING + [
    _d("q1", "4.1 Relevant sampling strategy",
       "Is the sampling strategy relevant to address the research question?"),
    _d("q2", "4.2 Sample representative",
       "Is the sample representative of the target population?"),
    _d("q3", "4.3 Appropriate measurements",
       "Are the measurements appropriate?"),
    _d("q4", "4.4 Low risk of nonresponse bias",
       "Is the risk of nonresponse bias low?"),
    _d("q5", "4.5 Appropriate statistical analysis",
       "Is the statistical analysis appropriate to answer the research question?"),
]

MMAT_MIXED_DOMAINS = MMAT_SCREENING + [
    _d("q1", "5.1 Rationale for a mixed design",
       "Is there an adequate rationale for using a mixed methods design to address the research "
       "question?"),
    _d("q2", "5.2 Components effectively integrated",
       "Are the different components of the study effectively integrated to answer the research "
       "question?"),
    _d("q3", "5.3 Integration outputs interpreted",
       "Are the outputs of the integration of qualitative and quantitative components adequately "
       "interpreted?"),
    _d("q4", "5.4 Divergences addressed",
       "Are divergences and inconsistencies between quantitative and qualitative results "
       "adequately addressed?"),
    _d("q5", "5.5 Each component meets its own standards",
       "Do the different components of the study adhere to the quality criteria of each tradition "
       "of the methods involved?"),
]


# ── CASP — qualitative research ──────────────────────────────────────────────
# Critical Appraisal Skills Programme qualitative checklist.

CASP_QUALITATIVE_DOMAINS = [
    _d("q1", "1. Clear statement of aims",
       "Was there a clear statement of the aims of the research?"),
    _d("q2", "2. Qualitative methodology appropriate",
       "Is a qualitative methodology appropriate for what the research is trying to find out?"),
    _d("q3", "3. Research design appropriate",
       "Was the research design appropriate to address the aims of the research?"),
    _d("q4", "4. Recruitment strategy appropriate",
       "Was the recruitment strategy appropriate to the aims of the research, and is it explained "
       "why some participants chose not to take part?"),
    _d("q5", "5. Data collection addressed the issue",
       "Was the data collected in a way that addressed the research issue — setting, method, and "
       "any modification to methods during the study, all made explicit?"),
    _d("q6", "6. Researcher–participant relationship considered",
       "Has the relationship between researcher and participants been adequately considered — "
       "the researcher's own role, potential bias and influence, and reflexivity about it?"),
    _d("q7", "7. Ethical issues considered",
       "Have ethical issues been taken into consideration, including informed consent and "
       "approval from an ethics committee?"),
    _d("q8", "8. Analysis sufficiently rigorous",
       "Was the data analysis sufficiently rigorous — is the process described, are sufficient "
       "data presented to support the findings, and were contradictory data considered?"),
    _d("q9", "9. Clear statement of findings",
       "Is there a clear statement of findings, discussed in relation to the original research "
       "question, and with evidence for and against the researcher's arguments?"),
    _d("q10", "10. Value of the research",
       "How valuable is the research — does it discuss its contribution to existing knowledge, "
       "identify new areas for research, and consider transferability to other populations?"),
]


# ── AXIS — cross-sectional and survey studies ────────────────────────────────
# Downes MJ et al. BMJ Open 2016;6:e011458.

AXIS_DOMAINS = [
    _d("q1", "1. Aims clearly stated", "Were the aims/objectives of the study clear?"),
    _d("q2", "2. Design appropriate", "Was the study design appropriate for the stated aim?"),
    _d("q3", "3. Sample size justified", "Was the sample size justified?"),
    _d("q4", "4. Target population defined", "Was the target/reference population clearly defined?"),
    _d("q5", "5. Sample frame representative",
       "Was the sample frame taken from an appropriate population base so that it closely "
       "represented the target population under investigation?"),
    _d("q6", "6. Selection process representative",
       "Was the selection process likely to select subjects that were representative of the "
       "target population?"),
    _d("q7", "7. Non-responders addressed",
       "Were measures undertaken to address and categorise non-responders?"),
    _d("q8", "8. Measures appropriate for the aims",
       "Were the risk factor and outcome variables measured appropriate to the aims of the "
       "study?"),
    _d("q9", "9. Instruments previously validated",
       "Were the risk factor and outcome variables measured correctly using instruments that had "
       "been trialled, piloted or published previously?"),
    _d("q10", "10. Statistical significance determined",
       "Is it clear what was used to determine statistical significance and/or precision "
       "estimates?"),
    _d("q11", "11. Methods sufficiently described to repeat",
       "Were the methods (including statistical methods) sufficiently described to enable them "
       "to be repeated?"),
    _d("q12", "12. Basic data adequately described",
       "Were the basic data adequately described?"),
    _d("q13", "13. Response rate raises concerns",
       "Does the response rate raise concerns about non-response bias?"),
    _d("q14", "14. Non-response bias addressed",
       "If appropriate, was information about non-responders described?"),
    _d("q15", "15. Results internally consistent",
       "Were the results internally consistent?"),
    _d("q16", "16. Results presented for all analyses",
       "Were the results presented for all the analyses described in the methods?"),
    _d("q17", "17. Discussion and conclusions justified",
       "Were the authors' discussions and conclusions justified by the results?"),
    _d("q18", "18. Limitations discussed",
       "Were the limitations of the study discussed?"),
    _d("q19", "19. Funding or conflicts declared",
       "Were there any funding sources or conflicts of interest that may affect the authors' "
       "interpretation of the results?"),
    _d("q20", "20. Ethical approval obtained",
       "Was ethical approval or consent of participants attained?"),
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

ROB_TOOLS += [
    {
        "id": "probast",
        "name": "PROBAST",
        "fullName": "Prediction model Risk Of Bias ASsessment Tool",
        "appliesTo": "Prediction models, including machine-learning models",
        "reference": "Wolff RF et al. Ann Intern Med 2019;170:51-58",
        "domains": PROBAST_DOMAINS,
        "judgements": PROBAST_JUDGEMENTS,
        "overallRule": (
            "Low risk of bias only if every domain is low. High risk if any domain is high. "
            "Unclear if at least one domain is unclear and none is high. In practice the Analysis "
            "domain decides most model studies: performance measured on data that took part in "
            "any step of fitting is optimistic, however impressive it looks."
        ),
    },
    {
        "id": "quadas2",
        "name": "QUADAS-2",
        "fullName": "Quality Assessment of Diagnostic Accuracy Studies, version 2",
        "appliesTo": "Diagnostic and prognostic accuracy studies",
        "reference": "Whiting PF et al. Ann Intern Med 2011;155:529-536",
        "domains": QUADAS2_DOMAINS,
        "judgements": PROBAST_JUDGEMENTS,
        "overallRule": (
            "Judge each domain separately; there is no summary score. A study is at low risk "
            "overall only when every domain is low. QUADAS-2 also asks about applicability to "
            "your review question, which is recorded separately from risk of bias."
        ),
    },
    {
        "id": "mmat_qualitative",
        "name": "MMAT — Qualitative",
        "fullName": "Mixed Methods Appraisal Tool (2018), qualitative studies",
        "appliesTo": "Qualitative studies, within a review that may also include other designs",
        "reference": "Hong QN et al. MMAT version 2018",
        "domains": MMAT_QUALITATIVE_DOMAINS,
        "judgements": CHECKLIST_JUDGEMENTS,
        "overallRule": (
            "MMAT explicitly discourages an overall score: a study meeting four of five criteria "
            "is not '80% good', and the number hides which criterion failed. Report the items. "
            "If either screening question is answered No, the study may not be appraisable at all."
        ),
    },
    {
        "id": "mmat_rct",
        "name": "MMAT — Randomised trials",
        "fullName": "Mixed Methods Appraisal Tool (2018), quantitative randomised controlled trials",
        "appliesTo": "Randomised trials inside a mixed-design review (use RoB 2 for a trials-only review)",
        "reference": "Hong QN et al. MMAT version 2018",
        "domains": MMAT_RCT_DOMAINS,
        "judgements": CHECKLIST_JUDGEMENTS,
        "overallRule": (
            "Report the items rather than a score. For a review of trials alone, RoB 2 is the more "
            "detailed instrument; MMAT's value is that its results sit alongside the qualitative "
            "and survey studies in the same review."
        ),
    },
    {
        "id": "mmat_nonrandomised",
        "name": "MMAT — Non-randomised",
        "fullName": "Mixed Methods Appraisal Tool (2018), quantitative non-randomised studies",
        "appliesTo": "Cohort, case-control and other non-randomised quantitative studies",
        "reference": "Hong QN et al. MMAT version 2018",
        "domains": MMAT_NONRANDOMISED_DOMAINS,
        "judgements": CHECKLIST_JUDGEMENTS,
        "overallRule": (
            "Report the items rather than a score. ROBINS-I is more detailed for non-randomised "
            "studies of interventions; MMAT is the right choice when they sit in a review "
            "alongside other designs."
        ),
    },
    {
        "id": "mmat_descriptive",
        "name": "MMAT — Descriptive quantitative",
        "fullName": "Mixed Methods Appraisal Tool (2018), quantitative descriptive studies",
        "appliesTo": "Surveys, prevalence studies and other descriptive quantitative work",
        "reference": "Hong QN et al. MMAT version 2018",
        "domains": MMAT_DESCRIPTIVE_DOMAINS,
        "judgements": CHECKLIST_JUDGEMENTS,
        "overallRule": "Report the items rather than a score.",
    },
    {
        "id": "mmat_mixed",
        "name": "MMAT — Mixed methods",
        "fullName": "Mixed Methods Appraisal Tool (2018), mixed methods studies",
        "appliesTo": "Studies combining qualitative and quantitative components",
        "reference": "Hong QN et al. MMAT version 2018",
        "domains": MMAT_MIXED_DOMAINS,
        "judgements": CHECKLIST_JUDGEMENTS,
        "overallRule": (
            "Report the items rather than a score. A mixed methods study is appraised on its "
            "integration as well as on each component: strong strands that never meet are a "
            "recognised weakness, not a neutral finding."
        ),
    },
    {
        "id": "casp_qualitative",
        "name": "CASP — Qualitative",
        "fullName": "Critical Appraisal Skills Programme qualitative checklist",
        "appliesTo": "Qualitative studies",
        "reference": "CASP qualitative checklist",
        "domains": CASP_QUALITATIVE_DOMAINS,
        "judgements": CHECKLIST_JUDGEMENTS,
        "overallRule": (
            "CASP is a structured reading aid, not a scoring system, and its authors advise "
            "against using it to compute a numeric quality score or to exclude studies. Report "
            "the items and let them inform how much weight a study carries."
        ),
    },
    {
        "id": "axis",
        "name": "AXIS",
        "fullName": "Appraisal tool for Cross-Sectional Studies",
        "appliesTo": "Cross-sectional and survey studies",
        "reference": "Downes MJ et al. BMJ Open 2016;6:e011458",
        "domains": AXIS_DOMAINS,
        "judgements": CHECKLIST_JUDGEMENTS,
        "overallRule": (
            "AXIS produces no summary score by design; its authors warn that summing items "
            "weights unequal problems equally. Judge the study on which items failed — item 13 "
            "(response rate) and item 5 (sample frame) usually matter most."
        ),
    },
]

TOOLS_BY_ID = {tool["id"]: tool for tool in ROB_TOOLS}


# ── Which instrument suits which study design ────────────────────────────────
#
# The tool already knows the design the reviewer chose, so making them pick an
# instrument unaided is a question it can answer itself — and picking wrongly is
# not a small error: appraising a machine-learning model with RoB 2 produces
# five domains of "no information" about a randomisation that never happened.
#
# Ordered lists: the first entry is the instrument normally expected for that
# design, the rest are defensible alternatives.

RECOMMENDED_TOOLS: dict[str, list[str]] = {
    # Evidence synthesis — appraising other people's reviews
    "systematic_review": ["amstar2"],
    "meta_analysis": ["amstar2"],
    "network_meta_analysis": ["amstar2"],
    "scoping_review": ["amstar2"],
    "umbrella_review": ["amstar2"],
    "rapid_review": ["amstar2"],
    "integrative_review": ["amstar2"],
    "living_systematic_review": ["amstar2"],
    "qualitative_evidence_synthesis": ["amstar2", "casp_qualitative"],

    # Experimental
    "rct": ["rob2", "mmat_rct"],
    "cluster_rct": ["rob2", "mmat_rct"],
    "crossover_trial": ["rob2", "mmat_rct"],
    "stepped_wedge_trial": ["rob2", "mmat_rct"],
    "pragmatic_trial": ["rob2", "mmat_rct"],
    "pilot_feasibility": ["rob2", "mmat_rct"],
    "ai_clinical_trial": ["rob2", "mmat_rct"],
    "quasi_experimental": ["robins_i", "mmat_nonrandomised"],
    "interrupted_time_series": ["robins_i", "mmat_nonrandomised"],
    "n_of_1_trial": ["rob2"],

    # Observational
    "cohort_study": ["robins_i", "mmat_nonrandomised"],
    "case_control": ["robins_i", "mmat_nonrandomised"],
    "cross_sectional": ["axis", "mmat_descriptive"],
    "ecological_study": ["axis", "mmat_descriptive"],
    "secondary_data_analysis": ["robins_i", "mmat_nonrandomised"],

    # Qualitative
    "phenomenology": ["casp_qualitative", "mmat_qualitative"],
    "grounded_theory": ["casp_qualitative", "mmat_qualitative"],
    "ethnography": ["casp_qualitative", "mmat_qualitative"],
    "qualitative_case_study": ["casp_qualitative", "mmat_qualitative"],
    "narrative_inquiry": ["casp_qualitative", "mmat_qualitative"],
    "action_research": ["casp_qualitative", "mmat_qualitative"],
    "discourse_analysis": ["casp_qualitative", "mmat_qualitative"],
    "qualitative_descriptive": ["casp_qualitative", "mmat_qualitative"],

    # Mixed methods
    "convergent_mixed": ["mmat_mixed"],
    "explanatory_sequential": ["mmat_mixed"],
    "exploratory_sequential": ["mmat_mixed"],
    "embedded_mixed": ["mmat_mixed"],
    "multiphase_mixed": ["mmat_mixed"],

    # Specialised
    "diagnostic_accuracy": ["quadas2"],
    "prediction_model": ["probast"],
    "ai_model_study": ["probast"],
    "survey_study": ["axis", "mmat_descriptive"],
    "implementation_study": ["robins_i", "mmat_mixed"],
    "quality_improvement": ["robins_i", "mmat_nonrandomised"],
}


# ── Designs with no validated instrument ─────────────────────────────────────
#
# Several research designs simply have no published, validated risk-of-bias
# instrument. Offering one anyway would be the worst outcome: a reviewer would
# cite an instrument that does not cover their work, and readers would take the
# rating at face value.
#
# So these designs get named quality concerns instead — the things a reviewer or
# examiner in that field actually asks about — presented explicitly as an
# informal checklist that must not be cited as a validated appraisal.

APPRAISAL_GUIDANCE: dict[str, dict] = {
    "ai_model_study": {
        "note": (
            "PROBAST covers AI/ML models used for prediction. For benchmark or ablation studies "
            "that predict nothing about a population, no validated risk-of-bias instrument "
            "exists; the concerns below are what reviewers in the field raise instead."
        ),
        "concerns": [
            "Data leakage: did any evaluation data take part in feature selection, "
            "hyperparameter tuning or model selection?",
            "Benchmark contamination: could the test set have appeared in pre-training data?",
            "Baseline fairness: were comparison methods tuned with the same effort as the "
            "proposed one, or taken from a paper at their default settings?",
            "Multiple runs: is performance reported over several seeds with variance, or from a "
            "single favourable run?",
            "Reporting completeness: are the search space, compute budget and number of trials "
            "reported, or only the winning configuration?",
            "Reproducibility: are code, trained weights, data splits and random seeds available?",
            "Construct validity: does the benchmark measure the capability being claimed?",
        ],
    },
    "usability_study": {
        "note": (
            "Usability and HCI evaluation has reporting conventions but no validated "
            "risk-of-bias instrument. These are the concerns reviewers raise."
        ),
        "concerns": [
            "Participant representativeness: were participants drawn from the intended user "
            "population, or from a convenience sample of students and colleagues?",
            "Sample size and saturation: was the number of participants justified?",
            "Task ecological validity: were tasks representative of real use, or constructed to "
            "suit the interface?",
            "Comparator: was the system compared against a realistic alternative or against "
            "nothing?",
            "Evaluator independence: were the evaluators the designers of the system?",
            "Instrument validity: were standard measures (SUS, NASA-TLX) used as validated, or "
            "modified without revalidation?",
            "Order and learning effects: were task and condition orders counterbalanced?",
        ],
    },
    "design_science": {
        "note": (
            "Design science research is evaluated against methodological frameworks (Hevner's "
            "guidelines, Peffers' DSRM) rather than a risk-of-bias instrument."
        ),
        "concerns": [
            "Problem relevance: is the problem demonstrated to matter, with evidence?",
            "Rigour of the design process: is the artefact grounded in an explicit knowledge base?",
            "Evaluation adequacy: is the artefact evaluated against stated criteria in a "
            "realistic setting, rather than demonstrated on an example?",
            "Independence of evaluation: was the artefact evaluated by anyone other than its "
            "creators?",
            "Contribution clarity: is the design knowledge generalised beyond the single "
            "artefact?",
            "Iteration transparency: are failed design iterations reported, or only the final "
            "artefact?",
        ],
    },
    "simulation_study": {
        "note": (
            "Simulation studies are appraised against the ADEMP reporting structure rather than "
            "a validated risk-of-bias instrument."
        ),
        "concerns": [
            "Aims: are the estimands and the questions the simulation answers stated in advance?",
            "Data-generating mechanism: is it fully specified and justified, and does it "
            "represent conditions where the method might fail as well as succeed?",
            "Number of repetitions: is it justified, with Monte Carlo standard errors reported?",
            "Performance measures: are bias, coverage and precision reported, not only one "
            "favourable measure?",
            "Comparator methods: are competing methods implemented fairly and at their best?",
            "Reproducibility: is the simulation code and seed available?",
        ],
    },
    "delphi_study": {
        "note": (
            "Delphi studies are reported against ACCORD/CREDES guidance; no validated "
            "risk-of-bias instrument exists."
        ),
        "concerns": [
            "Panel selection: how were experts defined and chosen, and is the panel balanced?",
            "Panel size and attrition: how many took part in each round and how many dropped out?",
            "Consensus definition: was the threshold for consensus set in advance?",
            "Number of rounds: was it pre-specified, or stopped once agreement appeared?",
            "Feedback between rounds: what were panellists shown, and could it have anchored "
            "them?",
            "Anonymity: were panellists anonymous to one another?",
            "Item generation: where did the initial items come from?",
        ],
    },
    "instrument_validation": {
        "note": (
            "Instrument development and validation is appraised with COSMIN, a full "
            "methodological standard rather than a short risk-of-bias tool."
        ),
        "concerns": [
            "Content validity: was item development grounded in the target population?",
            "Structural validity: was factor structure tested with an adequate sample?",
            "Internal consistency and reliability: reported with confidence intervals?",
            "Construct validity: were hypotheses about relationships specified before testing?",
            "Responsiveness and measurement error: assessed where the instrument is meant to "
            "detect change?",
            "Sample adequacy: was the sample large enough for the psychometric analyses run?",
        ],
    },
    "economic_evaluation": {
        "note": (
            "Economic evaluations are appraised with the CHEC-list or the Drummond checklist "
            "and reported against CHEERS."
        ),
        "concerns": [
            "Perspective: is the analytic viewpoint stated and appropriate to the decision?",
            "Time horizon: long enough to capture all relevant costs and effects?",
            "Discounting: applied and justified for both costs and outcomes?",
            "Effectiveness data: from a credible source, and is its own risk of bias considered?",
            "Sensitivity analysis: were key parameters varied, including structural assumptions?",
            "Funding and conflicts: is the sponsor's interest in the result declared?",
        ],
    },
    "case_report": {
        "note": (
            "Case reports and small case series are reported against CARE. They sit at the "
            "bottom of most evidence hierarchies by design, and no risk-of-bias instrument "
            "changes that."
        ),
        "concerns": [
            "Selection: why was this case reported — is it typical or exceptional?",
            "Completeness: is the clinical timeline reported in enough detail to follow?",
            "Alternative explanations: were other causes considered and ruled out?",
            "Generalisability: is any general claim made that a single case cannot support?",
        ],
    },
    "narrative_review": {
        "note": (
            "Narrative and critical reviews have no systematic search or appraisal step, so "
            "AMSTAR 2 does not apply. SANRA offers a light quality scale."
        ),
        "concerns": [
            "Search transparency: is any account given of how literature was found?",
            "Selection bias: could the cited work have been chosen to support a position?",
            "Currency: how recent is the most recent work cited?",
            "Author positioning: are the authors' own studies disproportionately cited?",
        ],
    },
}

# Designs sharing another design's guidance verbatim.
APPRAISAL_GUIDANCE["case_series"] = APPRAISAL_GUIDANCE["case_report"]
APPRAISAL_GUIDANCE["mapping_review"] = APPRAISAL_GUIDANCE["narrative_review"]
APPRAISAL_GUIDANCE["realist_review"] = APPRAISAL_GUIDANCE["narrative_review"]


def recommend_for_design(design_id: str) -> dict:
    """Instruments suited to one study design, plus guidance where none is."""
    tool_ids = RECOMMENDED_TOOLS.get(design_id, [])
    return {
        "designId": design_id,
        "recommended": [TOOLS_BY_ID[t] for t in tool_ids if t in TOOLS_BY_ID],
        "guidance": APPRAISAL_GUIDANCE.get(design_id),
    }

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


@router.get("/rob/recommend/{design_id}")
def recommend_tools(design_id: str) -> dict:
    """Which instrument suits this study design — and honesty when none does."""
    return recommend_for_design(design_id)


@router.get("/rob/tools/{tool_id}")
def get_rob_tool(tool_id: str) -> dict:
    tool = TOOLS_BY_ID.get(tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Unknown appraisal tool: {tool_id}")
    return tool
