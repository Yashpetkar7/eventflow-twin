"""Public-demo hardening: bounded work per request, security headers, rate-limit key from Vercel's client-IP header."""
import json

from fastapi.testclient import TestClient

from apps.api.eventflow import main
from apps.api.eventflow.ratelimit import RateLimit
from apps.api.eventflow.schemas import MAX_INTERVENTIONS

SPEC = {"event_id": "gitex2025_d1"}
IV = {"type": "robotaxi_staging", "params": {"station": "WTC", "vehicles": 10, "hours": [15]}}


def test_too_many_interventions_are_refused_before_any_simulation(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "d.jsonl")
    c = TestClient(main.app)
    fc = c.post("/forecast", json=SPEC).json()
    ok = c.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": SPEC, "interventions": [IV] * MAX_INTERVENTIONS})
    assert ok.status_code == 200
    for path, body in [("/simulate", {"forecast_run_id": fc["run_id"], "forecast": SPEC, "interventions": [IV] * (MAX_INTERVENTIONS + 1)}),
                       ("/agent/plan", {"forecast_run_id": fc["run_id"], "forecast": SPEC, "applied": [IV] * 500}),
                       ("/decisions", {"plan_id": "p", "option_rank": 1, "decision": "approve", "interventions": [IV] * 500})]:
        r = c.post(path, json=body)
        assert r.status_code == 422, (path, r.status_code)
    assert not (tmp_path / "d.jsonl").exists()


def test_security_headers_on_every_api_response():
    r = TestClient(main.app).get("/healthz")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_rate_limit_keys_on_vercel_client_ip(monkeypatch):
    monkeypatch.setattr(main, "_LIMIT", RateLimit(2))
    c = TestClient(main.app)
    hit = lambda ip, spoof: c.post("/forecast", json=SPEC, headers={"x-vercel-forwarded-for": ip, "x-forwarded-for": spoof})  # noqa: E731
    assert hit("1.1.1.1", "9.9.9.1").status_code == 200
    assert hit("1.1.1.1", "9.9.9.2").status_code == 200
    r = hit("1.1.1.1", "9.9.9.3")                                # a new X-Forwarded-For does not reset the count
    assert r.status_code == 429 and r.headers["retry-after"] == "60"
    assert hit("2.2.2.2", "9.9.9.3").status_code == 200          # another visitor is not affected


def test_every_response_carries_a_request_id_and_its_timing(caplog):
    import logging
    c = TestClient(main.app)
    with caplog.at_level(logging.INFO, logger="eventflow.access"):
        r = c.get("/healthz", headers={"X-Request-ID": "booth-check_01"})
    assert r.headers["X-Request-ID"] == "booth-check_01" and r.headers["Server-Timing"].startswith("app;dur=")
    line = json.loads(caplog.records[-1].getMessage())
    assert line["rid"] == "booth-check_01" and line["path"] == "/healthz" and line["status"] == 200 and line["ms"] >= 0
    bad = c.get("/healthz", headers={"X-Request-ID": "<script>alert(1)</script>"})        # never echo an unsafe id
    assert bad.headers["X-Request-ID"] != "<script>alert(1)</script>" and len(bad.headers["X-Request-ID"]) == 16
