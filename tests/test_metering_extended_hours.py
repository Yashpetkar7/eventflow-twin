"""Station entry metering / closure and extended service hours (RTA's New Year's Eve measures), end to end."""
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main
from apps.api.eventflow.agents import llm as llm_mod
from apps.api.eventflow.agents import planner
from apps.api.eventflow.interventions import InterventionError, validate_interventions

ROOT = Path(__file__).resolve().parents[1]
NIGHT = {"event_id": "downtown_night"}          # Burj Khalifa/Dubai Mall at ~207 % in the evening
HOURS = [21, 22, 23]


@pytest.fixture(scope="module")
def c():
    return TestClient(main.app)


def sim(c, spec, ivs, detail=False):
    fc = c.post("/forecast", json=spec).json()
    r = c.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": spec, "interventions": ivs, "detail": detail})
    assert r.status_code == 200, r.text
    return r.json()


def meter(max_load=0.85, to=None, hours=HOURS):
    return {"type": "station_metering", "params": {"station": "BKD", "max_load": max_load, "hours": hours,
                                                   **({"to_station": to} if to else {})}}


def test_metering_caps_the_platform_and_conserves_riders(c):
    base, m = sim(c, NIGHT, [], detail=True), sim(c, NIGHT, [meter(to="FIC")], detail=True)
    assert m["summary"]["total_demand"] == pytest.approx(base["summary"]["total_demand"], rel=1e-6)   # nobody vanishes
    rows = [r for r in m["rows"] if r["station_id"] == "BKD" and r["capacity"] > 0 and int(r["time"][:2]) in HOURS]
    assert rows and max(r["load_factor"] for r in rows) <= 0.85 + 1e-6
    eff = next(e for e in m["effects"] if e["type"] == "station_metering")
    assert eff["redirected_pax"] == eff["held_pax"] > 0 and eff["outside_wait_pax_min"] == 0
    assert m["summary"]["excess_pax"] < base["summary"]["excess_pax"]


def test_metering_without_a_neighbour_builds_a_queue_outside(c):
    base, m = sim(c, NIGHT, []), sim(c, NIGHT, [meter()])
    eff = next(e for e in m["effects"] if e["type"] == "station_metering")
    assert eff["redirected_pax"] == 0 and eff["outside_wait_pax_min"] > 0 and eff["max_outside_wait_min"] > 0
    assert m["summary"]["max_wait_min"] >= eff["max_outside_wait_min"]          # the trade-off is visible
    assert m["summary"]["delay_pax_min"] > base["summary"]["delay_pax_min"]
    assert m["summary"]["cost_proxy"] > sim(c, NIGHT, [meter(to="FIC")])["summary"]["cost_proxy"]


def test_closure_moves_everyone_to_the_neighbour(c):
    m = sim(c, NIGHT, [meter(max_load=0, to="BBY", hours=[22])], detail=True)
    at = [r for r in m["rows"] if r["station_id"] == "BKD" and r["time"].startswith("22:")]
    assert all(r["demand"] == 0 for r in at)
    assert next(e for e in m["effects"] if e["type"] == "station_metering")["closed"] is True


@pytest.mark.parametrize("iv,msg", [
    (meter(max_load=0), "needs to_station"),
    (meter(max_load=0.3), "outside"),
    (meter(max_load=0.99), "outside"),
    (meter(to="UNION"), "not a walkable neighbour"),
    ({"type": "extended_hours", "params": {"line": "Red", "hours": [1], "headway_min": 0.5}}, "minimum"),
    ({"type": "extended_hours", "params": {"line": "Pink", "hours": [1], "headway_min": 10}}, "unknown line"),
])
def test_out_of_bounds_measures_are_refused(iv, msg):
    with pytest.raises(InterventionError, match=msg):
        validate_interventions([iv])


