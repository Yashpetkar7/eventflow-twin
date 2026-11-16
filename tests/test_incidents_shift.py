"""Incidents and the duty shift (contract 1.13.0, decision #128): an incident is a scenario what-if resolved from
config/incidents.yaml; the shift is the Watcher and the team working the day one step at a time, never applying
anything themselves."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main
from apps.api.eventflow.agents import planner
from apps.api.eventflow.forecast import build_forecast, build_from_spec, incident_config

GITEX = {"event_id": "gitex2025_d1", "weather": "normal"}
DOWNTOWN = {"event_id": "downtown_night", "weather": "normal"}
TYPES = ["train_fault", "rain", "heat", "crowd_surge"]


@pytest.fixture
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "d.jsonl")
    monkeypatch.setenv("DEMO_MODE", "live")                      # compute, never replay the plan cache
    monkeypatch.delenv("LLM_MODEL", raising=False)
    return TestClient(main.app)


def sim(c, spec, interventions=()):
    fc = c.post("/forecast", json=spec).json()
    r = c.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor", "interventions": list(interventions)})
    assert r.status_code == 200, r.text
    return fc, r.json()


def test_a_scenario_without_an_incident_keeps_its_run_id():
    plain = build_forecast("gitex2025_d1")
    again = build_from_spec({"event_id": "gitex2025_d1", "incident": None})
    assert plain["run_id"] == again["run_id"] and again["service"] is None and again["incident"] is None


@pytest.mark.parametrize("kind", TYPES)
def test_an_incident_is_resolved_from_the_config_and_changes_the_run(c, kind):
    cfg, _ = incident_config()
    spec = {**GITEX, "incident": {"type": kind, "hour": 16}}
    plain, base = sim(c, GITEX)
    fc, res = sim(c, spec)
    assert fc["run_id"] != plain["run_id"] and fc["run_id"] == c.post("/forecast", json=spec).json()["run_id"]
    info = fc["incident"]
    assert info["type"] == kind and info["hour"] == 16 and info["source"].startswith("config/incidents.yaml")
    if kind == "crowd_surge":
        assert info["attendance_after"] == round(plain["attendance_used"] * cfg[kind]["attendance_factor"]) == fc["attendance_used"]
    elif kind == "train_fault":
        assert info["hours"] == [16, 17] and info["capacity_factor"] == cfg[kind]["capacity_factor"]
        assert fc["rows"] == plain["rows"]                                   # a fault changes the service, not the demand
        tph = lambda r: {(x["station_id"], x["hour"]): x["trains_per_hour"] for x in r["hourly"]}       # noqa: E731
        a, b = tph(base), tph(res)
        assert all(b[k] == pytest.approx(a[k] * 0.5, abs=0.06) for k in a if k[1] in (16, 17) and a[k] > 0)
        assert all(b[k] == a[k] for k in a if k[1] not in (16, 17))
    else:
        assert fc["weather"] == cfg[kind]["weather"] == info["weather"]
    assert res["summary"]["peak_lf"] >= base["summary"]["peak_lf"]            # none of these makes the day easier
    assert res["summary"]["overcap_station_hours"] >= base["summary"]["overcap_station_hours"]


def test_extra_trains_win_back_what_a_fault_took(c):
    spec = {**GITEX, "incident": {"type": "train_fault", "hour": 16}}
    _, fault = sim(c, spec)
    _, helped = sim(c, spec, [{"type": "extra_trains", "params": {"headway_min": 3, "hours": [16, 17]}}])
    assert helped["summary"]["peak_lf"] < fault["summary"]["peak_lf"]
    assert next(e for e in helped["effects"] if e["type"] == "extra_trains")["added_train_trips"] > 0


def test_a_crowd_surge_needs_an_event_and_a_bad_incident_is_rejected(c):
    assert c.post("/forecast", json={"incident": {"type": "crowd_surge", "hour": 16}}).status_code == 422
    assert c.post("/forecast", json={**GITEX, "incident": {"type": "earthquake", "hour": 16}}).status_code == 422
    assert c.post("/forecast", json={**GITEX, "incident": {"type": "rain", "hour": 3}}).status_code == 422


def shift(c, spec, approve=True, from_hour=5, limit=30):
    fc = c.post("/forecast", json=spec).json()
    ref = {"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor", "threshold": 0.85}
    applied, handled, steps, hour = [], [], [], from_hour
    for _ in range(limit):
        r = c.post("/shift/next", json={**ref, "applied": applied, "handled": handled, "from_hour": hour})
        assert r.status_code == 200, r.text
        s = r.json()
        steps.append(s)
        if s["done"]:
            break
        handled += [a["key"] for a in s["alerts"]]
        top = next((o for o in s["mission"]["plan"]["options"] if o["rank"] == s["recommended_rank"]), None)
        if approve and top:
            applied = planner.merge(applied, top["interventions"])
        hour = s["hour"]
    return ref, applied, steps


def test_the_shift_works_the_day_and_every_figure_is_the_simulators(c):
    ref, applied, steps = shift(c, DOWNTOWN)
    assert len(steps) >= 2 and steps[-1]["done"] and steps[-1]["reason"] == "clear"
    first = steps[0]                                                # the shift recommends an option that clears the line when one exists
    met = [o["rank"] for o in first["mission"]["plan"]["options"] if o["goal_met"]]
    assert first["recommended_rank"] == (met[0] if met else first["mission"]["plan"]["options"][0]["rank"])
    assert steps[-1]["residual"]["overcap_station_hours"] == 0 and steps[-1]["baseline"]["overcap_station_hours"] > 0
    assert steps[0]["reason"] == "awaiting_human" and steps[0]["mission"]["status"] == "awaiting_human"
    assert [s["hour"] for s in steps[:-1]] == sorted(s["hour"] for s in steps[:-1])           # the clock never runs backwards
    for s in steps[:-1]:
        for a in s["alerts"]:
            assert a["seen_at"] == s["hour"] and a["lead_now_h"] == a["crosses_at"] - s["hour"] and 0 <= a["lead_now_h"] <= 3
    # the day with everything approved, re-simulated on its own, is the last step's residual
    again = c.post("/simulate", json={**ref, "interventions": applied}).json()
    assert again["summary"] == steps[-1]["residual"]
    assert not main.DECISIONS_LOG.exists()                                                    # the shift itself approves nothing


def test_a_rejected_proposal_is_not_raised_again_and_the_leftover_is_reported(c):
    _, applied, steps = shift(c, DOWNTOWN, approve=False)
    keys = [a["key"] for s in steps for a in s["alerts"]]
    assert applied == [] and len(keys) == len(set(keys)) == 2 and len(steps) == 3            # each of the day's two alerts is asked about once
    last = steps[-1]
    assert last["done"] and last["reason"] == "residual" and last["residual"] == last["baseline"]
    assert last["residual"]["overcap_station_hours"] > 0


def test_an_incident_cannot_be_seen_before_it_happens(c):
    spec = {**GITEX, "incident": {"type": "train_fault", "hour": 16}}
    _, _, steps = shift(c, spec, from_hour=16)
    first = steps[0]
    assert not first["done"] and first["hour"] == 16 and all(a["seen_at"] == 16 for a in first["alerts"])
    assert steps[-1]["done"] and steps[-1]["reason"] == "clear"
    _, _, quiet = shift(c, GITEX)                                                             # the same day without the fault: nothing to do
    assert len(quiet) == 1 and quiet[0]["done"] and quiet[0]["reason"] == "clear" and quiet[0]["mission"] is None


def test_a_shift_stops_asking_after_its_limit(c):
    fc = c.post("/forecast", json=DOWNTOWN).json()
    body = {"forecast_run_id": fc["run_id"], "forecast": DOWNTOWN, "scope": "corridor", "handled": [f"X@{i}#0" for i in range(40)]}
    s = c.post("/shift/next", json=body).json()
    assert s["done"] and s["reason"] == "step_limit" and s["alerts"] and s["mission"] is None
    assert c.post("/shift/next", json={**body, "handled": ["x"] * 65}).status_code == 422
