"""
Canonical catalog of study designs.

Each design carries:
- id / name / category / hint       → shown in the UI as a fixed enum
- guideline                          → the reporting guideline that dictates the paper framework
- sections                           → the canonical paper skeleton (name + note). The LLM never
                                       invents sections; it only fills topic-specific outline
                                       content under these fixed titles.
"""

def _s(name: str, note: str) -> dict:
    return {"name": name, "note": note}


# ── Shared framework bases ─────────────────────────────────────────────────────

PRISMA_SECTIONS = [
    _s("Introduction", "rationale in context of existing evidence; explicit objectives (PICO/PCC); research question"),
    _s("Methods", "eligibility criteria; information sources; full search strategy; study selection process; data extraction; risk-of-bias / quality appraisal; synthesis methods; registration (e.g. PROSPERO)"),
    _s("Results", "PRISMA flow diagram; characteristics of included studies; risk-of-bias results; synthesis findings per outcome/theme"),
    _s("Discussion", "summary of evidence; certainty of evidence; limitations at study and review level; comparison with prior reviews"),
    _s("Conclusions", "answer to the review question; implications for practice, policy, and research"),
    _s("Declarations", "registration; protocol deviations; funding; conflicts of interest; data availability"),
]

CONSORT_SECTIONS = [
    _s("Introduction", "scientific background; explicit rationale; objectives and hypotheses; research question"),
    _s("Methods", "trial design and allocation ratio; participants and settings; interventions per arm; primary/secondary outcomes; sample size calculation; randomisation and allocation concealment; blinding; statistical methods"),
    _s("Results", "participant flow (CONSORT diagram); recruitment and baseline data; numbers analysed (ITT); outcomes and effect estimation with precision; harms"),
    _s("Discussion", "interpretation consistent with results; trial limitations; generalisability; comparison with existing evidence"),
    _s("Conclusions", "trial's answer to the objectives; clinical and research implications"),
    _s("Declarations", "trial registration; protocol access; funding; conflicts of interest"),
]

STROBE_SECTIONS = [
    _s("Introduction", "scientific background and rationale; specific objectives and any prespecified hypotheses; research question"),
    _s("Methods", "study design; setting and dates; participants and eligibility; variables (exposures, outcomes, confounders); data sources and measurement; bias; study size; statistical methods"),
    _s("Results", "participant numbers and flow; descriptive data; outcome data; main results with adjusted estimates; other analyses"),
    _s("Discussion", "key results; limitations (bias, imprecision); interpretation; generalisability"),
    _s("Conclusions", "answer to the study objectives; implications for practice and research"),
]

QUAL_SECTIONS = [
    _s("Introduction", "phenomenon of interest; theoretical/epistemological positioning; research question and aims"),
    _s("Methods", "methodological approach and justification; researcher characteristics and reflexivity; sampling and recruitment; data collection; analysis approach; trustworthiness strategies; ethics"),
    _s("Findings", "themes/categories with supporting participant quotations; analytic narrative"),
    _s("Discussion", "findings in relation to existing literature and theory; transferability; strengths and limitations"),
    _s("Conclusions", "essence of what was learned; implications for practice, education, and research"),
]

MIXED_SECTIONS = [
    _s("Introduction", "rationale for the topic AND for mixing methods; research questions per strand and mixed-methods question"),
    _s("Methods", "mixed-methods design and priority/timing; quantitative strand (sample, measures, analysis); qualitative strand (sampling, data collection, analysis); integration strategy and joint displays"),
    _s("Quantitative Results", "quantitative findings for each measure/outcome"),
    _s("Qualitative Findings", "themes with quotations"),
    _s("Integrated Results", "merged/connected findings; joint display; convergence, divergence, expansion"),
    _s("Discussion", "meta-inferences; limitations of each strand and of integration"),
    _s("Conclusions", "combined answer to the mixed-methods question; implications"),
]


