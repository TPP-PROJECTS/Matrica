# Topic Generator — Policy Reference Document

**Version:** 1.0  
**Date:** 2026-05-25  
**Scope:** All AI-powered endpoints of the Topic Generator service  
**Owner:** Research AI Team

---

## Overview

This document lists every policy rule governing the Topic Generator system. Rules are enforced by the TPP Orchestration Policy Engine and are organised into three categories:

| Category | Count | Purpose |
|---|---|---|
| Input Policies | 5 | Validate and constrain data entering the system |
| Output Policies | 10 | Control and audit AI-generated responses |
| Research Ethics Policies | 9 | Uphold academic and ethical research standards |

**Enforcement levels:**

| Level | Meaning |
|---|---|
| `block` | Request is rejected; an error is returned to the caller |
| `warn` | Request proceeds; a warning flag is attached to the response |
| `log` | Request proceeds; the event is recorded for audit purposes |
| `require_approval` | Request is held pending human-in-the-loop review |

---

## Part 1 — Input Policies

Input policies apply at the request boundary, before any AI model is invoked.

---

### TG-IN-001 · Research Domain Scope Validation

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST |
| **Risk Level** | High |
| **Scope** | Project |
| **Applies To** | `/api/topics/generate-profile` |

**Rule**  
The `domain` field must identify a legitimate academic or scientific discipline. Inputs referencing entertainment, commercial marketing, or unrelated non-academic fields are rejected with HTTP 400 and a prompt to clarify the research context.

**Rationale**  
The system is purpose-built for systematic literature review scoping. Off-domain requests waste API quota, produce low-quality outputs, and may expose the system to misuse.

**Source**  
> Topic Generator Policy v1.0, Section 2.1 — Input Domain Validation (internal)

---

### TG-IN-002 · Custom Prompt Override Injection Guard

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST NOT |
| **Risk Level** | Critical |
| **Scope** | Project |
| **Applies To** | All endpoints accepting `custom_system_prompt` |

**Rule**  
The `custom_system_prompt` field is scanned for prompt-injection indicators before the request is forwarded to the AI model. Blocked patterns include: `ignore previous instructions`, `disregard your guidelines`, `you are now`, `act as`, `DAN`, and base64-encoded blobs. Detected injections are blocked and logged to the Orchestration audit trail.

**Rationale**  
Allowing unrestricted system-prompt overrides creates a vector for jailbreaking the model, bypassing all other output policies, and generating harmful or misleading academic content.

**Source**  
> Topic Generator Policy v1.0, Section 2.3 — Prompt Override Security (internal)  
> OWASP LLM Top 10 — LLM01: Prompt Injection (2023)

---

### TG-IN-003 · Topic Generation Count Cap

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST |
| **Risk Level** | Medium |
| **Scope** | Request |
| **Applies To** | `/api/topics/generate` |

**Rule**  
The `count` parameter must not exceed 20. Requests with `count > 20` are rejected with HTTP 400.

**Rationale**  
High counts create outsized per-request token costs and degrade output quality as the model distributes attention across too many topics. A cap of 20 provides sufficient coverage for any systematic review scoping session.

**Source**  
> Topic Generator Policy v1.0, Section 2.5 — Request Limits (internal)

---

### TG-IN-004 · Search Query Content Safety

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST |
| **Risk Level** | High |
| **Scope** | Request |
| **Applies To** | `/api/search` |

**Rule**  
The `query` field submitted to `/search` must not contain HTML tags, inline script fragments (`<script>`, `javascript:`), SQL operator keywords used as attack vectors (`DROP`, `SELECT *`, `UNION SELECT`), or content obviously unrelated to academic literature. Queries that appear designed to abuse the OpenAlex or PubMed APIs are blocked.

**Rationale**  
The `/search` endpoint passes the query string to external APIs. Malformed or malicious queries could trigger rate-limit bans on those services or expose the system to injection-style attacks.

**Source**  
> Topic Generator Policy v1.0, Section 2.6 — Search Safety (internal)  
> OWASP Top 10 — A03: Injection (2021)

---

