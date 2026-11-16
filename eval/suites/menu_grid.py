"""An exhaustive grid over the intervention menu around a diagnosed hotspot: the yardstick the agents are compared
with (optimality suite) and the set of plans the critic is tested on (critic suite).

Every bundle is inside the menu's bounds (corridor.yaml); the grid is wider than what the agents propose: every
walkable neighbour and every station a shuttle may reach, several settings per measure, and every pair of measures
of different kinds among the most effective single measures.
"""
from __future__ import annotations

from itertools import combinations

from apps.api.eventflow.agents import planner
from apps.api.eventflow.config import corridor


def singles(hot: dict, scope_ids: set[str], has_event: bool, thr: float) -> list[list[dict]]:
    cfg = corridor()
    b, cap = cfg["interventions"]["bounds"], cfg["capacity"]
    by = {s["id"]: s for s in cfg["stations"]}
    worst, hrs, win = hot["station"], hot["hours"], hot["window"]
    line = by[worst]["line"]
    nbs = [n for n in cfg["neighbours"].get(worst, []) if n in scope_ids]
    near = sorted(s for s in scope_ids if s != worst and planner._km(by[worst], by[s]) <= b.get("max_shuttle_km", 8))
    out: list[list[dict]] = []
    for hw in sorted({float(cap["min_headway_min"]), 3.0, 4.0}):
        out.append([{"type": "extra_trains", "params": {"headway_min": hw, "hours": win, "line": line}}])
    for nb in nbs:
        for share in (0.2, 0.35, b["max_redirect_share"]):
            out.append([{"type": "wayfinding_redirect", "params": {"from_station": worst, "to_station": nb, "share": share, "hours": hrs}}])
    for to in near:
        for buses in (6, 15, b["max_buses"]):
            out.append([{"type": "shuttle_bus", "params": {"from_station": worst, "to_station": to, "buses": buses, "hours": hrs}}])
    for veh in (30, b["max_robotaxi_vehicles"]):
        out.append([{"type": "robotaxi_staging", "params": {"station": worst, "vehicles": veh, "hours": hrs}}])
    if has_event:
        for m in sorted({30, 60, b["stagger_minutes"][1]}):
            out.append([{"type": "staggered_exit", "params": {"spread_minutes": m}}])
    if hot["peak_lf"] > 1.0:
        ml = round(thr, 2)
        out.append([{"type": "station_metering", "params": {"station": worst, "max_load": ml, "hours": hrs}}])
        for nb in nbs:
            out.append([{"type": "station_metering", "params": {"station": worst, "max_load": ml, "hours": hrs, "to_station": nb}}])
    return out


def pairs(best_singles: list[list[dict]]) -> list[list[dict]]:
    """Every pair of two different kinds of measure among the given single measures."""
    out = []
    for a, b in combinations(best_singles, 2):
        if a[0]["type"] != b[0]["type"]:
            out.append([*a, *b])
    return out
