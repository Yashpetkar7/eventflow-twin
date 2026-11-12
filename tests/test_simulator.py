"""Simulator property tests (docs/05 §5.4, docs/08 simulator suite)."""
import random

import pytest

from apps.api.eventflow.interventions import InterventionError
from apps.api.eventflow.simulate import capacity_table, simulate, stagger
from conftest import N, STATIONS

EVENING = list(range(16, 22))


def total_demand(res):
    return sum(r["demand"] for r in res.rows)


def test_noop_equals_baseline_exactly(demand):
    assert simulate(demand).summary == simulate(demand, []).summary
    assert simulate(demand).rows == simulate(demand, None).rows


def test_simulate_is_pure(demand):
    snapshot = {s: {k: list(v) for k, v in d.items()} for s, d in demand.items()}
    simulate(demand, [{"type": "staggered_exit", "params": {"spread_minutes": 60}}])
    assert demand == snapshot


def test_rejects_wrong_resolution():
    with pytest.raises(ValueError):
        simulate({"EMT": {"base": [1.0] * 24, "event": [0.0] * 24}})


@pytest.mark.parametrize("iv", [
    {"type": "wayfinding_redirect", "params": {"from_station": "EMT", "to_station": "FIC", "share": 0.3}},
    {"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "BBY", "buses": 10, "hours": EVENING}},
    {"type": "staggered_exit", "params": {"spread_minutes": 45}},
    {"type": "extra_trains", "params": {"headway_min": 3, "hours": EVENING}},
])
def test_demand_conserved(heavy_demand, iv):
    base, res = simulate(heavy_demand), simulate(heavy_demand, [iv])
    assert res.summary["total_demand"] == pytest.approx(base.summary["total_demand"], abs=0.5)


def test_robotaxi_diversion_accounted(heavy_demand):
    base = simulate(heavy_demand)
    res = simulate(heavy_demand, [{"type": "robotaxi_staging", "params": {"station": "EMT", "vehicles": 40, "hours": EVENING}}])
    assert res.diverted_off_metro > 0
    assert base.summary["total_demand"] - res.summary["total_demand"] == pytest.approx(res.diverted_off_metro, abs=0.5)


def test_queue_conserves_passengers(heavy_demand):
    """Everyone either boards or is still queued: Σ served + end queue = Σ demand."""
    res = simulate(heavy_demand)
    served = 0.0
    for s in STATIONS:
        q = 0.0
        for r in [r for r in res.rows if r["station_id"] == s]:
            if r["capacity"] == 0:                 # closed: counted in no_service_pax, queue cleared
                q = 0.0
                continue
            offered = r["demand"] + q
            served += min(offered, r["capacity"])
            q = max(0.0, offered - r["capacity"])
    s_ = res.summary
    # rows are rounded to 0.1 pax, so recomputing from them carries a little rounding noise
    assert served + s_["end_of_day_queue"] + s_["no_service_pax"] == pytest.approx(s_["total_demand"], rel=1e-5)


@pytest.mark.parametrize("hw", [5, 4, 3, 2.5])
def test_more_trains_monotone(heavy_demand, hw):
    base = simulate(heavy_demand)
    more = simulate(heavy_demand, [{"type": "extra_trains", "params": {"headway_min": hw, "hours": EVENING}}])
    for k in ("peak_lf", "excess_pax", "overcap_station_hours", "max_wait_min"):
        assert more.summary[k] <= base.summary[k]


def test_extra_trains_slower_than_timetable_is_noop(demand):
    res = simulate(demand, [{"type": "extra_trains", "params": {"headway_min": 10, "hours": EVENING}}])
    assert res.summary == {**simulate(demand).summary, "cost_proxy": 0.0}


@pytest.mark.parametrize("minutes", [15, 20, 30, 45, 60, 90])
def test_stagger_any_spread_has_effect_and_conserves(minutes):
    s = [0.0] * N
    s[72] = 1000.0                                   # 18:00 bin
    out = stagger(s, minutes, N // 24)
    assert sum(out) == pytest.approx(1000.0)
    assert max(out) < 1000.0                          # 20 and 45 min used to round to no effect


def test_stagger_keeps_mass_at_midnight():
    s = [0.0] * N
    s[-1] = 500.0
    assert sum(stagger(s, 90, N // 24)) == pytest.approx(500.0)


def test_staggered_exit_reduces_peak(heavy_demand):
    """The network-wide peak may sit far from the event (flat test demand at a quiet station), so check the
    station that takes the exit surge."""
    emt = lambda res: max(r["peak_lf"] for r in res.hourly if r["station_id"] == "EMT")
    base = simulate(heavy_demand)
    res = simulate(heavy_demand, [{"type": "staggered_exit", "params": {"spread_minutes": 30}}])
    assert emt(res) < emt(base)
    assert res.summary["peak_lf"] <= base.summary["peak_lf"]


def test_shuttle_never_creates_hotspot_at_destination(heavy_demand):
    res = simulate(heavy_demand, [{"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "BBY", "buses": 30, "hours": EVENING}}])
    base = {(r["station_id"], r["bin"]): r for r in simulate(heavy_demand).rows}
    cap, _ = capacity_table(STATIONS)
    for r in res.rows:
        if r["station_id"] == "BBY" and r["demand"] > base[("BBY", r["bin"])]["demand"] + 0.05:
            assert r["demand"] <= 0.85 * cap["BBY"][r["bin"]] + 0.1


def test_shuttle_moves_nothing_without_crowding():
    flat = {s: {"base": [10.0] * N, "event": [0.0] * N} for s in STATIONS}
    res = simulate(flat, [{"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "FIC", "buses": 5, "hours": EVENING}}])
    assert res.effects[0]["moved_pax"] == 0.0


def test_bundle_order_does_not_matter(heavy_demand):
    a = {"type": "staggered_exit", "params": {"spread_minutes": 30}}
    b = {"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "BBY", "buses": 8, "hours": EVENING}}
    c = {"type": "extra_trains", "params": {"headway_min": 3, "hours": EVENING}}
    assert simulate(heavy_demand, [a, b, c]).summary == simulate(heavy_demand, [c, b, a]).summary


def test_lf_bounds_and_nonnegative(heavy_demand):
    rng = random.Random(0)
    for _ in range(20):
        ivs = rng.sample([
            {"type": "staggered_exit", "params": {"spread_minutes": rng.choice([15, 30, 60])}},
            {"type": "extra_trains", "params": {"headway_min": rng.choice([2.5, 3, 4]), "hours": EVENING}},
            {"type": "wayfinding_redirect", "params": {"from_station": "EMT", "to_station": "WTC", "share": 0.2}},
            {"type": "robotaxi_staging", "params": {"station": "WTC", "vehicles": 20, "hours": EVENING}},
        ], k=rng.randint(1, 4))
        res = simulate(heavy_demand, ivs)
        assert all(r["demand"] >= 0 and r["load_factor"] >= 0 and r["queue"] >= 0 for r in res.rows)
        assert res.summary["cost_proxy"] >= 0


@pytest.mark.parametrize("iv", [
    {"type": "teleport", "params": {}},
    {"type": "extra_trains", "params": {"headway_min": 1, "hours": [18]}},
    {"type": "extra_trains", "params": {"headway_min": 3, "hours": [25]}},
    {"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "EMT", "buses": 2, "hours": [18]}},
    {"type": "shuttle_bus", "params": {"from_station": "XXX", "to_station": "FIC", "buses": 2, "hours": [18]}},
    {"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "FIC", "buses": 999, "hours": [18]}},
    {"type": "shuttle_bus", "params": {"from_station": "WTC", "to_station": "DISCOVERY_GARDENS", "buses": 5, "hours": [18]}},
    {"type": "wayfinding_redirect", "params": {"from_station": "EMT", "to_station": "BBY", "share": 0.2}},
    {"type": "wayfinding_redirect", "params": {"from_station": "EMT", "to_station": "FIC", "share": 0.9}},
    {"type": "staggered_exit", "params": {"spread_minutes": 5}},
    {"type": "robotaxi_staging", "params": {"station": "EMT", "vehicles": 0, "hours": [18]}},
    {"type": "extra_trains", "params": {"headway_min": 3, "hours": [18], "surprise": 1}},
])
def test_invalid_interventions_rejected(demand, iv):
    with pytest.raises(InterventionError):
        simulate(demand, [iv])
