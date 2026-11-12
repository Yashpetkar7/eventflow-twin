"""Break points: at what crowd size does each corridor station first cross the comfort threshold?

Exact, not searched. With no interventions the simulator's load factor in a 15-minute bin is

    lf(b) = (base(b) + A · e(b)) / cap(b)

where A is the event attendance, e(b) the event's metro trips per visitor in that bin (event_model.overlay is
linear in attendance) and cap(b) the boarding capacity (simulate.capacity_table, linear in `boardable_share`).
So a station crosses the threshold at

    A* = min over served bins of (threshold · cap(b) − base(b)) / e(b)

The grid repeats this for the range of train fullness the sensitivity study uses (scripts/sensitivity.py), because
`boardable_share` is the softest assumption until origin–destination ridership is ingested. Tested against the
simulator itself in tests/test_breakpoint.py.
"""
from __future__ import annotations

import math

from .config import corridor
from .forecast import make_run_id
from .simulate import bins_per_hour, capacity_table

BOARDABLE_GRID = [0.15, 0.20, 0.25, 0.30, 0.35]
ROUND_TO = 100            # visitors; "about N" on screen, always rounded up (never earlier than the true crossing)


def _break_for(base: list[float], ev_per_visitor: list[float], cap: list[float], thr: float, bph: int) -> tuple[int | None, str | None]:
    best, at = math.inf, None
    for b, (bs, e, c) in enumerate(zip(base, ev_per_visitor, cap)):
        if c <= 0 or e <= 1e-12:
            continue                                    # metro closed, or the event sends nobody here in this bin
        a = max(0.0, (thr * c - bs) / e)
        if a < best:
            best, at = a, b
    if at is None:
        return None, None
    minutes = int(at * 60 / bph)
    return int(math.ceil(best / ROUND_TO) * ROUND_TO), f"{minutes // 60:02d}:{minutes % 60:02d}"


def break_points(run: dict, threshold: float | None = None, stations: list[str] | None = None) -> dict:
    cfg = corridor()
    thr = float(threshold if threshold is not None else cfg["capacity"]["overcap_threshold"])
    ids = stations or [s["id"] for s in cfg["stations"] if s.get("in_corridor")]
    bph = bins_per_hour()
    attendance = run.get("attendance_used") or 0
    demand = run["demand"]
    cap, _ = capacity_table(ids, None, bph, run["weekday"])
    bs0 = float(cfg["capacity"]["boardable_share"])
    per_visitor = {s: [e / attendance for e in demand[s]["event"]] if attendance else [0.0] * len(demand[s]["event"]) for s in ids}

    rows = []
    for s in ids:
        a, when = _break_for(demand[s]["base"], per_visitor[s], cap[s], thr, bph)
        rows.append({"station_id": s, "served": any(e > 1e-12 for e in per_visitor[s]), "break_attendance": a, "first_time": when})
    grid = []
    for bs in BOARDABLE_GRID:
        best = None
        for s in ids:
            a, when = _break_for(demand[s]["base"], per_visitor[s], [c * bs / bs0 for c in cap[s]], thr, bph)
            if a is not None and (best is None or a < best[0]):
                best = (a, s, when)
        grid.append({"boardable_share": bs, "break_attendance": best[0] if best else None,
                     "station_id": best[1] if best else None, "first_time": best[2] if best else None})
    hits = [r for r in rows if r["break_attendance"] is not None]
    first = min(hits, key=lambda r: r["break_attendance"]) if hits else None
    run_id = make_run_id("brk", {"fc": run["run_id"], "thr": thr, "stations": ids})
    return {"run_id": run_id, "forecast_run_id": run["run_id"], "is_synthetic": run["is_synthetic"],
            "event_id": (run.get("event") or {}).get("id"), "attendance_used": attendance or None,
            "metro_share_used": run.get("metro_share_used"), "threshold": thr, "boardable_share_default": bs0,
            "corridor_break_attendance": first["break_attendance"] if first else None,
            "corridor_break_station": first["station_id"] if first else None,
            "stations": rows, "grid": grid,
            "note": "Attendance at which a station's 15-minute load first exceeds the threshold, all else as in this "
                    "scenario; rounded up to 100 visitors. Grid: same, for other assumed train fullness (boardable_share).",
            "source": {"tool": "simulate", "run_id": run_id}}
