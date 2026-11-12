"""Serverless readiness: any instance can serve any request (docs/11_MVP_ROADMAP.md, Phase 1)."""
import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main

SPEC = {"event_id": "dfw2026_d1", "attendance": 30000}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "decisions_log.jsonl")
    return TestClient(main.app)


def test_simulate_rebuilds_the_run_on_a_cold_instance(client):
    fc = client.post("/forecast", json=SPEC).json()
    warm = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    main._RUNS.clear()                                   # another instance: nothing in memory
    assert client.post("/simulate", json={"forecast_run_id": fc["run_id"]}).status_code == 404
    cold = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "scope": "corridor", "forecast": SPEC})
    assert cold.status_code == 200, cold.text
    assert cold.json()["summary"] == warm["summary"] and cold.json()["run_id"] == warm["run_id"]


def test_forecast_spec_must_match_the_run_id(client):
    fc = client.post("/forecast", json=SPEC).json()
    main._RUNS.clear()
    r = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": {"event_id": "gitex2025_d1"}})
    assert r.status_code == 409 and "does not match" in r.json()["detail"]


def test_agent_plan_on_a_cold_instance(client, tmp_path, monkeypatch):
    from apps.api.eventflow.agents import planner
    monkeypatch.setattr(planner, "CACHE", tmp_path / "cache")
    fc = client.post("/forecast", json={**SPEC, "attendance": 40000}).json()
    main._RUNS.clear()
    r = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor",
                                         "forecast": {**SPEC, "attendance": 40000}})
    assert r.status_code == 200 and r.json()["verify"]["all_matched"]