### TG-IN-005 · Query Generation Batch Size Limit

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST |
| **Risk Level** | Medium |
| **Scope** | Request |
| **Applies To** | `/api/queries/generate` |

**Rule**  
The `topics` array in the request body must not exceed 10 items. Requests exceeding this limit are rejected with HTTP 400.

**Rationale**  
Each topic generates 1–2 Boolean queries. A batch of 10 topics can already produce up to 20 queries and consume significant model tokens. Larger batches produce diminishing-quality queries and risk exceeding context window limits.

**Source**  
> Topic Generator Policy v1.0, Section 2.8 — Batch Limits (internal)

---

## Part 2 — Output Policies

Output policies apply after the AI model produces a response, before it is returned to the client.

---

### TG-OUT-001 · No Fabricated Citations in AI Output

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST NOT |
| **Risk Level** | Critical |
| **Scope** | Project |
| **Applies To** | `/api/topics/reason`, `/api/synthesis`, `/api/gaps` |

**Rule**  
AI outputs must not contain specific bibliographic references (author + year + title combinations) unless those references were extracted verbatim from user-supplied abstract text. The system prompt explicitly instructs the model not to hallucinate citations. Any output flagged as containing a citation not traceable to input data must be blocked or redacted.

**Rationale**  
Fabricated citations in a systematic review context are particularly damaging: researchers may unknowingly include non-existent sources, undermining the scientific validity of their work.

**Source**  
> Topic Generator Policy v1.0, Section 3.1 — Citation Integrity (internal)  
> COPE Guidelines on Research Integrity (2022)  
> NIST AI RMF 1.0 — MEASURE 2.5 (AI-generated content trustworthiness)

---

### TG-OUT-002 · Boolean Search Query Format Compliance

| Attribute | Value |
|---|---|
| **Enforcement** | Warn |
| **Strength** | SHOULD |
| **Risk Level** | Medium |
| **Scope** | Project |
| **Applies To** | `/api/queries/generate` |

**Rule**  
Every generated search query must contain at least one Boolean operator (`AND`, `OR`, `NOT`), use parentheses for grouping compound terms, and enclose multi-word phrases in double quotes. Plain keyword lists with no Boolean structure trigger a warn flag and a suggestion to improve the query.

**Rationale**  
Academic databases (PubMed, Scopus, CINAHL) require well-formed Boolean syntax for reliable retrieval. Poorly structured queries produce recall/precision imbalances that can systematically bias a literature review.

**Source**  
> Topic Generator Policy v1.0, Section 3.2 — Query Format (internal)  
> Cochrane Handbook for Systematic Reviews of Interventions, Chapter 4 — Searching for Studies

---

### TG-OUT-003 · Confidence Score Honesty

| Attribute | Value |
|---|---|
| **Enforcement** | Warn |
| **Strength** | SHOULD |
| **Risk Level** | Medium |
| **Scope** | Project |
| **Applies To** | `/api/topics/generate-profile` |

**Rule**  
When the researcher profile has fewer than 3 of 5 fields populated (`domain`, `population`, `focus`, `method`, `reviewType`), the model must not assign `"high"` confidence to all generated topics. Outputs where every topic carries uniform `"high"` confidence despite a sparse profile are flagged at warn severity.

**Rationale**  
Uniformly high confidence on an incomplete profile is misleading; it implies certainty where the model is genuinely extrapolating, which can lead researchers to over-commit to poorly grounded topic choices.

**Source**  
> NIST AI RMF 1.0, MAP 2.3 — Communicate AI system capability and uncertainty  
> ISO/IEC 42001:2023, Clause 8.2 — AI system transparency

---

### TG-OUT-004 · Academic Tone Enforcement

| Attribute | Value |
|---|---|
| **Enforcement** | Warn |
| **Strength** | SHOULD |
| **Risk Level** | Medium |
| **Scope** | Project |
| **Applies To** | All endpoints |

**Rule**  
All AI-generated content must use formal academic language appropriate for a postgraduate research context. Outputs are flagged at warn severity if they contain: colloquialisms, casual first-person phrasing (`"I think"`, `"basically"`, `"kind of"`), emojis, or marketing-style superlatives (`"revolutionary"`, `"game-changing"`, `"unprecedented"`).

