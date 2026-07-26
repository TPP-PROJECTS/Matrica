import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from routers.agreement import cohens_kappa, extraction_agreement  # noqa: E402


# ── cohens_kappa ──────────────────────────────────────────────────────────────

def test_perfect_agreement_is_kappa_one():
    a = {"p1": "include", "p2": "exclude", "p3": "include"}
    r = cohens_kappa(a, dict(a))
    assert r.kappa == 1.0
    assert r.observed_agreement == 1.0
    assert r.disagreements == []
    assert r.interpretation == "almost perfect"


def test_total_disagreement_is_negative():
    a = {"p1": "include", "p2": "exclude"}
    b = {"p1": "exclude", "p2": "include"}
    r = cohens_kappa(a, b)
    assert r.kappa < 0
    assert r.interpretation == "poor"
    assert sorted(r.disagreements) == ["p1", "p2"]


def test_chance_agreement_is_discounted():
    # Both reviewers exclude 8 of 10 and agree on 8 — but a lot of that is the
    # base rate, so kappa must land well below the 0.8 raw agreement.
    a = {f"p{i}": ("exclude" if i < 8 else "include") for i in range(10)}
    b = {f"p{i}": ("exclude" if i < 7 else "include") for i in range(10)}
    b["p9"] = "exclude"
    r = cohens_kappa(a, b)
    assert r.observed_agreement > r.kappa
    assert 0 < r.kappa < r.observed_agreement


def test_only_items_both_judged_are_counted():
    # p3 is unjudged by the reviewer — it carries no opinion, so it must not
    # count as a disagreement and drag kappa down.
    a = {"p1": "include", "p2": "exclude", "p3": "include"}
    b = {"p1": "include", "p2": "exclude"}
    r = cohens_kappa(a, b)
    assert r.n == 2
    assert r.kappa == 1.0


def test_no_overlap_reports_not_enough_data():
    r = cohens_kappa({"p1": "include"}, {"p2": "exclude"})
    assert r.n == 0
    assert r.interpretation == "not enough data"


def test_single_category_used_by_both_is_reported_as_undefined():
    # Everyone excluded everything. Raw agreement is 100% and means nothing;
    # kappa is 0/0, so the result must say so rather than claim a perfect score.
    a = {f"p{i}": "exclude" for i in range(5)}
    r = cohens_kappa(a, dict(a))
    assert "undefined" in r.interpretation
    assert r.observed_agreement == 1.0


def test_interpretation_bands():
    # A 0.5-ish kappa should read "moderate" on the Landis & Koch scale.
    a = {f"p{i}": ("include" if i % 2 == 0 else "exclude") for i in range(20)}
    b = dict(a)
    for i in range(0, 20, 4):          # flip a quarter of them
        b[f"p{i}"] = "exclude" if a[f"p{i}"] == "include" else "include"
    r = cohens_kappa(a, b)
    assert r.interpretation in {"moderate", "substantial"}


# ── extraction_agreement ──────────────────────────────────────────────────────

def test_extraction_exact_match_ignores_case_and_spacing():
    owner = {"p1": {"Method": "Randomised  Controlled Trial"}}
    reviewer = {"p1": {"Method": "randomised controlled trial"}}
    [res] = extraction_agreement(owner, reviewer, ["Method"])
    assert res.matched == 1
    assert res.agreement_pct == 100.0
    assert res.discrepancies == []


def test_extraction_reports_discrepancies_for_adjudication():
    owner = {"p1": {"Sample Size": "120"}}
    reviewer = {"p1": {"Sample Size": "118"}}
    [res] = extraction_agreement(owner, reviewer, ["Sample Size"])
    assert res.matched == 0
    assert res.discrepancies == [{"paperId": "p1", "owner": "120", "reviewer": "118"}]


def test_extraction_skips_cells_only_one_side_filled():
    owner = {"p1": {"Method": "RCT"}, "p2": {"Method": "Cohort"}}
    reviewer = {"p1": {"Method": "RCT"}, "p2": {"Method": "   "}}
    [res] = extraction_agreement(owner, reviewer, ["Method"])
    assert res.n == 1               # p2 had no second opinion
    assert res.agreement_pct == 100.0


def test_extraction_of_untouched_column_is_zero_not_a_crash():
    [res] = extraction_agreement({}, {}, ["Outcome"])
    assert res.n == 0
    assert res.agreement_pct == 0.0


def test_extraction_covers_every_requested_column():
    owner = {"p1": {"A": "x"}}
    reviewer = {"p1": {"A": "x"}}
    results = extraction_agreement(owner, reviewer, ["A", "B"])
    assert [r.column for r in results] == ["A", "B"]
