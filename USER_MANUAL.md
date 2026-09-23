# Matrica — User Manual

Matrica is a research workflow and matrix-analysis tool that walks you through a structured literature review, from defining a topic to drafting a final research question. This manual explains how to use each part of the application.

> **New to Matrica?** Read [Before you start](#before-you-start) and [The interface at a glance](#the-interface-at-a-glance) first, then follow the seven steps in order.

---

## Table of contents

1. [Before you start](#before-you-start)
2. [The interface at a glance](#the-interface-at-a-glance)
3. [Reading the signals: AI badges & confidence dots](#reading-the-signals-ai-badges--confidence-dots)
4. [The seven-step workflow](#the-seven-step-workflow)
   - [Step 1 — Chat & Define Topic](#step-1--chat--define-topic)
   - [Step 2 — Matrix Initial](#step-2--matrix-initial)
   - [Step 3 — Explore & Search](#step-3--explore--search)
   - [Step 4 — Select Paper](#step-4--select-paper)
   - [Step 5 — Matrix Table](#step-5--matrix-table)
   - [Step 6 — Synthesis & Gap](#step-6--synthesis--gap)
   - [Step 7 — Final Question](#step-7--final-question)
5. [Saving, sessions & version history](#saving-sessions--version-history)
6. [Exporting your report](#exporting-your-report)
7. [Peer review](#peer-review)
8. [Tips & good practice](#tips--good-practice)
9. [FAQ & troubleshooting](#faq--troubleshooting)

---

## Before you start

- **What you need:** a modern web browser and the Matrica URL provided by whoever hosts it. No account or login is required — each browser keeps its own work locally.
- **How your work is stored:** everything you do is **auto-saved in your browser** as you go. There is no "Save" button to press. See [Saving, sessions & version history](#saving-sessions--version-history).
- **The AI:** Matrica uses an AI assistant to suggest topics, search queries, summaries, and analysis. Its suggestions are **starting points, not final answers** — you stay in control and confirm every decision. Always verify AI output against the original papers.

---

## The interface at a glance

The screen has three main areas:

| Area | Location | What it does |
| --- | --- | --- |
| **Workflow steps** | Left sidebar | The seven steps of the review. Click any step you have reached to jump to it. The current step is highlighted. |
| **Main workspace** | Centre | The content for the step you're on — chat, cards, tables, etc. |
| **Top bar** | Top | Session title, undo/redo, and access to export, version history, and peer review. |

**Top bar controls**

- **Session title** — click the title (top left, "Session title…") to rename the current review. It's filled in automatically the first time you enter a research domain.
- **Review Mode** — switch the whole app read-only. Every step you have reached stays open for reading
  and you can move between them freely, but nothing can be edited, and the "outdated step" warnings are
  hidden. Use it to read a review end to end, or to show it to someone, without risk of changing it.
- **Undo / Redo** — step backwards or forwards through your changes.
  - Undo: `⌘Z` (Ctrl+Z on Windows)
  - Redo: `⌘⇧Z` (Ctrl+Shift+Z)

You can move between steps freely once you have reached them, but the workflow is designed to be done
**in order** — later steps build on the decisions you make earlier. Going *back* to revise an earlier
step marks everything downstream of it as outdated so you know what to re-check; the work itself is
kept, and you can jump forward to any of those steps again without regenerating anything.

---

## Reading the signals: AI badges & confidence dots

Matrica marks the *origin* and *reliability* of information so you always know what to trust.

- **AI badge** — indicates the item was generated or suggested by the AI (as opposed to something you typed or added yourself). Use it as a reminder to verify.
- **Confidence dot** — a small coloured dot showing how confident the AI is in an item:

  | Dot | Level | Meaning |
  | --- | --- | --- |
  | 🟢 | **High** | Well-supported / directly extracted from source. |
  | 🟡 | **Medium** | Reasonable but check it. |
  | 🔴 | **Low** | Weak support — verify before relying on it. |
  | ⚪ | **None** | No confidence assigned / not applicable. |

Wherever you see medium or low confidence flagged (for example a banner reading *"Some underlying data is medium/low confidence"*), treat those entries as needing your review.

---

## The seven-step workflow

### Step 1 — Chat & Define Topic

**Goal:** turn a vague idea into a structured **Research Profile** through conversation.

- Chat with the **Research Assistant** in the centre panel. Describe what you want to study in plain language.
- As you talk, the assistant fills in a **Profile** panel with structured fields:
  - **Domain** — your research field (required)
  - **Population** — who or what you're studying
  - **Focus** — the specific angle or research focus (required)
  - **Method** — research method
  - **Review type** — the kind of review you're doing
- A **completeness** indicator shows how much of the profile is filled in. Aim to complete at least the required fields before moving on — the quality of every later suggestion depends on this profile.
- You can edit profile fields directly if the assistant didn't capture something correctly.

> **Tip:** The more specific your answers here, the better the AI's topic and query suggestions in later steps.

---

### Step 2 — Matrix Initial

**Goal:** decide the shape of your analysis before you collect data.

- Choose whether to **include a system comparison matrix** in addition to the literature matrix. Turn this on if you plan to compare *tools, platforms, or systems* (not just papers) side by side.
- This choice sets up the matrix structure used later in [Step 5](#step-5--matrix-table).
- If a suggestion fails to load, use **Retry**.

---

### Step 3 — Explore & Search

**Goal:** decide what the review searches for — topics *and* systems — then run the searches.

The screen is organised into **Topics / Systems**, **Queries**, and **Search Results**.

**Topics tab**
- The AI suggests topic cards grouped by type — **Population**, **Design**, **Risk**, **Review**.
- Each card shows a title, description, tags, and the AI's **rationale**.
- A **profile-match** marker tells you whether a topic came directly from your profile or was inferred.
- **Select** the topics you want to pursue. Add a **New Topic** of your own if needed.

**Systems tab**
- Matrica proposes the **systems** relevant to your profile — clinical systems, AI platforms, decision
  support tools and so on — each with a description, category and vendor.
- **Select** the ones your review appraises, **Generate more** for further suggestions, or add your own
  by name.
- A selected system is a search subject, exactly like a topic. Its queries retrieve the published
  evaluations, implementation reports and official documentation of that system, so the system review
  rests on retrievable sources rather than on what a model recalls.

**How topics and systems relate**
- **↔ Map links** works out which systems bear on which topics and draws the relation on both tabs:
  a topic card lists its **Related systems**, a system card lists its **Related topics**.
- A filled chip (●) is a strong link, an outlined one (○) a possible link. Hover either to read the
  one-sentence reason the link was made — the reason is the point, because a link you cannot judge is
  no use to you.
- It runs once on its own when both lists are populated. Press the button to redo it after you have
  added or edited topics or systems. The links are saved with the session.

**Queries**
- **Confirm** drafts search **queries** for every selected topic *and* system, each with a **quality
  score**, **priority** (high / med) and target **databases**.
- Review and refine the query text as needed; each card names the topic or system it belongs to.

**Web & documentation (grey literature)**
- Every query card carries a **+ web & documentation** switch. It is **on by default for a system
  query** and off for a topic query.
- It exists because a bibliographic database indexes journal articles, and a commercial platform's
  evidence is often somewhere else entirely: its own documentation, a vendor white paper, a
  regulator's clearance, a health service's implementation report, an industry analysis. A
  literature-only search for a system routinely returns nothing, and the system then reads as
  unstudied when it is only unindexed.
- The web search is given the system's **name and description** rather than the Boolean query — a
  string written for PubMed makes a poor web search — and journal articles are rejected from its
  results, because the databases already cover those.
- What it finds is screened like anything else, but it is marked **grey literature — web source, not
  peer-reviewed** wherever it appears, is left out of the database identification and duplicate
  figures, and is reported on PRISMA's websites/organisations line. You can also turn the source on
  for every query from the **Databases** picker.

**Search Results**
- Click **Search** on any query to fetch papers for it.
- Everything found — including the papers and pages about your systems — lands in the same pool and is
  screened in the next step.
- Set **search limits** (year, language, open access, preprints) and choose which databases to search.

---

### Step 4 — Select Paper

**Goal:** screen the search results and build your **Review List**.

The screen has three columns: **All Papers**, **Review List**, and **Excluded**.

- Define a **screening protocol** first — your **Include if** / **Exclude if** criteria — so decisions are consistent and documented.
- For each paper you can read the **AI-Generated Summary**, **Key Conclusion**, **Full Abstract**, **Publication Metadata**, and its **AI Relevance** score.
- Decide on each paper using the controls (e.g. **Add** to include, **Later** to revisit). Papers move between **All Papers**, **Review List**, and **Excluded** accordingly.
- **Filter** the paper list to focus on a subset.
- Add **notes** to papers to record your reasoning.

The papers in your **Review List** are what flow into the matrix.

---

### Step 5 — Matrix Table

**Goal:** systematically code every paper (and optionally every system) against a common set of columns.

This is the heart of Matrica. There are up to two matrices:

- **Literature Matrix** — one row per paper in your review list.
- **System Review Matrix** — one row per selected system (only if you enabled it in [Step 2](#step-2--matrix-initial)).

**Working with the matrix**
- **Columns** are the questions/attributes you're coding for. Use **Add papers to matrix** / **Add system to matrix** to populate rows, and generate or add columns to define what you're comparing.
- **Cells** hold the coded value. Each cell records not just a value but its **evidence and reasoning**:
  - **Confidence** level (high / medium / low)
  - **Evidence type** — extracted, inferred, or not available
  - **Extraction method** — verbatim, summarised, inferred, or not available
  - **Source reference** — where the value came from
  - **Verified by student** — a checkbox to mark that *you* have confirmed the cell against the source
- **Hover a cell** to reveal its **Evidence & Reasoning** and **Sources** — this is how you check the AI's work.
- If a column fails to generate, use **Retry**.

> **Source traceability is the point.** Before you rely on any AI-filled cell, open its evidence, confirm it against the paper, and tick **verified**.

---

### Step 6 — Synthesis & Gap

**Goal:** turn the coded matrix into themed analysis, and name the gap it leaves.

Synthesis and gap analysis read the same evidence, so they share one screen — and one rendering of
the matrix, at the top, rather than one each.

**The evidence matrix**
- **Every matrix column is shown**, in its original order — not just the ones the synthesis uses. The
  columns the selected theme draws on are **highlighted**: a solid blue header marked
  **★ Used by theme · AI-selected** (or **your choice** for a theme you defined), and a blue rail down
  their cells, so the confidence colouring stays readable underneath.
- Add or remove highlighted columns with the chips above the table. **Theme columns** narrows the table
  to just those; **All columns** (the default) brings the rest back.
- Shown in **Full text** by default: every cell in full, in its own box that scrolls both up/down and
  left/right, with the header row and the paper column pinned while you move. Drag the box's corner
  to make it taller.
- Switch to **Compact** for one line per cell when you want the coverage pattern of a wide schema
  rather than the wording.

**Themes and analysis blocks**
- Matrica groups your findings into **Themes**. Each theme shows how many papers it covers and a
  coverage label — **Dense**, **Moderate**, or **Sparse**.
- **Define your own** with **+ New theme**: give it a name, pick the matrix columns it draws on, and
  optionally let the AI draft its four analysis blocks from those columns. Your themes are marked
  **yours**, their coverage is computed live from the columns you chose, and regenerating the AI
  synthesis never removes them.
- Hover any theme to **rename** (✎) or **delete** (×) it. Any block can be removed with its ×, and
  **✦ Fill empty blocks** drafts whatever a theme still has empty.
- The chips above the matrix set which **columns** each theme draws from (both **Literature Matrix**
  and **System Review Matrix** columns); a linked column is marked ● in the matrix header.
- Within a theme, the AI produces **analysis blocks**:
  - **Focus** — the core focus of the theme
  - **Patterns** — regularities across papers
  - **Unclear** — contested or ambiguous points
  - **Missing** — gaps and blank spots
- Add your own angle with **Add Custom Analyst** — for example a methodological or theoretical lens
  the default blocks don't cover.
- Edit any block's text directly; citations link back to the underlying papers.
- Watch for the notice *"Some underlying data is medium/low confidence"* — it flags themes built on
  shakier cells.
- If no themes exist yet, **Generate synthesis** builds them from the matrix. Returning to this step
  later never regenerates them: your edited blocks are what you come back to.

**Schema gaps**
- **Click a column header** in the matrix to compare every paper (or system) on that one direction and
  name the gap their shared pattern, disagreement or incomparability leaves.

**Overall gap statement**
- Draft the **Overall Gap Statement** — the synthesis of what is missing that your research will
  address — or generate it from the matrix, the selected systems, the synthesis and the risk-of-bias
  appraisal, then edit it.
- Recording *why* you changed a generated statement keeps the decision journal complete.

---

### Step 7 — Final Question

**Goal:** produce a research question and a paper structure.

- Based on your **Gap Statement**, Matrica generates candidate **research questions**, marked **Recommended** or **Alternative**.
- It also proposes a **Paper Structure** / academic paper outline and a suggested **Study Design**.
- **Hover a section** of the structure to **edit, reorder, or delete** it.
- This step synthesises the whole journey into the starting scaffold for your actual paper.

---

## Saving, sessions & version history

- **Auto-save:** your work is saved automatically in your browser as you go — *"Your work is auto-saved as you go."* There's nothing to press.
- **Version history / Sessions:** open the **Sessions** drawer from the top bar to see saved sessions, switch between reviews, or start a new one. You can **delete** a session you no longer need (you'll be asked to confirm).
- **Where it lives:** work is stored **locally in the browser you're using**. It is not synced to the cloud automatically, so:
  - Don't rely on clearing browser data / incognito mode.
  - To move a review to another machine, use **Export** (below).

---

## Exporting your report

- Open **Export Report** from the top bar.
- Choose which **Sections** to include in the output.
- Export produces a report of your review — profile, matrix, synthesis, gaps, and final question — that you can share or archive.

> **Acknowledgement:** if you use Matrica in academic research, you're required to credit it in your paper. See the acknowledgement template in the project README.

---

## Peer review

Matrica can share a review with a colleague for feedback — a **critical-thinking process review**.

- Open the **Peer review** panel and choose **Invite a reviewer** to create a **review link**.
- Send the link to your reviewer; they open a dedicated reviewer workspace and leave comments on your process.
- You can **revoke** a review link at any time (it shows as **REVOKED**).
- Comments come back into your session so you can act on them.

---

## Tips & good practice

- **Invest in Step 1.** A precise Research Profile improves every downstream suggestion.
- **Trust, but verify.** Treat every AI badge as a prompt to check the source — especially cells and themes flagged medium/low confidence.
- **Use the evidence panels.** In the matrix, hover cells to confirm the AI's extraction before ticking *verified*.
- **Document your criteria.** Fill in the screening protocol (Step 4) and let it drive consistent include/exclude decisions.
- **Export regularly.** Since work is browser-local, export a copy at milestones so nothing is lost.
- **Undo is your friend.** `⌘Z` / `⌘⇧Z` reverse most actions.

---

## FAQ & troubleshooting

**My work disappeared.**
Work is stored per-browser. Make sure you're on the same browser and profile, and haven't cleared site data. Check the **Sessions** drawer to switch back to it.

**An AI suggestion failed to load.**
Use the **Retry** button on that item. If it keeps failing, it may be a temporary AI/service issue — try again shortly.

**A cell / theme is flagged low confidence.**
That's a signal, not an error. Open the evidence, check the source, and correct or verify the entry yourself.

**Can two people edit the same review at once?**
No — a session lives in one browser. Use **Peer review** to gather feedback, and **Export** to hand a review off.

**How do I start over?**
Open the **Sessions** drawer and create a new session, or delete the current one.