**Rationale**  
The tool's output feeds directly into formal research documents. Informal language erodes the professional credibility of those documents and may also indicate degraded model quality.

**Source**  
> Topic Generator Policy v1.0, Section 3.4 — Academic Register (internal)  
> APA Publication Manual (7th ed.) — Academic Writing Standards

---

### TG-OUT-005 · Healthcare Domain Disclaimer Requirement

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST |
| **Risk Level** | Critical |
| **Scope** | Project |
| **Applies To** | `/api/topics/generate-profile`, `/api/topics/reason`, `/api/synthesis` |

**Rule**  
When the profile `domain` contains any of: `health`, `medical`, `clinical`, `nursing`, `pharmacy`, `surgery`, `patient`, or `therapeutic` — every AI output from the listed endpoints must include the following disclaimer:

> *"This AI-generated content is for research scoping purposes only and does not constitute clinical, diagnostic, or treatment advice."*

Outputs in these domains without the disclaimer are blocked.

**Rationale**  
Healthcare AI outputs carry risk of being misinterpreted as medical guidance. Both HIPAA and the EU AI Act impose strict transparency and safety obligations on AI systems operating in healthcare contexts.

**Source**  
> HIPAA 45 CFR Part 164 — Security and Privacy  
> EU AI Act (2024) Article 52 — Transparency obligations for certain AI systems  
> Topic Generator Policy v1.0, Section 3.5 — Healthcare Safety (internal)

---

### TG-OUT-006 · AI Synthesis Output Disclaimer

| Attribute | Value |
|---|---|
| **Enforcement** | Warn |
| **Strength** | MUST |
| **Risk Level** | High |
| **Scope** | Project |
| **Applies To** | `/api/synthesis` |

**Rule**  
Every response from `/api/synthesis` must include the following statement at the beginning or end of the synthesised text:

> *"This synthesis is AI-generated from the provided abstracts and should be independently verified before inclusion in a systematic review."*

This disclaimer must not be suppressible via `custom_system_prompt`.

**Rationale**  
AI synthesis can introduce subtle errors, omissions, and misinterpretations of source abstracts. Researchers must be explicitly reminded that AI-generated synthesis is a starting point, not a final product.

**Source**  
> ISO/IEC 42001:2023, Clause 8.2 — Responsible use of AI systems  
> PRISMA 2020 Statement — Systematic Review Reporting Standards

---

### TG-OUT-007 · Gap Analysis Hedged Novelty Claims

| Attribute | Value |
|---|---|
| **Enforcement** | Warn |
| **Strength** | SHOULD NOT |
| **Risk Level** | Medium |
| **Scope** | Project |
| **Applies To** | `/api/gaps` |

**Rule**  
Gap analysis outputs must not use absolute novelty phrasing such as `"no research has ever examined"`, `"entirely unexplored"`, or `"completely absent from the literature"`. Acceptable phrasing includes `"limited evidence exists"`, `"few studies have addressed"`, or `"the current literature lacks sufficient coverage of"`. Absolute claims are downgraded at warn severity and reformulated.

**Rationale**  
An AI model with bounded context cannot make reliable absolute claims about the totality of published literature. Overstating novelty can mislead researchers and invalidate the stated justification of a review.

**Source**  
> Cochrane Handbook for Systematic Reviews, Chapter 1.3 — Identifying gaps in evidence  
> NIST AI RMF 1.0, MAP 2.3 — Communicate AI system uncertainty

---

### TG-OUT-008 · Matrix Cell Source Transparency

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST |
| **Risk Level** | High |
| **Scope** | Project |
| **Applies To** | `/api/matrix` (autofill endpoints) |

**Rule**  
The `extractionMethod` field in autofill responses must be set to `"direct_quote"` only when the cell value is verbatim or closely paraphrased from the supplied abstract. When the value is inferred, estimated, or not explicitly present in the abstract, `extractionMethod` must be `"inferred"`. Misclassifying inferred data as a direct quote is a block-level violation.

**Rationale**  
Literature review extraction matrices are primary evidence artefacts. Silently blending inference with direct quotation obscures the evidential basis of extracted data, undermining the matrix's scientific validity.