def _prisma_variant(intro_extra: str, methods_extra: str, results_extra: str) -> list[dict]:
    base = [dict(x) for x in PRISMA_SECTIONS]
    base[0]["note"] += f"; {intro_extra}" if intro_extra else ""
    base[1]["note"] += f"; {methods_extra}" if methods_extra else ""
    base[2]["note"] += f"; {results_extra}" if results_extra else ""
    return base


def _consort_variant(methods_extra: str, results_extra: str = "") -> list[dict]:
    base = [dict(x) for x in CONSORT_SECTIONS]
    base[1]["note"] += f"; {methods_extra}" if methods_extra else ""
    if results_extra:
        base[2]["note"] += f"; {results_extra}"
    return base


def _qual_variant(methods_extra: str, findings_note: str = "") -> list[dict]:
    base = [dict(x) for x in QUAL_SECTIONS]
    base[1]["note"] += f"; {methods_extra}" if methods_extra else ""
    if findings_note:
        base[2]["note"] = findings_note
    return base


# ── The catalog ────────────────────────────────────────────────────────────────

STUDY_DESIGN_CATALOG: list[dict] = [

    # ═══ Evidence Synthesis (secondary research) ═══
    {"id": "systematic_review", "name": "Systematic Review", "category": "Evidence Synthesis",
     "guideline": "PRISMA 2020",
     "hint": "Comprehensive synthesis of existing evidence with formal quality appraisal",
     "sections": PRISMA_SECTIONS},

    {"id": "meta_analysis", "name": "Meta-Analysis", "category": "Evidence Synthesis",
     "guideline": "PRISMA 2020",
     "hint": "Statistical pooling of quantitative effect sizes across studies",
     "sections": _prisma_variant("", "effect measures; heterogeneity assessment (I²); meta-analytic model; publication bias assessment", "forest plots; pooled estimates; subgroup and sensitivity analyses; funnel plot")},

    {"id": "network_meta_analysis", "name": "Network Meta-Analysis", "category": "Evidence Synthesis",
     "guideline": "PRISMA-NMA",
     "hint": "Simultaneous comparison of multiple interventions via direct and indirect evidence",
     "sections": _prisma_variant("", "network geometry; transitivity assumption; consistency assessment", "network diagram; league table; ranking (SUCRA); inconsistency results")},

    {"id": "scoping_review", "name": "Scoping Review", "category": "Evidence Synthesis",
     "guideline": "PRISMA-ScR",
     "hint": "Mapping the breadth of evidence on a topic without quality appraisal",
     "sections": _prisma_variant("clarify that objective is mapping concepts/evidence types (PCC framework)", "charting process instead of extraction; no risk-of-bias appraisal (state why)", "evidence maps/tables by concept, population, and context; identified gaps")},

    {"id": "umbrella_review", "name": "Umbrella Review", "category": "Evidence Synthesis",
     "guideline": "PRIOR",
     "hint": "Review of existing systematic reviews",
     "sections": _prisma_variant("justify need for overview of reviews", "overlap management between reviews (CCA); AMSTAR-2 appraisal of included reviews", "summary of review-level findings; overlap matrix; certainty across reviews")},

    {"id": "rapid_review", "name": "Rapid Review", "category": "Evidence Synthesis",
     "guideline": "PRISMA-RR / Cochrane RR",
     "hint": "Accelerated evidence synthesis with streamlined methods",
     "sections": _prisma_variant("policy/decision urgency driving the rapid timeline", "explicitly justify each methodological shortcut (single screener, date limits, etc.)", "findings with caveats attributable to abbreviated methods")},

    {"id": "integrative_review", "name": "Integrative Review", "category": "Evidence Synthesis",
     "guideline": "Whittemore & Knafl",
     "hint": "Synthesis of quantitative, qualitative, and theoretical literature together",
     "sections": _prisma_variant("scope covering empirical and theoretical sources", "constant-comparison synthesis across heterogeneous designs", "integrated conceptual findings; emerging framework")},

    {"id": "narrative_review", "name": "Narrative / Critical Review", "category": "Evidence Synthesis",
     "guideline": "SANRA",
     "hint": "Expert-led narrative synthesis of a field",
     "sections": [
         _s("Introduction", "importance of the topic; aims of the review; scope boundaries"),
         _s("Literature Search Approach", "how sources were identified (transparent even if not systematic)"),
         _s("Thematic Discussion", "organised by conceptual themes/debates, each critically appraised"),
         _s("Critical Appraisal & Gaps", "strengths and weaknesses of the field; contested areas"),
         _s("Conclusions & Future Directions", "synthesis of state of knowledge; research agenda"),
     ]},

    {"id": "realist_review", "name": "Realist Review", "category": "Evidence Synthesis",
     "guideline": "RAMESES I",
     "hint": "What works, for whom, under what circumstances, and why (CMO configurations)",
     "sections": [
         _s("Introduction", "policy/practice problem; rationale for realist approach; initial programme theory"),
         _s("Methods", "scoping the literature; search and appraisal (relevance & rigour); data extraction; realist synthesis logic"),
         _s("Findings: Programme Theory", "refined context-mechanism-outcome (CMO) configurations with supporting evidence"),
         _s("Discussion", "implications of the programme theory; comparison with substantive theory; limitations"),
         _s("Conclusions & Recommendations", "actionable, context-sensitive recommendations"),
     ]},

    {"id": "qualitative_evidence_synthesis", "name": "Qualitative Evidence Synthesis / Meta-synthesis", "category": "Evidence Synthesis",
     "guideline": "ENTREQ / eMERGe",
     "hint": "Synthesis of qualitative studies (e.g. meta-ethnography, thematic synthesis)",
     "sections": [
         _s("Introduction", "phenomenon of interest; rationale for synthesising qualitative evidence; question (SPIDER/PICo)"),
         _s("Methods", "synthesis methodology (meta-ethnography, thematic synthesis…); search; appraisal (CASP); extraction; translation/synthesis process; reflexivity"),
         _s("Results", "descriptive themes and analytic (third-order) constructs with supporting primary quotations"),
         _s("Discussion", "line-of-argument synthesis; confidence in findings (GRADE-CERQual); limitations"),
     ]},

    {"id": "mapping_review", "name": "Systematic Mapping / Bibliometric Review", "category": "Evidence Synthesis",
     "guideline": "PRISMA (adapted)",
     "hint": "Quantitative mapping of research activity, trends, and clusters",
     "sections": [
         _s("Introduction", "field to be mapped; mapping questions (volume, trends, clusters)"),
         _s("Methods", "database selection; query construction; bibliometric/mapping techniques (co-citation, keyword co-occurrence)"),
         _s("Results", "publication trends; influential works/authors/venues; thematic clusters and maps"),
         _s("Discussion", "interpretation of the research landscape; underexplored areas"),
     ]},

    {"id": "living_systematic_review", "name": "Living Systematic Review", "category": "Evidence Synthesis",
     "guideline": "PRISMA + LSR guidance",
     "hint": "Continually updated systematic review for fast-moving evidence",
     "sections": _prisma_variant("justify need for continual updating (rapidly evolving evidence)", "update frequency; triggers for re-synthesis; version control", "current-version findings; changes since previous version")},

    # ═══ Experimental / Interventional ═══
    {"id": "rct", "name": "Randomised Controlled Trial (RCT)", "category": "Experimental",
     "guideline": "CONSORT 2010",
     "hint": "Gold standard for causal efficacy; parallel-group or factorial",
     "sections": CONSORT_SECTIONS},

    {"id": "cluster_rct", "name": "Cluster RCT", "category": "Experimental",
     "guideline": "CONSORT-Cluster",
     "hint": "Randomisation of groups (wards, clinics, schools) rather than individuals",
     "sections": _consort_variant("rationale for cluster design; ICC and design effect in sample size; cluster-level randomisation", "cluster and individual flow; analysis accounting for clustering")},

    {"id": "crossover_trial", "name": "Crossover Trial", "category": "Experimental",
     "guideline": "CONSORT-Crossover",
     "hint": "Each participant receives all interventions in sequence",
     "sections": _consort_variant("period and sequence design; washout; carryover assessment", "period and sequence effects")},

    {"id": "stepped_wedge_trial", "name": "Stepped-Wedge Trial", "category": "Experimental",
     "guideline": "CONSORT-SW",
     "hint": "Sequential rollout of the intervention across clusters over time",
     "sections": _consort_variant("stepped rollout schedule; rationale (ethics/logistics); time-effect modelling", "results by step and calendar time")},

    {"id": "pragmatic_trial", "name": "Pragmatic Trial", "category": "Experimental",
     "guideline": "CONSORT-Pragmatic",
     "hint": "Effectiveness under real-world conditions",
     "sections": _consort_variant("PRECIS-2 positioning; broad eligibility; usual-care comparator; real-world settings", "applicability of findings to routine practice")},

    {"id": "pilot_feasibility", "name": "Pilot / Feasibility Study", "category": "Experimental",
     "guideline": "CONSORT-Pilot",
     "hint": "Testing feasibility before a definitive trial",
     "sections": _consort_variant("feasibility objectives (recruitment, retention, acceptability) — NOT efficacy; progression criteria", "feasibility outcomes against progression criteria; no efficacy claims")},

    {"id": "quasi_experimental", "name": "Quasi-Experimental Study", "category": "Experimental",
     "guideline": "TREND",
     "hint": "Intervention evaluation without randomisation (e.g. pre-post with comparison group)",
     "sections": [
         _s("Introduction", "background; why randomisation was not possible; objectives"),
         _s("Methods", "assignment mechanism; comparison condition; participants; outcomes; confounding-control strategy (matching, DiD, propensity scores); statistical methods"),
         _s("Results", "participant flow; baseline comparability; adjusted intervention effects; sensitivity analyses"),
         _s("Discussion", "causal-inference threats (selection, maturation, history); interpretation; generalisability"),
     ]},

    {"id": "interrupted_time_series", "name": "Interrupted Time Series", "category": "Experimental",
     "guideline": "TREND / ITS extensions",
     "hint": "Level and slope change around a policy/intervention point",
     "sections": [
         _s("Introduction", "intervention/policy and expected mechanism; objectives"),
         _s("Methods", "data points before/after; segmented regression model; autocorrelation handling; sensitivity analyses"),
         _s("Results", "time-series plot; level and slope change estimates with CIs"),
         _s("Discussion", "co-interventions and secular trends as threats; interpretation"),
     ]},

    {"id": "n_of_1_trial", "name": "N-of-1 Trial", "category": "Experimental",
     "guideline": "CENT",
     "hint": "Multi-period crossover within a single patient",
     "sections": _consort_variant("single-participant rationale; number of periods and pairs; washout", "within-patient effect estimates across periods")},

    # ═══ Observational ═══
    {"id": "cohort_study", "name": "Cohort Study", "category": "Observational",
     "guideline": "STROBE",
     "hint": "Following exposed and unexposed groups over time (prospective or retrospective)",
     "sections": STROBE_SECTIONS},

    {"id": "case_control", "name": "Case-Control Study", "category": "Observational",
     "guideline": "STROBE",
     "hint": "Comparing exposure history between cases and controls",
     "sections": [dict(x) if i != 1 else _s("Methods", x["note"] + "; case definition and ascertainment; control selection and matching rationale") for i, x in enumerate(STROBE_SECTIONS)]},

    {"id": "cross_sectional", "name": "Cross-Sectional Study", "category": "Observational",
     "guideline": "STROBE",
     "hint": "Prevalence and associations at a single time point",
     "sections": STROBE_SECTIONS},

    {"id": "ecological_study", "name": "Ecological Study", "category": "Observational",
     "guideline": "STROBE (adapted)",
     "hint": "Group-level exposure-outcome analysis",
     "sections": [dict(x) if i != 3 else _s("Discussion", x["note"] + "; ecological fallacy as key limitation") for i, x in enumerate(STROBE_SECTIONS)]},

    {"id": "case_report", "name": "Case Report", "category": "Observational",
     "guideline": "CARE",
     "hint": "Detailed account of a single notable clinical case",
     "sections": [
         _s("Introduction", "why this case is novel or instructive; brief literature context"),
         _s("Patient Information & Clinical Findings", "de-identified demographics; history; examination findings"),
         _s("Timeline & Diagnostic Assessment", "chronology; diagnostic methods and reasoning; differential diagnosis"),
         _s("Therapeutic Intervention & Outcomes", "treatment; follow-up; adherence; adverse events"),
         _s("Discussion", "comparison with literature; take-away lessons; patient perspective and consent"),
     ]},

    {"id": "case_series", "name": "Case Series", "category": "Observational",
     "guideline": "CARE (adapted) / PROCESS",
     "hint": "Consecutive cases sharing a condition or intervention",
     "sections": [
         _s("Introduction", "condition/intervention of interest; why a series is informative"),
         _s("Methods", "case selection criteria; consecutive sampling; data collected per case"),
         _s("Results", "case summary table; patterns across cases"),
         _s("Discussion", "hypotheses generated; no causal claims; limitations of uncontrolled design"),
     ]},

    # ═══ Qualitative ═══
    {"id": "phenomenology", "name": "Phenomenological Study", "category": "Qualitative",
     "guideline": "COREQ / SRQR",
     "hint": "Lived experience and its essential meaning",
     "sections": _qual_variant("descriptive vs interpretive (IPA) stance; bracketing; in-depth interviews", "essential themes of the lived experience with verbatim excerpts")},

    {"id": "grounded_theory", "name": "Grounded Theory Study", "category": "Qualitative",
     "guideline": "COREQ / SRQR",
     "hint": "Generating theory from data through constant comparison",
     "sections": _qual_variant("theoretical sampling; open/axial/selective coding; memo-writing; saturation", "emergent theory: core category, related categories, and their relationships")},

    {"id": "ethnography", "name": "Ethnographic Study", "category": "Qualitative",
     "guideline": "COREQ / SRQR",
     "hint": "Culture and practices observed in natural settings",
     "sections": _qual_variant("fieldwork duration and access; participant observation; field notes; insider/outsider position", "thick description of cultural patterns and practices")},

    {"id": "qualitative_case_study", "name": "Case Study (Qualitative)", "category": "Qualitative",
     "guideline": "Yin / Stake frameworks",
     "hint": "In-depth bounded case(s) with multiple evidence sources",
     "sections": [
         _s("Introduction", "case(s) and boundaries; single vs multiple case rationale; propositions/research question"),
         _s("Methods", "case selection logic; data sources triangulation (interviews, documents, observation); analytic strategy (pattern matching, cross-case synthesis)"),
         _s("Case Description & Findings", "within-case narrative; cross-case patterns if multiple"),
         _s("Discussion", "analytic generalisation to theory; rival explanations; limitations"),
     ]},

    {"id": "narrative_inquiry", "name": "Narrative Inquiry", "category": "Qualitative",
     "guideline": "SRQR",
     "hint": "Individual stories as the unit of analysis",
     "sections": _qual_variant("narrative interviews; restorying; temporality-sociality-place dimensions", "participants' storied accounts and narrative threads")},

    {"id": "action_research", "name": "Action Research / Participatory Research", "category": "Qualitative",
     "guideline": "SRQR (adapted)",
     "hint": "Iterative change cycles co-designed with stakeholders",
     "sections": [
         _s("Introduction", "practice problem; participatory rationale; stakeholders"),
         _s("Methods", "action research cycles (plan-act-observe-reflect); co-researcher roles; data per cycle; ethics of insider research"),
         _s("Findings by Cycle", "what changed in each cycle and evidence for it"),
         _s("Discussion", "practical and theoretical contributions; sustainability of change; rigor and reflexivity"),
     ]},

    {"id": "discourse_analysis", "name": "Discourse / Conversation Analysis", "category": "Qualitative",
     "guideline": "SRQR (adapted)",
     "hint": "How language constructs meaning and social action",
     "sections": _qual_variant("analytic tradition (CA, CDA, Foucauldian); corpus construction; transcription conventions", "discursive patterns/devices with annotated extracts")},

    {"id": "qualitative_descriptive", "name": "Qualitative Descriptive Study", "category": "Qualitative",
     "guideline": "COREQ / SRQR",
     "hint": "Straightforward thematic description of a phenomenon",
     "sections": _qual_variant("pragmatic descriptive stance; semi-structured interviews/focus groups; thematic or content analysis", "themes with supporting quotations, staying close to the data")},

    # ═══ Mixed Methods ═══
    {"id": "convergent_mixed", "name": "Convergent Mixed Methods", "category": "Mixed Methods",
     "guideline": "GRAMMS",
     "hint": "Quant and qual collected in parallel, then merged",
     "sections": MIXED_SECTIONS},

    {"id": "explanatory_sequential", "name": "Explanatory Sequential Mixed Methods", "category": "Mixed Methods",
     "guideline": "GRAMMS",
     "hint": "Quantitative first, qualitative follow-up explains the numbers",
     "sections": [dict(x) if i != 1 else _s("Methods", x["note"] + "; explain how quant results shaped qual sampling and questions") for i, x in enumerate(MIXED_SECTIONS)]},

    {"id": "exploratory_sequential", "name": "Exploratory Sequential Mixed Methods", "category": "Mixed Methods",
     "guideline": "GRAMMS",
     "hint": "Qualitative first, then quantitative testing/generalisation",
     "sections": [dict(x) if i != 1 else _s("Methods", x["note"] + "; explain how qual findings informed instrument/variable development") for i, x in enumerate(MIXED_SECTIONS)]},

    {"id": "embedded_mixed", "name": "Embedded Mixed Methods", "category": "Mixed Methods",
     "guideline": "GRAMMS",
     "hint": "A secondary strand embedded within a primary design (e.g. qual within an RCT)",
     "sections": [dict(x) if i != 1 else _s("Methods", x["note"] + "; primary design and where the secondary strand embeds; role of embedded strand") for i, x in enumerate(MIXED_SECTIONS)]},

    {"id": "multiphase_mixed", "name": "Multiphase Mixed Methods", "category": "Mixed Methods",
     "guideline": "GRAMMS",
     "hint": "Sequential phases over a programme of research",
     "sections": [dict(x) if i != 1 else _s("Methods", x["note"] + "; phase map showing how each phase informs the next") for i, x in enumerate(MIXED_SECTIONS)]},

    # ═══ Specialised ═══
    {"id": "diagnostic_accuracy", "name": "Diagnostic Accuracy Study", "category": "Specialised",
     "guideline": "STARD 2015",
     "hint": "Sensitivity/specificity of an index test against a reference standard",
     "sections": [
         _s("Introduction", "clinical role of the index test; study objectives and hypotheses"),
         _s("Methods", "participants and setting; index test; reference standard and rationale; blinding between tests; accuracy measures; sample size"),
         _s("Results", "participant flow (STARD diagram); cross-tabulation; sensitivity/specificity/AUC with CIs; indeterminate results; adverse events"),
         _s("Discussion", "clinical applicability; comparison to alternatives; limitations"),
     ]},

    {"id": "prediction_model", "name": "Prediction Model Study", "category": "Specialised",
     "guideline": "TRIPOD",
     "hint": "Development and/or validation of a prognostic or diagnostic model",
     "sections": [
         _s("Introduction", "clinical need for prediction; existing models; development vs validation objectives"),
         _s("Methods", "data source and participants; outcome definition; candidate predictors; sample size (EPV); missing data handling; model building; performance measures (discrimination, calibration); validation strategy"),
         _s("Results", "participant characteristics; final model specification; performance with CIs; calibration plot"),
         _s("Discussion", "clinical usability; comparison with existing models; limitations; next validation steps"),
         _s("Supplementary Information", "full model equation; code/data availability"),
     ]},

    {"id": "ai_model_study", "name": "AI / Machine Learning Model Study", "category": "Specialised",
     "guideline": "TRIPOD+AI / DECIDE-AI",
     "hint": "Development or early clinical evaluation of an AI/ML model",
     "sections": [
         _s("Introduction", "clinical problem and intended role of the AI model; existing approaches; objectives"),
         _s("Methods", "data sources, splits, and leakage prevention; ground-truth labelling; model architecture and tuning; performance metrics; fairness/subgroup analyses; interpretability methods"),
         _s("Results", "cohort characteristics; performance on internal/external test sets with CIs; subgroup and fairness results; explainability outputs"),
         _s("Discussion", "clinical integration pathway; generalisability across sites; ethical and regulatory considerations; limitations"),
         _s("Reproducibility Statement", "code, model, and data availability; compute details"),
     ]},

    {"id": "ai_clinical_trial", "name": "Clinical Trial of an AI Intervention", "category": "Specialised",
     "guideline": "CONSORT-AI",
     "hint": "RCT where the intervention includes an AI component",
     "sections": _consort_variant("AI system version and inputs/outputs; human-AI interaction and user training; integration into clinical workflow", "AI-specific performance alongside clinical outcomes; error/failure case analysis")},

    {"id": "survey_study", "name": "Survey / Questionnaire Study", "category": "Specialised",
     "guideline": "CROSS / CHERRIES",
     "hint": "Structured self-report data from a defined population",
     "sections": [
         _s("Introduction", "constructs measured; target population; objectives"),
         _s("Methods", "questionnaire development and validation/piloting; sampling frame and strategy; administration mode; response-rate strategy; statistical analysis"),
         _s("Results", "response rate and respondent characteristics; item/scale results; subgroup comparisons"),
         _s("Discussion", "non-response and coverage bias; interpretation; implications"),
     ]},

    {"id": "delphi_study", "name": "Delphi Study", "category": "Specialised",
     "guideline": "ACCORD",
     "hint": "Structured expert consensus over iterative rounds",
     "sections": [
         _s("Introduction", "why consensus is needed; scope of statements"),
         _s("Methods", "panel selection and expertise criteria; number of rounds; consensus definition (a-priori threshold); feedback between rounds; anonymity"),
         _s("Results", "panel characteristics; round-by-round ratings; final consensus statements; items without consensus"),
         _s("Discussion", "strength of consensus; comparison with existing guidance; limitations of panel composition"),
     ]},

    {"id": "instrument_validation", "name": "Instrument Development & Validation", "category": "Specialised",
     "guideline": "COSMIN",
     "hint": "Creating and psychometrically testing a measurement scale",
     "sections": [
         _s("Introduction", "construct definition; limitations of existing instruments; objectives"),
         _s("Methods", "item generation (literature, qualitative work, expert review); content validity; sampling; psychometric testing plan (structural validity, reliability, responsiveness)"),
         _s("Results", "factor structure (EFA/CFA); internal consistency; test-retest reliability; construct validity correlations; final instrument"),
         _s("Discussion", "measurement properties against COSMIN standards; intended use; further validation needs"),
     ]},

    {"id": "economic_evaluation", "name": "Economic Evaluation", "category": "Specialised",
     "guideline": "CHEERS 2022",
     "hint": "Cost-effectiveness / cost-utility analysis of interventions",
     "sections": [
         _s("Introduction", "decision problem; comparators; perspective and audience"),
         _s("Methods", "population and setting; perspective and time horizon; discount rate; outcome measure (QALY etc.); cost measurement and valuation; model structure; uncertainty analysis plan"),
         _s("Results", "base-case incremental costs, effects, and ICER; sensitivity/scenario analyses; cost-effectiveness plane and CEAC"),
         _s("Discussion", "findings vs willingness-to-pay thresholds; generalisability across settings; limitations"),
     ]},

    {"id": "quality_improvement", "name": "Quality Improvement Study", "category": "Specialised",
     "guideline": "SQUIRE 2.0",
     "hint": "Local system change evaluated with improvement methods",
     "sections": [
         _s("Introduction", "local problem; available knowledge; rationale (theory of change); specific aims"),
         _s("Methods", "context; intervention(s) and PDSA cycles; measures (outcome, process, balancing); analysis (run/control charts); ethical considerations"),
         _s("Results", "evolution of the intervention; run/control charts over time; contextual interactions"),
         _s("Discussion", "summary; interpretation vs other improvement work; sustainability and spread; limitations"),
     ]},

    {"id": "implementation_study", "name": "Implementation Study", "category": "Specialised",
     "guideline": "StaRI",
     "hint": "Strategies for adopting evidence-based practice (incl. hybrid designs)",
     "sections": [
         _s("Introduction", "evidence-practice gap; implementation framework (CFIR, RE-AIM…); hybrid type if applicable; objectives"),
         _s("Methods", "dual strands: implementation strategy AND clinical intervention; implementation outcomes (adoption, fidelity, reach, sustainability); evaluation design"),
         _s("Results", "implementation outcomes; clinical/effectiveness outcomes; contextual moderators"),
         _s("Discussion", "what enabled/hindered implementation mapped to framework; scalability; limitations"),
     ]},

    {"id": "usability_study", "name": "Usability / HCI Evaluation Study", "category": "Specialised",
     "guideline": "ISO 9241 conventions",
     "hint": "Effectiveness, efficiency, and satisfaction of system use",
     "sections": [
         _s("Introduction", "system under test; target users and use context; evaluation questions"),
         _s("Methods", "participants and recruitment; tasks and scenarios; usability metrics (task success, time, errors, SUS); think-aloud/observation protocol; setting (lab vs field)"),
         _s("Results", "quantitative usability metrics; qualitative usability problems by severity; user satisfaction"),
         _s("Discussion", "design implications and redesign recommendations; limitations of tasks/sample"),
     ]},

    {"id": "design_science", "name": "Design Science Research", "category": "Specialised",
     "guideline": "Hevner / Peffers DSRM",
     "hint": "Building and evaluating a novel IT artifact",
     "sections": [
         _s("Introduction", "problem identification and motivation; objectives of a solution"),
         _s("Related Work & Knowledge Base", "existing artifacts and theories; the research gap the artifact fills"),
         _s("Artifact Design & Development", "design requirements; architecture; design decisions and rationale"),
         _s("Demonstration & Evaluation", "use cases; evaluation method (experiment, case study, expert review); results against requirements"),
         _s("Discussion & Contributions", "contributions to design knowledge (design principles); practical utility; limitations"),
     ]},

    {"id": "simulation_study", "name": "Simulation Study", "category": "Specialised",
     "guideline": "ADEMP (methods) / domain norms",
     "hint": "In-silico experiments (statistical methods, systems, processes)",
     "sections": [
         _s("Introduction", "question the simulation answers; why simulation rather than empirical data"),
         _s("Methods", "aims, data-generating mechanisms, estimands, methods compared, performance measures (ADEMP); number of repetitions; software"),
         _s("Results", "performance across scenarios; visualisations (nested loop plots); Monte Carlo error"),
         _s("Discussion", "practical recommendations; boundary conditions of scenarios; limitations"),
     ]},

    {"id": "secondary_data_analysis", "name": "Secondary Data / EHR Analysis", "category": "Specialised",
     "guideline": "RECORD",
     "hint": "Analysis of routinely collected data (registries, EHR, claims)",
     "sections": [
         _s("Introduction", "research question; suitability of the routine data source"),
         _s("Methods", "database description and provenance; code lists/phenotyping algorithms and validation; linkage; cleaning; confounding control; statistical methods"),
         _s("Results", "cohort derivation flow; characteristics; main and sensitivity analyses"),
         _s("Discussion", "data-quality limitations (misclassification, missingness); interpretation; generalisability"),
     ]},
]

CATALOG_BY_ID = {d["id"]: d for d in STUDY_DESIGN_CATALOG}
