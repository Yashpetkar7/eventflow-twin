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


def test_healthz_reports_storage(client, monkeypatch):
    assert client.get("/healthz").json()["storage"] == "persistent"
    monkeypatch.setenv("EVENTFLOW_STORAGE", "ephemeral")
    assert client.get("/healthz").json()["storage"] == "ephemeral"


def test_plan_cache_reads_shipped_and_writes_to_data_dir(client, tmp_path, monkeypatch):
    from apps.api.eventflow.agents import planner
    shipped, writable = tmp_path / "shipped", tmp_path / "writable"
    monkeypatch.setattr(planner, "CACHE", shipped)
    monkeypatch.setattr(planner, "CACHE_WRITE", writable)
    monkeypatch.setenv("DEMO_MODE", "offline")
    fc = client.post("/forecast", json={**SPEC, "attendance": 40000}).json()
    first = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    assert not first["cached"] and list(writable.glob("plan_*.json")) and not shipped.exists()
    again = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "scope": "corridor"}).json()
    assert again["cached"] and again["options"] == first["options"]


def test_rate_limit_sliding_window():
    from apps.api.eventflow.ratelimit import RateLimit
    rl = RateLimit(per_minute=3)
    assert [rl.allow("a", t) for t in (0, 1, 2, 3)] == [True, True, True, False]
    assert rl.allow("b", 3)                    # another client is not affected
    assert rl.allow("a", 61.5)                 # the first hits have left the window


def test_rate_limit_middleware_returns_429(monkeypatch):
    from apps.api.eventflow.ratelimit import RateLimit
    monkeypatch.setattr(main, "_LIMIT", RateLimit(per_minute=2))
    c = TestClient(main.app)
    codes = [c.post("/forecast", json=SPEC).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert c.get("/healthz").status_code == 200              # reads are never limited


def test_vercel_entry_serves_the_api_with_and_without_the_prefix():
    from apps.api.eventflow.vercel_entry import app
    c = TestClient(app)
    assert c.get("/api/healthz").json()["ok"] and c.get("/healthz").json()["ok"]
    assert len(c.get("/api/stations").json()) == len(c.get("/stations").json()) > 6


def test_vercel_entry_defaults_on_vercel(tmp_path):
    """On Vercel (VERCEL=1) the entrypoint picks a temp data folder, ephemeral storage and a rate limit by itself."""
    import os
    import subprocess
    import sys
    code = ("from fastapi.testclient import TestClient; from apps.api.eventflow.vercel_entry import app; "
            "from apps.api.eventflow import main; import os; c = TestClient(app); "
            "print(c.get('/api/healthz').json()['storage'], main.DECISIONS_LOG.parent.parent.as_posix(), main._LIMIT.per_minute)")
    env = {k: v for k, v in os.environ.items() if not k.startswith("EVENTFLOW_")}
    out = subprocess.run([sys.executable, "-c", code], env={**env, "VERCEL": "1"}, capture_output=True, text=True,
                         cwd=str(main.ROOT), check=True).stdout.split()
    assert out == ["ephemeral", "/tmp/eventflow", "60"]