**Source**  
> PRISMA 2020 Statement — Systematic Review Reporting Standards  
> Cochrane Handbook, Chapter 5 — Collecting data  
> Topic Generator Policy v1.0, Section 3.8 — Evidence Transparency (internal)

---

### TG-OUT-009 · Research Question Specificity Standard

| Attribute | Value |
|---|---|
| **Enforcement** | Warn |
| **Strength** | SHOULD |
| **Risk Level** | Medium |
| **Scope** | Project |
| **Applies To** | `/api/final_question` |

**Rule**  
Final research questions must include at minimum: (1) a defined population or context, (2) a specific intervention, exposure, or phenomenon, and (3) a measurable outcome or comparison element. Questions such as `"How does AI affect healthcare?"` or `"What is the impact of X?"` without population and outcome specificity are flagged at warn severity with a structured reformulation suggestion.

**Rationale**  
A well-formed PICO(S) research question is a prerequisite for a valid systematic review protocol. Vague questions lead to poorly scoped searches and unreliable inclusion/exclusion decisions.

**Source**  
> Cochrane Handbook for Systematic Reviews, Chapter 2 — Defining the review question (PICO framework)  
> PROSPERO Registration Guidelines — Research Question Formulation

---

### TG-OUT-010 · Tag Academic Validity

| Attribute | Value |
|---|---|
| **Enforcement** | Warn |
| **Strength** | SHOULD |
| **Risk Level** | Medium |
| **Scope** | Project |
| **Applies To** | `/api/topics/generate-profile`, `/api/topics/generate` |

**Rule**  
Generated topic tags must be recognisable academic keywords or MeSH (Medical Subject Headings) aligned terms. Outputs where more than 50% of tags are non-academic words (e.g. `"stuff"`, `"various"`, `"things"`) or invented jargon are flagged at warn severity and subject to regeneration.

**Rationale**  
Topic tags are used downstream to construct search queries and label matrix columns. Non-academic tags degrade retrieval quality and produce nonsensical database queries.

**Source**  
> MeSH (Medical Subject Headings) — NLM Controlled Vocabulary  
> Topic Generator Policy v1.0, Section 3.10 — Keyword Quality (internal)

---

## Part 3 — Research Ethics Policies

Ethics policies reflect the obligations of a responsible AI research tool operating in an academic context. They cannot be suppressed by `custom_system_prompt` overrides.

---

### TG-ETH-001 · Research Integrity — No Plagiarism Facilitation

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST NOT |
| **Risk Level** | Critical |
| **Scope** | Project |

**Rule**  
The system must not generate content structured as a ready-to-submit thesis chapter, journal article section, or assignment answer. When a request pattern indicates intent to submit AI content as original academic work (e.g. `"write my literature review introduction"`, `"draft the methods section for my thesis"`), the system must decline and redirect the user to scoping and planning assistance only.

**Source**  
> COPE (Committee on Publication Ethics) Guidelines on Research Integrity (2022)  
> Academic Integrity Framework — institutional policy (internal)  
> UNESCO Recommendation on the Ethics of AI (2021), Principle 6: Transparency

---

### TG-ETH-002 · Dual-Use Research of Concern (DURC) Flagging

| Attribute | Value |
|---|---|
| **Enforcement** | Require Approval |
| **Strength** | MUST |
| **Risk Level** | Critical |
| **Scope** | Project |

**Rule**  
When a generated research topic involves gain-of-function research, pathogen enhancement, weaponisable biological or chemical agents, or other Dual-Use Research of Concern (DURC) categories, the output must include a mandatory advisory:

> *"This research area may fall under Dual-Use Research of Concern (DURC) guidelines. Consult your institution's biosafety committee and applicable national regulations before proceeding."*

This advisory cannot be overridden by `custom_system_prompt`.

**Source**  
> United States National Science Advisory Board for Biosecurity (NSABB), DURC Policy (2012)  
> WHO Laboratory Biosafety Manual, 4th Edition (2020)  
> EU Regulation 2017/625 — Official controls on dual-use goods

---

### TG-ETH-003 · Vulnerable Population Ethics Advisory

