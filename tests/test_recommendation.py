"""WP3 (docs/17): the critic's checks C1–C7 decide which offered option is recommended; the plan's order is unchanged."""
from apps.api.eventflow.agents.mission import recommend


def a(rank, **verdicts):
    return {"rank": rank, "checks": [{"id": k, "passed": v} for k, v in verdicts.items()]}


ALL = dict(C1=True, C2=True, C3=True, C4=True, C5=True, C6=None, C7=True)


def test_first_option_passing_every_applicable_check():
    r = recommend([a(1, **{**ALL, "C4": False}), a(2, **ALL), a(3, **ALL)])
    assert (r["rank"], r["basis"], r["passed"], r["applicable"], r["failed"]) == (2, "all_checks", 6, 6, [])


def test_checks_that_do_not_apply_are_not_counted():
    r = recommend([a(1, C1=True, C2=True, C3=True, C4=True, C5=None, C6=None, C7=None)])
    assert r["basis"] == "all_checks" and r["applicable"] == 4


def test_goal_first_then_the_most_of_c4_to_c7():
    r = recommend([a(1, **{**ALL, "C1": False}), a(2, **{**ALL, "C4": False, "C7": False}), a(3, **{**ALL, "C5": False})])
    assert (r["rank"], r["basis"], r["failed"]) == (3, "goal_and_most", ["C5"])


def test_nothing_meets_the_goal_most_checks_wins_ties_to_plan_order():
    r = recommend([a(1, **{**ALL, "C1": False, "C4": False}), a(2, **{**ALL, "C1": False}), a(3, **{**ALL, "C1": False})])
    assert (r["rank"], r["basis"]) == (2, "most_checks")


def test_no_options_no_recommendation():
    assert recommend([]) is None