def test_extended_hours_serve_riders_while_the_metro_is_normally_closed(c):
    ext = {"type": "extended_hours", "params": {"line": "Red", "hours": [0, 1, 2], "headway_min": 10}}
    base, e = sim(c, NIGHT, []), sim(c, NIGHT, [ext])
    assert e["summary"]["no_service_pax"] < base["summary"]["no_service_pax"]
    eff = next(x for x in e["effects"] if x["type"] == "extended_hours")
    assert eff["opened_hours"] == [0, 1, 2] and eff["added_train_trips"] > 0 and e["summary"]["cost_proxy"] > 0
    tph = {(r["station_id"], r["hour"]): r["trains_per_hour"] for r in e["hourly"]}
    assert tph[("WTC", 1)] == 6.0
    same = sim(c, NIGHT, [{"type": "extended_hours", "params": {"line": "Red", "hours": [15], "headway_min": 10}}])
    assert same["summary"]["excess_pax"] == base["summary"]["excess_pax"]          # open hours are not touched


def test_planner_offers_metering_only_when_a_platform_is_over_full(c, tmp_path, monkeypatch):
    monkeypatch.setattr(planner, "CACHE", tmp_path / "ro")
    def cands(spec):
        fc = main.get_run(c.post("/forecast", json=spec).json()["run_id"], main.ForecastRequest(**spec))
        base = main.run_simulation(fc["run_id"], [], False, None, "corridor")
        hot = planner.diagnose(base)
        return [x["key"] for x in planner.propose(hot, True, False, {r["station_id"] for r in base["hourly"]}, 0.85)]
    assert not {"meter", "meterq"} & set(cands({"event_id": "gitex2025_d1", "weather": "hot"}))   # 92 %: not offered
    assert {"meter", "meterq"} <= set(cands(NIGHT))                                                # 207 %: offered


def test_texts_and_number_check_cover_the_new_measures():
    what, risk = planner.describe([meter(to="FIC")], "en")
    assert "85% load" in what and "Financial Centre" in what and risk
    assert "حمولة 85%" in planner.describe([meter(to="FIC")], "ar")[0]
    assert "close" in planner.describe([meter(max_load=0, to="BBY", hours=[22])], "en")[0].lower()
    assert "Red Line service extended" in planner.describe(
        [{"type": "extended_hours", "params": {"line": "Red", "hours": [0, 1], "headway_min": 10}}], "en")[0]
    assert "85" in planner.allowed_for({}, {}, "1", "85", [meter()], 1)


def test_llm_menu_converts_the_new_measures():
    flat = {"type": "station_metering", "hours": [22, 21], "station": "BKD", "max_load": 0.8, "to_station": "",
            "from_station": "", "share": 0, "buses": 0, "vehicles": 0, "headway_min": 0, "spread_minutes": 0, "line": ""}
    assert llm_mod.to_intervention(flat) == {"type": "station_metering", "params": {"station": "BKD", "max_load": 0.8, "hours": [21, 22]}}
    ext = llm_mod.to_intervention(flat | {"type": "extended_hours", "line": "Red", "headway_min": 8, "hours": [1]})
    assert ext == {"type": "extended_hours", "params": {"line": "Red", "hours": [1], "headway_min": 8.0}}
    assert {"station_metering", "extended_hours"} <= set(llm_mod.MENU)


def test_plan_is_identical_whatever_python_hash_seed():
    """The planner used to pick the shuttle destination in set order on ties — it must not depend on hashing."""
    code = ("from fastapi.testclient import TestClient\nfrom apps.api.eventflow import main\nc=TestClient(main.app)\n"
            "s={'event_id':'downtown_night'}\nf=c.post('/forecast',json=s).json()\n"
            "import apps.api.eventflow.agents.planner as p, tempfile, pathlib\n"
            "p.CACHE=p.CACHE_WRITE=pathlib.Path(tempfile.mkdtemp())\n"
            "print([o['interventions'] for o in c.post('/agent/plan',json={'forecast_run_id':f['run_id'],'forecast':s}).json()['options']])")
    outs = {subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True,
                           env={**os.environ, "PYTHONHASHSEED": seed, "PYTHONPATH": str(ROOT)}).stdout for seed in ("1", "7")}
    assert len(outs) == 1 and next(iter(outs)).startswith("[")