| Attribute | Value |
|---|---|
| **Enforcement** | Warn (log) |
| **Strength** | MUST |
| **Risk Level** | High |
| **Scope** | Project |

**Rule**  
When the `population` field or topic description identifies minors (under 18), prisoners, people with cognitive impairment, pregnant women, or refugees as the study population, the output must append:

> *"Research involving this population typically requires enhanced ethics review. Ensure your protocol addresses additional safeguards for vulnerable participants as per your institution's IRB/ethics board requirements."*

**Source**  
> The Belmont Report: Ethical Principles and Guidelines for the Protection of Human Subjects of Research (1979) — Part C: Vulnerable Subjects  
> ICH E6 (R2) Good Clinical Practice Guidelines, Section 4.8

---

### TG-ETH-004 · Animal Research Ethics (IACUC) Alert

| Attribute | Value |
|---|---|
| **Enforcement** | Warn (log) |
| **Strength** | MUST |
| **Risk Level** | High |
| **Scope** | Project |

**Rule**  
When a research topic involves animal models, in-vivo studies, or preclinical animal experiments, the output must include:

> *"Animal research requires approval from your institution's Institutional Animal Care and Use Committee (IACUC) or equivalent ethics body. Ensure your protocol addresses the 3Rs principles: Replacement, Reduction, and Refinement."*

**Source**  
> ARRIVE Guidelines 2.0 (Animal Research: Reporting of In Vivo Experiments), Percie du Sert et al., PLOS Biology (2020)  
> US Animal Welfare Act (AWA), 7 U.S.C. §§ 2131–2159  
> EU Directive 2010/63/EU on the protection of animals used for scientific purposes

---

### TG-ETH-005 · Human Subjects Research — IRB Requirement Notice

| Attribute | Value |
|---|---|
| **Enforcement** | Warn (log) |
| **Strength** | MUST |
| **Risk Level** | High |
| **Scope** | Project |

**Rule**  
When the `method` field or topic description includes qualitative interviews, surveys, randomised controlled trials (RCTs), observational cohort studies, or any primary data collection involving human participants, the system must note:

> *"Research involving human participants requires prior approval from your Institutional Review Board (IRB) or Research Ethics Committee (REC). Ensure informed consent procedures are in place."*

**Source**  
> Declaration of Helsinki — World Medical Association (2013 revision)  
> US Common Rule, 45 CFR Part 46 — Protection of Human Subjects  
> ICH E6 (R2) Good Clinical Practice, Section 2.1 — IRB/IEC approval

---

### TG-ETH-006 · Research Misconduct Prevention

| Attribute | Value |
|---|---|
| **Enforcement** | Block |
| **Strength** | MUST NOT |
| **Risk Level** | Critical |
| **Scope** | Project |

**Rule**  
The system must not assist with: cherry-picking results to support a predetermined conclusion, post-hoc hypothesis rationalisation (HARKing — Hypothesising After Results are Known), p-hacking, or selective outcome switching. When a request explicitly asks to `"find only studies that support X"`, `"exclude studies showing negative results"`, or `"adjust the hypothesis to match our findings"`, the system must refuse and explain the need for pre-registered, unbiased systematic review methodology.

**Source**  
> COPE (Committee on Publication Ethics) Guidelines on Authorship and Contributorship (2022)  
> Cochrane Handbook for Systematic Reviews, Chapter 13 — Assessing risk of bias  
> Chambers, C.D. (2013). Registered Reports. Cortex. — Addressing publication bias  
> Kerr, N.L. (1998). HARKing: Hypothesising After Results are Known. Personality and Social Psychology Review

---

### TG-ETH-007 · Conflicts of Interest Disclosure Reminder

| Attribute | Value |
|---|---|
| **Enforcement** | Warn (log) |
| **Strength** | SHOULD |
| **Risk Level** | Medium |
| **Scope** | Project |

**Rule**  
When a research topic involves evaluating a named commercial product, pharmaceutical compound, medical device, or is scoped in a way that could benefit a specific commercial entity, the output must include:

> *"Systematic reviews in this area may require explicit conflict of interest (COI) declarations. Ensure all authors disclose funding sources and relationships with relevant industry stakeholders per ICMJE guidelines."*

