"""API contract tests (schemas.py)."""
import json

import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main


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
    assert client.get("/events").json()[0]["id"] == "dfw2026_d1"


def test_forecast_shape_and_band(client):
    fc = _forecast(client)
    assert fc["event_is_assumption"] and fc["is_synthetic"]
    assert fc["source"] == {"tool": "forecast", "run_id": fc["run_id"]}
    assert len(fc["rows"]) == 6 * 24
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
    assert len(sim["rows"]) == 6 * 96 and len(sim["hourly"]) == 6 * 24


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


def test_agent_plan_stub_is_explicit(client):
    fc = _forecast(client)
    assert client.post("/agent/plan", json={"forecast_run_id": fc["run_id"]}).status_code == 501


def test_evidence(client):
    ev = client.get("/evidence").json()
    assert ev["data"]["is_synthetic"] is True and ev["contract"]
