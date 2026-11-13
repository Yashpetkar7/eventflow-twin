"""The planner's critic loop (agents/planner.py): replan when no tested plan meets the goal, record every tool
call, and never let a number or a bundle through that the simulator and the menu bounds do not back."""
import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main
from apps.api.eventflow.agents import llm as llm_mod
from apps.api.eventflow.agents import planner
from apps.api.eventflow.config import corridor
from eval.suites.plancheck import schema_ok, unfaithful_numbers

EASY = {"event_id": "gitex2025_d1", "weather": "rain"}                       # one round is enough
HARD = {"event_id": "downtown_night", "attendance": 50000}                  # no single menu bundle clears it


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "d.jsonl")
    monkeypatch.setattr(planner, "CACHE_WRITE", tmp_path / "cache")
    monkeypatch.setenv("DEMO_MODE", "live")
    monkeypatch.setattr(planner, "LLM_FACTORY", lambda: None)
    return TestClient(main.app)


def plan(client, spec, **body):
    fc = client.post("/forecast", json=spec).json()
    r = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor", **body})
    assert r.status_code == 200, r.text
    return fc, r.json()


def test_one_round_when_a_tested_plan_meets_the_goal(client):
    _, p = plan(client, EASY)
    assert p["critic"]["rounds"] == 1 and not p["critic"]["replanned"]
    assert p["critic"]["goal_met_ranks"] and p["critic"]["residual"] is None
    assert all(o["round"] == 1 for o in p["options"])
    assert [e["tool"] for e in p["trace"]].count("replan") == 0


def test_replans_until_the_goal_is_met(client):
    fc, p = plan(client, HARD)
    c = p["critic"]
    assert c["replanned"] and 2 <= c["rounds"] <= planner.MAX_ROUNDS
    assert c["goal_met_ranks"], "replanning should find a bundle that clears every station"
    assert p["options"][0]["goal_met"] and p["options"][0]["round"] >= 2      # after a replan, goal-meeting plans come first
    for o in p["options"]:
        assert o["goal_met"] == (o["summary"]["overcap_station_hours"] == 0 and not o["new_hotspots"])
        sim = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": HARD, "scope": "corridor",
                                             "interventions": o["interventions"]}).json()
        assert sim["summary"] == o["summary"]                                 # the numbers are still the simulator's
        assert not unfaithful_numbers(p["baseline_summary"], o, p["baseline_summary"]["threshold"])
    assert schema_ok(p)[0] and p["verify"]["all_matched"]
    assert len({tuple(sorted({i["type"] for i in o["interventions"]})) for o in p["options"]}) == len(p["options"])


def test_replanned_bundles_stay_inside_the_bounds(client):
    _, p = plan(client, HARD, priority="impact")
    b = corridor()["interventions"]["bounds"]
    for o in p["options"]:
        assert len(o["interventions"]) <= planner.MAX_BUNDLE
        slots = [planner._slot(i) for i in o["interventions"]]
        assert len(slots) == len(set(slots)), "two measures on the same place must be merged, never stacked"
        for iv in o["interventions"]:
            if iv["type"] == "wayfinding_redirect":
                assert iv["params"]["share"] <= b["max_redirect_share"]


def test_trace_records_every_tool_call(client):
    _, p = plan(client, HARD)
    t = p["trace"]
    assert [e["n"] for e in t] == list(range(1, len(t) + 1))
    assert t[0]["tool"] == "forecast" and t[0]["run_id"] == p["forecast_run_id"]
    assert t[-1]["tool"] == "verify_numbers" and t[-1]["data"]["all_matched"]
    sims = [e for e in t if e["tool"] == "simulate"]
    assert len(sims) == p["critic"]["simulations"]
    ids = {e["run_id"] for e in sims}
    assert all(o["sources"][0]["run_id"] in ids for o in p["options"]), "every option on screen appears in the trace"
    checks = [e for e in t if e["tool"] == "check_goal"]
    assert [e["round"] for e in checks] == list(range(1, p["critic"]["rounds"] + 1))
    assert checks[0]["data"]["verdict"] == "residual" and checks[-1]["data"]["verdict"] == "goal_met"
    assert {e["role"] for e in t} >= {"planner", "proposer", "simulator", "critic", "explainer", "verifier"}


def test_no_hotspot_means_no_plan_and_a_short_trace(client):
    _, p = plan(client, {"event_id": "gitex2025_d1"})
    assert p["options"] == [] and p["critic"]["rounds"] == 1 and not p["critic"]["goal_met_ranks"]
    assert [e["tool"] for e in p["trace"]] == ["forecast", "simulate", "diagnose", "check_goal"]


def test_goal_clearing_plan_is_always_offered(client):
    """A plan that clears the goal may cost too much to rank in the top three; the critic still puts it on offer."""
    spec = {"event_id": "gitex2025_d1", "attendance": 80000}
    _, p = plan(client, spec)
    assert p["critic"]["goal_met_ranks"] == [3] and not p["critic"]["top_meets_goal"]
    assert p["options"][2]["summary"]["overcap_station_hours"] == 0


def test_rounds_and_work_are_bounded(client, monkeypatch):
    monkeypatch.setattr(planner, "goal_met", lambda o: False)                 # a goal nothing can meet
    _, p = plan(client, HARD)
    assert p["critic"]["rounds"] <= planner.MAX_ROUNDS
    assert p["critic"]["simulations"] <= 1 + 12 + planner.MAX_SIMS_PER_ROUND * (planner.MAX_ROUNDS - 1)
    assert p["critic"]["goal_met_ranks"] == [] and p["critic"]["residual"] is not None


def test_intensify_and_combine():
    b, cap = corridor()["interventions"]["bounds"], corridor()["capacity"]
    way = {"type": "wayfinding_redirect", "params": {"from_station": "WTC", "to_station": "EMT", "share": 0.25, "hours": [17]}}
    trains = {"type": "extra_trains", "params": {"headway_min": 3, "hours": [17, 18], "line": "Red"}}
    strong = planner.intensify([way, trains])
    assert strong[0]["params"]["share"] == b["max_redirect_share"] and strong[1]["params"]["headway_min"] == cap["min_headway_min"]
    assert way["params"]["share"] == 0.25, "the input bundle is not changed"
    way2 = {"type": "wayfinding_redirect", "params": {"from_station": "WTC", "to_station": "EMT", "share": 0.35, "hours": [18]}}
    both = planner.combine([way, trains], [way2])
    assert len(both) == 2 and both[0]["params"] == {"from_station": "WTC", "to_station": "EMT", "share": 0.35, "hours": [17, 18]}


class Fake:
    model, provider = "fake-model", "openai"

    def __init__(self):
        self.users = []

    def complete_json(self, *, system, user, schema, effort, max_tokens):
        self.users.append(user)
        if schema is llm_mod.PROPOSER_SCHEMA:
            return {"bundles": []}
        raise llm_mod.LLMUnavailable("explainer off in this test")


def test_the_model_sees_the_critics_finding_when_replanning(client, monkeypatch):
    fake = Fake()
    monkeypatch.setattr(planner, "LLM_FACTORY", lambda: fake)
    _, p = plan(client, HARD)
    proposer_calls = [u for u in fake.users if "BASELINE_CANDIDATES" in u]
    assert len(proposer_calls) == p["critic"]["rounds"]
    assert "CRITIC_FEEDBACK" not in proposer_calls[0] and "CRITIC_FEEDBACK" in proposer_calls[1]
    assert "riders_still_over_threshold" in proposer_calls[1]