**Source**  
> ICMJE (International Committee of Medical Journal Editors) Recommendations for the Conduct, Reporting, Editing, and Publication of Scholarly Work in Medical Journals — Section II.A: Defining the Role of Authors  
> PRISMA 2020 Statement, Checklist Item 26 — Funding and conflicts of interest

---

### TG-ETH-008 · Indigenous Data Sovereignty (CARE Principles)

| Attribute | Value |
|---|---|
| **Enforcement** | Warn (log) |
| **Strength** | SHOULD |
| **Risk Level** | High |
| **Scope** | Project |

**Rule**  
When a research topic or population field references indigenous peoples, First Nations, Aboriginal, or Native communities, the output must append:

> *"Research involving indigenous communities or data should adhere to the CARE Principles for Indigenous Data Governance (Collective Benefit, Authority to Control, Responsibility, Ethics) and engage community partners early in the research design process."*

**Source**  
> Carroll, S.R. et al. (2020). The CARE Principles for Indigenous Data Governance. Data Science Journal, 19(1), 43.  
> UN Declaration on the Rights of Indigenous Peoples (UNDRIP), Article 31 — Right to maintain cultural heritage and traditional knowledge  
> FNIGC (First Nations Information Governance Centre) — OCAP® Principles (Ownership, Control, Access, Possession)

---

### TG-ETH-009 · Sensitive Topic Balanced Representation

| Attribute | Value |
|---|---|
| **Enforcement** | Warn |
| **Strength** | SHOULD |
| **Risk Level** | High |
| **Scope** | Project |

**Rule**  
When generated research topics or reasoning outputs address race, ethnicity, religion, gender identity, sexual orientation, or political ideology, the system must frame content neutrally, represent multiple scholarly perspectives, and avoid language that could be construed as advocating for one position. Outputs with ideologically loaded framing are flagged at warn severity.

**Source**  
> IEEE 7000-2021 — Model Process for Addressing Ethical Concerns during System Design, Clause 6.3: Value Prioritisation  
> APA Ethics Code (2017) — Principle E: Respect for People's Rights and Dignity  
> UNESCO Recommendation on the Ethics of Artificial Intelligence (2021), Principle 1: Proportionality and Do No Harm

---

## Appendix A — Regulatory Sources Quick Reference

| Reference | Full Title | Year | Relevance |
|---|---|---|---|
| HIPAA 45 CFR Part 164 | Health Insurance Portability and Accountability Act — Security and Privacy Rules | 1996/2013 | TG-OUT-005 |
| EU AI Act | Regulation (EU) 2024/1689 — Artificial Intelligence Act | 2024 | TG-OUT-005, TG-ETH-002 |
| Declaration of Helsinki | WMA Declaration of Helsinki — Ethical Principles for Medical Research | 2013 | TG-ETH-005 |
| US Common Rule | 45 CFR Part 46 — Protection of Human Subjects | 2018 | TG-ETH-005 |
| Belmont Report | Ethical Principles and Guidelines for the Protection of Human Subjects | 1979 | TG-ETH-003 |
| ICH E6 (R2) | Good Clinical Practice Guidelines | 2016 | TG-ETH-003, TG-ETH-005 |
| ARRIVE 2.0 | Animal Research: Reporting of In Vivo Experiments Guidelines | 2020 | TG-ETH-004 |
| US AWA | Animal Welfare Act, 7 U.S.C. §§ 2131–2159 | 1966/2014 | TG-ETH-004 |
| EU Directive 2010/63/EU | Protection of animals used for scientific purposes | 2010 | TG-ETH-004 |
| NSABB DURC Policy | National Science Advisory Board for Biosecurity — DURC Policy | 2012 | TG-ETH-002 |
| WHO Biosafety Manual | WHO Laboratory Biosafety Manual, 4th Edition | 2020 | TG-ETH-002 |
| COPE Guidelines | Committee on Publication Ethics — Research Integrity Guidelines | 2022 | TG-ETH-001, TG-ETH-006, TG-OUT-001 |
| NIST AI RMF 1.0 | AI Risk Management Framework | 2023 | TG-OUT-003, TG-OUT-007 |
| ISO/IEC 42001:2023 | AI Management System Standard | 2023 | TG-OUT-003, TG-OUT-006 |
| PRISMA 2020 | Preferred Reporting Items for Systematic Reviews and Meta-Analyses | 2020 | TG-OUT-006, TG-OUT-008, TG-ETH-007 |
| Cochrane Handbook | Cochrane Handbook for Systematic Reviews of Interventions, v6 | 2022 | TG-OUT-002, TG-OUT-007, TG-OUT-009, TG-ETH-006 |
| ICMJE Recommendations | International Committee of Medical Journal Editors — Publication Ethics | 2023 | TG-ETH-007 |
| CARE Principles | CARE Principles for Indigenous Data Governance | 2020 | TG-ETH-008 |
| UNDRIP | UN Declaration on the Rights of Indigenous Peoples | 2007 | TG-ETH-008 |
| IEEE 7000-2021 | Model Process for Addressing Ethical Concerns during System Design | 2021 | TG-ETH-009 |
| APA Ethics Code | American Psychological Association — Ethical Principles of Psychologists | 2017 | TG-ETH-009 |
| UNESCO AI Ethics | UNESCO Recommendation on the Ethics of Artificial Intelligence | 2021 | TG-ETH-001, TG-ETH-009 |
| OWASP LLM Top 10 | OWASP Top 10 for Large Language Model Applications | 2023 | TG-IN-002 |
| OWASP Top 10 | Open Web Application Security Project — Top 10 Web Risks | 2021 | TG-IN-004 |
| MeSH | Medical Subject Headings — NLM Controlled Vocabulary | ongoing | TG-OUT-010 |

