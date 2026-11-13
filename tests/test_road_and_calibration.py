"""Road-pressure proxy (road.py, config/road.yaml) and the real-totals demand level (config/calibration.yaml)."""
import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main
from apps.api.eventflow.forecast import calibration
from apps.api.eventflow.road import road_config

EV = "gitex2025_d1"


@pytest.fixture
def client():
    return TestClient(main.app)


def sim(client, spec, ivs=()):
    fc = client.post("/forecast", json=spec).json()
    r = client.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor", "interventions": list(ivs)})
    assert r.status_code == 200, r.text
    return fc, r.json()


def test_road_total_is_the_non_metro_visitors_in_cars(client):
    fc, s = sim(client, {"event_id": EV})
    rc, road = road_config(), s["road"]
    trips = fc["attendance_used"] * (1 - fc["metro_share_used"]) * rc["road_share_of_non_metro"]
    assert road["vehicles_total"] == pytest.approx(2 * trips / rc["car_occupancy"], rel=1e-3)     # in and out
    assert road["pressure"] == pytest.approx(road["peak_veh_per_hour"] / road["reference_capacity"], abs=1e-3)
    assert road["peak_veh_per_hour"] == max(road["hourly"]) and road["is_assumption"] is True
    assert s["baseline_road"] == road


def test_more_metro_means_fewer_cars(client):
    _, low = sim(client, {"event_id": EV, "metro_share": 0.35})
    _, high = sim(client, {"event_id": EV, "metro_share": 0.65})
    assert high["road"]["peak_veh_per_hour"] < low["road"]["peak_veh_per_hour"]
    assert high["summary"]["peak_lf"] > low["summary"]["peak_lf"]            # the trade-off the kiosk shows


def test_interventions_change_the_road_the_way_they_change_the_surge(client):
    spec = {"event_id": "downtown_night"}
    _, base = sim(client, spec)
    _, stag = sim(client, spec, [{"type": "staggered_exit", "params": {"spread_minutes": 60}}])
    assert stag["road"]["peak_veh_per_hour"] < base["road"]["peak_veh_per_hour"]
    assert stag["road"]["vehicles_total"] == pytest.approx(base["road"]["vehicles_total"], rel=1e-6)
    _, bus = sim(client, spec, [{"type": "shuttle_bus", "params": {"from_station": "BKD", "to_station": "FIC", "buses": 10, "hours": [22]}}])
    assert bus["road"]["hourly"][22] > base["road"]["hourly"][22] and bus["baseline_road"] == base["road"]
    _, taxi = sim(client, spec, [{"type": "robotaxi_staging", "params": {"station": "BKD", "vehicles": 40, "hours": [22]}}])
    carried = next(e["diverted_pax"] for e in taxi["effects"] if e["type"] == "robotaxi_staging")
    assert carried > 0 and taxi["road"]["vehicles_total"] > base["road"]["vehicles_total"]


def test_no_event_no_road_figure(client):
    _, s = sim(client, {})
    assert s["road"] is None and s["baseline_road"] is None


def test_plan_options_carry_their_road_figure(client, tmp_path, monkeypatch):
    from apps.api.eventflow.agents import planner
    monkeypatch.setattr(planner, "CACHE_WRITE", tmp_path)
    monkeypatch.setenv("DEMO_MODE", "live")
    spec = {"event_id": EV, "weather": "rain"}
    fc = client.post("/forecast", json=spec).json()
    p = client.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor"}).json()
    assert p["baseline_road"]["peak_veh_per_hour"] > 0 and all(o["road"] for o in p["options"])


def test_real_totals_scale_each_station_by_its_measured_ratio(client):
    cal = calibration()
    a = client.post("/forecast", json={"event_id": EV}).json()
    b = client.post("/forecast", json={"event_id": EV, "demand_level": "real_totals"}).json()
    assert a["demand_level"] == "synthetic" and a["calibration"] is None and a["run_id"] != b["run_id"]
    assert b["demand_level"] == "real_totals" and b["calibration"]["source"] == cal["source"] and b["is_synthetic"]
    for sid, c in cal["stations"].items():
        ra = {r["hour"]: r for r in a["rows"] if r["station_id"] == sid}
        rb = {r["hour"]: r for r in b["rows"] if r["station_id"] == sid}
        for h in (8, 13, 18):                      # background (entries − event entries) scales; the event surge does not
            bg_a, bg_b = ra[h]["entries_p50"] - ra[h]["event_entries_p50"], rb[h]["entries_p50"] - rb[h]["event_entries_p50"]
            assert bg_b == pytest.approx(bg_a * c["ratio"], abs=0.2)
            assert rb[h]["event_entries_p50"] == ra[h]["event_entries_p50"]


def test_default_run_ids_did_not_move(client):
    """Adding demand_level and the road figure must not change existing run ids (fixtures, cache, eval results)."""
    assert client.post("/forecast", json={"event_id": EV}).json()["run_id"] == \
        client.post("/forecast", json={"event_id": EV, "demand_level": "synthetic"}).json()["run_id"]
