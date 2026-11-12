"""API contract tests (schemas.py)."""
import json

import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main
from apps.api.eventflow.config import corridor

N_ST = len(corridor()["stations"])


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "decisions_log.jsonl")
    return TestClient(main.app)


def _forecast(c, **kw):
    r = c.post("/forecast", json={"event_id": "dfw2026_d1", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_health_stations_events(client):
    assert client.get("/healthz").json()["ok"]
    assert {s["id"] for s in client.get("/stations").json()} >= {"EMT", "WTC"}
    evs = {e["id"]: e for e in client.get("/events").json()}
    assert {"gitex2025_d1", "dfw2026_d1"} <= set(evs)
    assert evs["gitex2025_d1"]["profile"] == "exhibition" and evs["gitex2025_d1"]["sources"]


def test_forecast_shape_and_band(client):
    fc = _forecast(client)
    assert fc["event_is_assumption"] and fc["is_synthetic"]
    assert fc["source"] == {"tool": "forecast", "run_id": fc["run_id"]}
    assert len(fc["rows"]) == N_ST * 24
    for r in fc["rows"]:
        assert r["entries_p10"] <= r["entries_p50"] <= r["entries_p90"]


def test_forecast_ids_are_deterministic(client):
    a, b = _forecast(client), _forecast(client)
    assert a["run_id"] == b["run_id"]
    assert _forecast(client, attendance=30000)["run_id"] != a["run_id"]


def test_attendance_slider_raises_peak(client):
    lo = _forecast(client, attendance=5000)
    hi = _forecast(client, attendance=30000)
    peak = lambda fc: max(r["entries_p50"] for r in fc["rows"] if r["station_id"] == "EMT")
    assert peak(hi) > peak(lo)


def test_simulate_with_baseline_and_delta(client):
    fc = _forecast(client, attendance=30000)
    r = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "interventions": [
        {"type": "extra_trains", "params": {"headway_min": 3, "hours": [17, 18, 19]}}]})
    assert r.status_code == 200, r.text
    sim = r.json()
    assert sim["delta"]["excess_pax"] <= 0
    assert sim["source"]["tool"] == "simulate" and sim["is_synthetic"]
    assert sim["rows"] == [] and len(sim["hourly"]) == N_ST * 24


def test_simulate_detail_rows(client):
    fc = _forecast(client)
    sim = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "detail": True}).json()
    assert len(sim["rows"]) == N_ST * 96


def test_decisions_listed_newest_first(client):
    for rank in (1, 2):
        client.post("/decisions", json={"plan_id": "p", "option_rank": rank, "decision": "approve",
                                        "option_title": f"Option {rank}"})
    d = client.get("/decisions").json()
    assert d["total"] == 2 and d["approved"] == 2 and d["items"][0]["option_title"] == "Option 2"


def test_simulate_rejects_bad_intervention(client):
    fc = _forecast(client)
    r = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "interventions": [
        {"type": "shuttle_bus", "params": {"from_station": "NOPE", "to_station": "FIC", "buses": 3, "hours": [18]}}]})
    assert r.status_code == 422 and "unknown station" in r.json()["detail"]


def test_unknown_ids(client):
    assert client.post("/forecast", json={"event_id": "nope"}).status_code == 404
    assert client.post("/simulate", json={"forecast_run_id": "fc_missing"}).status_code == 404
    assert client.post("/forecast", json={"end_time": "25:00"}).status_code == 422


def test_decisions_logged_append_only(client):
    for d in ("approve", "reject"):
        r = client.post("/decisions", json={"plan_id": "plan_x", "option_rank": 1, "decision": d})
        assert r.status_code == 200 and r.json()["logged"]
    lines = main.DECISIONS_LOG.read_text(encoding="utf-8").splitlines()
    assert [json.loads(x)["decision"] for x in lines] == ["approve", "reject"]
    assert client.post("/decisions", json={"plan_id": "p", "option_rank": 4, "decision": "approve"}).status_code == 422


def test_agent_plan_numbers_come_from_the_simulator(client, tmp_path, monkeypatch):
    from apps.api.eventflow.agents import planner
    monkeypatch.setattr(planner, "CACHE", tmp_path / "cache")
    fc = _forecast(client, attendance=40000)
    plan = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    assert plan["mode"] == "offline" and plan["planner"] == "deterministic-template"
    assert [s["key"] for s in plan["steps"]] == planner.STEP_KEYS
    assert 1 <= len(plan["options"]) <= 3 and plan["verify"]["all_matched"] and plan["verify"]["numbers_checked"] > 0
    for o in plan["options"]:
        sim = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "interventions": o["interventions"],
                                             "scope": "corridor"}).json()
        assert sim["summary"] == o["summary"] and sim["run_id"] == o["sources"][0]["run_id"]
    # replay from the offline cache is identical
    again = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    assert again["cached"] and again["options"] == plan["options"]
    # Arabic template passes the same number check
    ar = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor", "locale": "ar"}).json()
    assert ar["verify"]["all_matched"] and ar["options"][0]["summary"] == plan["options"][0]["summary"]


def test_agent_plan_without_hotspot_recommends_nothing(client, tmp_path, monkeypatch):
    from apps.api.eventflow.agents import planner
    monkeypatch.setattr(planner, "CACHE", tmp_path / "cache")
    fc = _forecast(client)                       # 15,000 visitors: no station over the threshold
    plan = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    assert plan["options"] == [] and plan["hotspot"] is None


def test_verify_numbers_catches_an_invented_figure():
    from apps.api.eventflow.agents.planner import verify_numbers
    assert verify_numbers("from 106 to 0, peak 92%", {"106", "0", "92"}) == (3, True)
    assert verify_numbers("from 106 to 12", {"106", "0"}) == (2, False)
    assert verify_numbers("من ١٠٦ إلى ٠", {"106", "0"}) == (2, True)


def test_exhibit_what_ifs(client):
    base = _forecast(client)
    hot = _forecast(client, weather="hot")
    assert base["metro_share_used"] == 0.45 and hot["metro_share_used"] == 0.55 and hot["run_id"] != base["run_id"]
    assert base["event"]["id"] == "dfw2026_d1"
    wide = _forecast(client, exit_sigma_min=60)
    peak = lambda fc: max(r["event_entries_p50"] for r in fc["rows"] if r["station_id"] == "EMT")
    assert peak(wide) < peak(base) < peak(hot)
    r = client.post("/forecast", json={"custom_event": {"near_station": "FIC", "start": "19:00", "end": "22:00",
                                                        "attendance": 20000, "weekend": True}})
    assert r.status_code == 200 and r.json()["event"]["id"] == "custom" and r.json()["weekday"] == 5
    assert client.post("/forecast", json={"custom_event": {"near_station": "NOPE", "start": "19:00", "end": "22:00",
                                                           "attendance": 1}}).status_code == 404


def test_threshold_and_corridor_scope(client):
    fc = _forecast(client, attendance=30000)
    lo = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "scope": "corridor", "threshold": 0.7}).json()
    hi = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "scope": "corridor", "threshold": 0.95}).json()
    assert lo["summary"]["threshold"] == 0.7 and len(lo["hourly"]) == 6 * 24
    assert lo["summary"]["overcap_station_hours"] >= hi["summary"]["overcap_station_hours"]
    assert all(r["trains_per_hour"] >= 0 for r in lo["hourly"]) and lo["run_id"] != hi["run_id"]


def test_evidence(client):
    ev = client.get("/evidence").json()
    assert ev["data"]["is_synthetic"] is True and ev["contract"]