---

## Appendix B — Policy Enforcement Summary Matrix

| ID | Title | Category | Enforcement | Risk |
|---|---|---|---|---|
| TG-IN-001 | Research Domain Scope Validation | Input | Block | High |
| TG-IN-002 | Custom Prompt Override Injection Guard | Input | Block | Critical |
| TG-IN-003 | Topic Generation Count Cap | Input | Block | Medium |
| TG-IN-004 | Search Query Content Safety | Input | Block | High |
| TG-IN-005 | Query Generation Batch Size Limit | Input | Block | Medium |
| TG-OUT-001 | No Fabricated Citations in AI Output | Output | Block | Critical |
| TG-OUT-002 | Boolean Search Query Format Compliance | Output | Warn | Medium |
| TG-OUT-003 | Confidence Score Honesty | Output | Warn | Medium |
| TG-OUT-004 | Academic Tone Enforcement | Output | Warn | Medium |
| TG-OUT-005 | Healthcare Domain Disclaimer Requirement | Output | Block | Critical |
| TG-OUT-006 | AI Synthesis Output Disclaimer | Output | Warn | High |
| TG-OUT-007 | Gap Analysis Hedged Novelty Claims | Output | Warn | Medium |
| TG-OUT-008 | Matrix Cell Source Transparency | Output | Block | High |
| TG-OUT-009 | Research Question Specificity Standard | Output | Warn | Medium |
| TG-OUT-010 | Tag Academic Validity | Output | Warn | Medium |
| TG-ETH-001 | Research Integrity — No Plagiarism Facilitation | Ethics | Block | Critical |
| TG-ETH-002 | Dual-Use Research of Concern (DURC) Flagging | Ethics | Require Approval | Critical |
| TG-ETH-003 | Vulnerable Population Ethics Advisory | Ethics | Warn (log) | High |
| TG-ETH-004 | Animal Research Ethics (IACUC) Alert | Ethics | Warn (log) | High |
| TG-ETH-005 | Human Subjects Research — IRB Requirement Notice | Ethics | Warn (log) | High |
| TG-ETH-006 | Research Misconduct Prevention | Ethics | Block | Critical |
| TG-ETH-007 | Conflicts of Interest Disclosure Reminder | Ethics | Warn (log) | Medium |
| TG-ETH-008 | Indigenous Data Sovereignty (CARE Principles) | Ethics | Warn (log) | High |
| TG-ETH-009 | Sensitive Topic Balanced Representation | Ethics | Warn | High |
