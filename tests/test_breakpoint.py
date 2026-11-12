"""Break-point view (K6): at what crowd size does each station cross the comfort threshold?"""
import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main
from apps.api.eventflow.breakpoint import break_points
from apps.api.eventflow.config import corridor
from apps.api.eventflow.forecast import build_forecast
from apps.api.eventflow.simulate import simulate


def peak_lf(event_id: str, attendance: float, station: str) -> float:
    fc = build_forecast(event_id, attendance=attendance)
    res = simulate(fc["demand"], weekday=fc["weekday"])
    return max(r["peak_lf"] for r in res.hourly if r["station_id"] == station)


@pytest.mark.parametrize("event_id", ["dfw2026_d1", "gitex2025_d1"])
def test_break_point_matches_the_simulator(event_id):
    """Just below the break attendance the station is under the threshold, just above it is over."""
    run = build_forecast(event_id)
    bp = break_points(run)
    thr = corridor()["capacity"]["overcap_threshold"]
    hot = min((s for s in bp["stations"] if s["break_attendance"]), key=lambda s: s["break_attendance"])
    assert peak_lf(event_id, hot["break_attendance"] - 150, hot["station_id"]) <= thr
    assert peak_lf(event_id, hot["break_attendance"] + 150, hot["station_id"]) > thr


def test_agrees_with_the_published_sensitivity_grid():
    """scripts/sensitivity.py found the first 2,500-step attendance over the line: 22,500 (DFW) and 45,000 (GITEX)."""
    for event_id, grid_value in (("dfw2026_d1", 22500), ("gitex2025_d1", 45000)):
        bp = break_points(build_forecast(event_id))
        assert grid_value - 2500 < bp["corridor_break_attendance"] <= grid_value


def test_grid_over_train_fullness_is_monotonic():
    bp = break_points(build_forecast("gitex2025_d1"))
    values = [g["break_attendance"] for g in bp["grid"]]
    assert [g["boardable_share"] for g in bp["grid"]] == [0.15, 0.2, 0.25, 0.3, 0.35]
    assert values == sorted(values) and values[0] < values[-1]      # more room on trains → later break point


def test_unserved_station_has_no_break_point():
    bp = break_points(build_forecast("gitex2025_d1"))
    by = {s["station_id"]: s for s in bp["stations"]}
    assert by["BBY"]["break_attendance"] is None and by["BBY"]["served"] is False


def test_endpoint_on_a_cold_instance(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "d.jsonl")
    c = TestClient(main.app)
    spec = {"event_id": "gitex2025_d1", "weather": "hot"}
    fc = c.post("/forecast", json=spec).json()
    main._RUNS.clear()
    r = c.post("/breakpoint", json={"forecast_run_id": fc["run_id"], "forecast": spec})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_synthetic"] and body["source"]["tool"] == "simulate"
    assert {s["station_id"] for s in body["stations"]} == set(main.corridor_ids())
    hot = [s for s in body["stations"] if s["break_attendance"]]
    assert hot and all(s["first_time"] for s in hot)
    # hot day: more metro trips, so the break point is lower than on a normal day
    normal = c.post("/breakpoint", json={"forecast_run_id": c.post("/forecast", json={"event_id": "gitex2025_d1"}).json()["run_id"]}).json()
    assert body["corridor_break_attendance"] < normal["corridor_break_attendance"]
