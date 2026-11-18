"""The "calm" checkpoint (contract 1.18.0, decision #153): with "Ask me during planning" on and no station over the
line, the team does not end in silence. The stress agent tests the scenario harder by itself and the supervisor asks
the human which harder scenario to plan for. Every figure in the question is a real forecast and simulation."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main
from apps.api.eventflow.agents import personas
from apps.api.eventflow.agents.engine import run_mission
from apps.api.eventflow.schemas import AgentRunRequest

CALM = {"event_id": "gitex2025_d1", "weather": "normal"}       # nothing over the line
HOT = {"event_id": "gitex2025_d1", "weather": "hot"}           # World Trade Centre over the line
ALL = ["hotspot", "partial", "calm"]


@pytest.fixture
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "d.jsonl")
    monkeypatch.setattr(personas, "CASSETTES", tmp_path / "llm")
    monkeypatch.setenv("DEMO_MODE", "offline")
    personas.reset_cache()
    yield TestClient(main.app)
    personas.reset_cache()


def ref(c, spec):
    fc = c.post("/forecast", json=spec).json()
    return {"forecast_run_id": fc["run_id"], "forecast": spec, "threshold": 0.85, "scope": "corridor"}


def sim(c, spec, thr=0.85):
    fc = c.post("/forecast", json=spec).json()
    return c.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": spec, "interventions": [], "threshold": thr, "scope": "corridor"}).json()


def test_nothing_over_the_line_the_team_tests_harder_and_asks(c):
    m = c.post("/agent/run", json={**ref(c, CALM), "checkpoints": ALL}).json()
    assert m["status"] == "paused" and m["pause"]["checkpoint"] == "calm" and m["pause"]["asked_by"] == "supervisor"
    p = m["pause"]["params"]
    probes = {q["id"]: q for q in p["probes"]}
    assert set(probes) == {"crowd", "hot", "line"} and m["pause"]["actions"] == ["try_crowd", "try_hot", "try_line", "accept"]
    base = sim(c, CALM)
    assert base["summary"]["overcap_station_hours"] == 0 and p["peak_pct"] == round(base["summary"]["peak_lf"] * 100) < p["threshold_pct"] == 85
    # each probe is what the simulator gives for that harder scenario
    crowd = probes["crowd"]
    assert crowd["attendance_now"] == 40000 < crowd["break_attendance"] < crowd["attendance"] and crowd["attendance"] % 1000 == 0
    s1 = sim(c, {**CALM, "attendance": crowd["attendance"]})
    assert (crowd["peak_lf"], crowd["overcap_station_hours"]) == (round(s1["summary"]["peak_lf"], 4), s1["summary"]["overcap_station_hours"]) and crowd["crosses"]
    s2 = sim(c, HOT)
    assert (probes["hot"]["peak_lf"], probes["hot"]["overcap_station_hours"]) == (round(s2["summary"]["peak_lf"], 4), s2["summary"]["overcap_station_hours"])
    s3 = sim(c, CALM, probes["line"]["threshold"])
    assert probes["line"]["threshold"] == 0.75 and probes["line"]["overcap_station_hours"] == s3["summary"]["overcap_station_hours"] > 0
    # the events say who did what: the stress agent tested, the supervisor asked the human
    keys = [(e["agent"], e["key"]) for e in m["events"]]
    assert keys.count(("stress", "stress.probe")) == 3 and keys[-1] == ("supervisor", "checkpoint.ask")
    assert all(e["run_id"] for e in m["events"] if e["key"] == "stress.probe")
    assert m["plan"]["options"] == []                                    # nothing is proposed, let alone applied, while it asks


def test_accept_ends_as_before_and_without_the_checkpoint_nothing_changes(c):
    r = ref(c, CALM)
    plain = c.post("/agent/run", json=r).json()
    assert plain["status"] != "paused" and plain["stop_reason"] == "no_action" and plain["plan"]["options"] == []
    two = c.post("/agent/run", json={**r, "checkpoints": ["hotspot", "partial"]}).json()      # the 1.16.0 request: same answer as ever
    assert two["status"] == plain["status"] and [e["key"] for e in two["events"]] == [e["key"] for e in plain["events"]]
    done = c.post("/agent/run", json={**r, "checkpoints": ALL, "answers": [{"checkpoint": "calm", "action": "accept"}]}).json()
    assert done["status"] == plain["status"] and done["stop_reason"] == "no_action"
    assert ("human", "checkpoint.answer") in [(e["agent"], e["key"]) for e in done["events"]]


def test_a_hotspot_still_gets_the_hotspot_question_and_a_probe_that_holds_is_not_offered(c):
    hot = c.post("/agent/run", json={**ref(c, HOT), "checkpoints": ALL}).json()
    assert hot["pause"]["checkpoint"] == "hotspot"
    dfw = c.post("/agent/run", json={**ref(c, {"event_id": "dfw2026_d1"}), "checkpoints": ALL}).json()
    probes = {q["id"]: q for q in dfw["pause"]["params"]["probes"]}
    assert probes["hot"]["crosses"] is False and "try_hot" not in dfw["pause"]["actions"]     # tested, reported, not suggested
    assert dfw["pause"]["actions"][-1] == "accept" and "try_crowd" in dfw["pause"]["actions"]


def test_both_engines_stop_at_the_same_question():
    fc = main.forecast(main.ForecastRequest(**CALM))
    run = main.get_run(fc["run_id"])
    req = AgentRunRequest(forecast_run_id=fc["run_id"], forecast=CALM, threshold=0.85, scope="corridor", checkpoints=ALL)
    a, b = run_mission(run, req, main.run_simulation, engine="graph"), run_mission(run, req, main.run_simulation, engine="seq")
    assert a["status"] == b["status"] == "paused" and a["pause"] == b["pause"]
    assert [(e["agent"], e["key"]) for e in a["events"]] == [(e["agent"], e["key"]) for e in b["events"]]


def test_the_request_stays_small_and_typed(c):
    r = {**ref(c, CALM), "checkpoints": ALL}
    assert c.post("/agent/run", json={**r, "checkpoints": ALL + ["calm"]}).status_code == 422                     # at most three checkpoints
    assert c.post("/agent/run", json={**r, "answers": [{"checkpoint": "calm", "action": "teleport"}]}).status_code == 422
    # a harder scenario is applied by the caller as a scenario change; sent here as an answer it changes nothing
    m = c.post("/agent/run", json={**r, "answers": [{"checkpoint": "calm", "action": "try_crowd"}]}).json()
    assert m["status"] != "paused" and m["stop_reason"] == "no_action" and m["plan"]["options"] == []
