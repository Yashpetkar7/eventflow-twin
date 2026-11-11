import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from apps.api.eventflow.main import app

def test_forecast_then_simulate():
    c = TestClient(app)
    assert c.get("/healthz").json()["ok"]
    fc = c.post("/forecast", json={"event_id": "dfw2026_d1", "weekday": 2}).json()
    assert fc["rows"] and fc["event_is_assumption"]
    sim = c.post("/simulate", json={"forecast_run_id": fc["run_id"],
                                    "interventions": [{"type": "extra_trains", "params": {"headway_min": 3, "hours": [17, 18, 19]}}]}).json()
    assert "overcap_station_hours" in sim["summary"]
