"""Simulator property suite → eval/results/simulator_<ts>.json (docs/08).

Runs the invariants on the real demo forecast (DFW Day 1 at several attendance levels) rather than on toy
inputs, so a broken simulator fails the gate. Usage: python -m eval.suites.simulator
"""
from __future__ import annotations

import itertools
import sys

from apps.api.eventflow.forecast import build_forecast
from apps.api.eventflow.simulate import simulate, stagger
from eval.common import write_result

EVENING = list(range(16, 22))
BUNDLES = [
    [],
    [{"type": "extra_trains", "params": {"headway_min": 3, "hours": EVENING}}],
    [{"type": "staggered_exit", "params": {"spread_minutes": 30}}],
    [{"type": "wayfinding_redirect", "params": {"from_station": "EMT", "to_station": "FIC", "share": 0.3, "hours": EVENING}}],
    [{"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "BBY", "buses": 12, "hours": EVENING}}],
    [{"type": "robotaxi_staging", "params": {"station": "EMT", "vehicles": 30, "hours": EVENING}}],
    [{"type": "staggered_exit", "params": {"spread_minutes": 45}},
     {"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "BBY", "buses": 8, "hours": EVENING}},
     {"type": "extra_trains", "params": {"headway_min": 2.5, "hours": EVENING}}],
]
TOL = 0.5


def run() -> dict:
    checks: list[tuple[str, bool, float]] = []   # (name, passed, error)

    def check(name: str, ok: bool, err: float = 0.0) -> None:
        checks.append((name, bool(ok), float(err)))

    for att in (15000, 25000, 40000):
        fc = build_forecast("dfw2026_d1", attendance=att)
        d, wd = fc["demand"], fc["weekday"]
        base = simulate(d, weekday=wd)
        check(f"noop_equality@{att}", simulate(d, [], weekday=wd).summary == base.summary)
        for i, bundle in enumerate(BUNDLES[1:], 1):
            res = simulate(d, bundle, weekday=wd)
            err = abs(base.summary["total_demand"] - res.summary["total_demand"] - res.diverted_off_metro)
            check(f"conservation@{att}#{i}", err <= TOL, err)
            check(f"nonnegative@{att}#{i}", all(r["demand"] >= 0 and r["queue"] >= 0 for r in res.rows))
            check(f"order_independent@{att}#{i}",
                  simulate(d, list(reversed(bundle)), weekday=wd).summary == res.summary)
        for hw in (5, 4, 3, 2.5):
            more = simulate(d, [{"type": "extra_trains", "params": {"headway_min": hw, "hours": EVENING}}], weekday=wd)
            check(f"monotone_trains@{att}/hw{hw}",
                  all(more.summary[k] <= base.summary[k] for k in ("peak_lf", "excess_pax", "max_wait_min")))
    for minutes, pos in itertools.product((15, 20, 30, 45, 60, 90), (0, 40, 72, 95)):
        s = [0.0] * 96
        s[pos] = 1000.0
        out = stagger(s, minutes, 4)
        check(f"stagger_conserves/{minutes}@{pos}", abs(sum(out) - 1000.0) < 1e-6, abs(sum(out) - 1000.0))

    passed = sum(ok for _, ok, _ in checks)
    failures = [name for name, ok, _ in checks if not ok]
    metrics = {"property_pass_rate": passed / len(checks),
               "conservation_error_max": max(e for n, _, e in checks if n.startswith("conservation"))}
    fc = build_forecast("dfw2026_d1")
    path = write_result("simulator", metrics, n=len(checks), split="properties",
                        models={"simulator": "deterministic-15min-queue"}, dataset_version=fc["dataset_version"],
                        is_synthetic=fc["is_synthetic"], failures=failures)
    print(f"simulator suite: {passed}/{len(checks)} checks passed -> {path.name}")
    for f in failures:
        print("  FAIL", f)
    return metrics


if __name__ == "__main__":
    sys.exit(0 if run()["property_pass_rate"] == 1.0 else 1)
