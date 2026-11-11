import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.api.eventflow.config import corridor, events
from apps.api.eventflow.event_model import overlay
from apps.api.eventflow.simulate import simulate, _spread

STATIONS = [s["id"] for s in corridor()["stations"]]

def demo_demand():
    ev = overlay(events()[0])
    return {s: {"base": [500.0] * 24, "event": list(ev[s]["entries"])} for s in STATIONS}

def total(rows):
    return sum(r["demand"] for r in rows)

def test_noop_equals_baseline():
    d = demo_demand()
    assert simulate(d).summary == simulate(d, []).summary

def test_redirect_conserves_demand():
    d = demo_demand()
    base = simulate(d)
    moved = simulate(d, [{"type": "wayfinding_redirect", "params": {"from_station": "EMT", "to_station": "FIC", "share": 0.3}}])
    assert abs(total(base.rows) - total(moved.rows)) < 1.0

def test_more_trains_never_increases_peak():
    d = demo_demand()
    base = simulate(d)
    more = simulate(d, [{"type": "extra_trains", "params": {"headway_min": 3, "hours": list(range(16, 21))}}])
    assert more.summary["peak_lf"] <= base.summary["peak_lf"]
    assert more.summary["cost_proxy"] > 0

def test_spread_conserves_total():
    s = [0.0] * 24; s[18] = 1000.0
    assert abs(sum(_spread(s, 120)) - 1000.0) < 1e-6

def test_staggered_exit_reduces_peak():
    d = demo_demand()
    assert simulate(d, [{"type": "staggered_exit", "params": {"spread_minutes": 60}}]).summary["peak_lf"] <= simulate(d).summary["peak_lf"]

def test_robotaxi_diversion_accounted():
    d = demo_demand()
    r = simulate(d, [{"type": "robotaxi_staging", "params": {"station": "EMT", "vehicles": 20, "hours": [18, 19]}}])
    assert abs(total(simulate(d).rows) - total(r.rows) - r.diverted_off_metro) < 1.0
