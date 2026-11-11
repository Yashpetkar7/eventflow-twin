"""Deterministic capacity & intervention simulator (docs/05 §5.4–5.5).
Demand per station-hour is split into a 'base' part and an 'event' part so staggered exits can reshape only the event surge.
"""
from __future__ import annotations
from copy import deepcopy
from dataclasses import dataclass, field
from .config import corridor

Demand = dict[str, dict[str, list[float]]]   # {station: {"base": [24], "event": [24]}}

def headway_for_hour(h: int, hw: dict) -> float:
    if 7 <= h <= 9 or 17 <= h <= 20:
        return hw["peak"]
    if 6 <= h <= 23:
        return hw["offpeak"]
    return hw["night"]

def capacity_table(stations: list[str], headway_override: dict[tuple[str, int], float] | None = None) -> dict[str, list[float]]:
    cap = corridor()["capacity"]
    out = {}
    for s in stations:
        row = []
        for h in range(24):
            hw = (headway_override or {}).get((s, h), headway_for_hour(h, cap["headway_min"]))
            row.append(60.0 / hw * cap["train_capacity"] * cap["boardable_share"])
        out[s] = row
    return out

@dataclass
class SimResult:
    rows: list[dict]
    summary: dict
    diverted_off_metro: float = 0.0
    notes: list[str] = field(default_factory=list)

def _total(d: Demand, s: str, h: int) -> float:
    return d[s]["base"][h] + d[s]["event"][h]

def _move(d: Demand, src: str, dst: str, h: int, amount: float) -> float:
    """Move demand from src to dst at hour h, taking from event part first. Returns moved amount."""
    amount = max(0.0, min(amount, _total(d, src, h)))
    take_event = min(amount, d[src]["event"][h])
    d[src]["event"][h] -= take_event
    d[src]["base"][h] -= amount - take_event
    d[dst]["event"][h] += amount
    return amount

def _remove(d: Demand, s: str, h: int, amount: float) -> float:
    amount = max(0.0, min(amount, _total(d, s, h)))
    take_event = min(amount, d[s]["event"][h])
    d[s]["event"][h] -= take_event
    d[s]["base"][h] -= amount - take_event
    return amount

def _spread(series: list[float], extra_minutes: float) -> list[float]:
    """Flatten a series by convolving with a box kernel of ±k hours; conserves the total (edges reflected)."""
    k = max(0, round(extra_minutes / 60))
    if k == 0:
        return list(series)
    out = [0.0] * 24
    width = 2 * k + 1
    for h, v in enumerate(series):
        for j in range(-k, k + 1):
            t = h + j
            t = -t - 1 if t < 0 else (47 - t if t > 23 else t)
            t = min(23, max(0, t))
            out[t] += v / width
    return out

def simulate(demand: Demand, interventions: list[dict] | None = None) -> SimResult:
    cfg = corridor()
    cap_cfg, iv_cfg = cfg["capacity"], cfg["interventions"]
    d = deepcopy(demand)
    stations = list(d.keys())
    hw_override: dict[tuple[str, int], float] = {}
    cost, diverted, notes = 0.0, 0.0, []

    for iv in interventions or []:
        t, p = iv["type"], iv.get("params", {})
        hours = p.get("hours", list(range(24)))
        if t == "extra_trains":
            new_hw = max(float(p["headway_min"]), cap_cfg["min_headway_min"])
            for s in stations:   # one line in this corridor
                for h in hours:
                    base_hw = headway_for_hour(h, cap_cfg["headway_min"])
                    if new_hw < base_hw:
                        hw_override[(s, h)] = new_hw
                        cost += (60 / new_hw - 60 / base_hw) * iv_cfg["cost_proxy"]["extra_trains_per_train_hour"] / len(stations)
        elif t == "wayfinding_redirect":
            for h in hours:
                _move(d, p["from_station"], p["to_station"], h, _total(d, p["from_station"], h) * float(p["share"]))
            cost += iv_cfg["cost_proxy"]["wayfinding_redirect"] * len(hours)
        elif t == "shuttle_bus":
            per_hour = int(p["buses"]) * iv_cfg["bus_capacity"] * iv_cfg["bus_trips_per_hour"]
            for h in hours:
                _move(d, p["from_station"], p["to_station"], h, per_hour)
            cost += iv_cfg["cost_proxy"]["shuttle_bus_hour"] * int(p["buses"]) * len(hours)
        elif t == "robotaxi_staging":
            per_hour = int(p["vehicles"]) * iv_cfg["robotaxi_occupancy"] * iv_cfg["robotaxi_trips_per_hour"]
            for h in hours:
                diverted += _remove(d, p["station"], h, per_hour)
            cost += iv_cfg["cost_proxy"]["robotaxi_vehicle_hour"] * int(p["vehicles"]) * len(hours)
        elif t == "staggered_exit":
            for s in stations:
                d[s]["event"] = _spread(d[s]["event"], float(p["spread_minutes"]))
            cost += iv_cfg["cost_proxy"]["staggered_exit"]
        else:
            notes.append(f"unknown intervention ignored: {t}")

    cap = capacity_table(stations, hw_override)
    thr = cap_cfg["overcap_threshold"]
    rows, overcap, excess, peak = [], 0, 0.0, 0.0
    for s in stations:
        for h in range(24):
            dem = _total(d, s, h)
            lf = dem / cap[s][h] if cap[s][h] else 0.0
            rows.append({"station_id": s, "hour": h, "demand": round(dem, 1), "capacity": round(cap[s][h], 1), "load_factor": round(lf, 3)})
            overcap += lf > thr
            excess += max(0.0, dem - thr * cap[s][h])
            peak = max(peak, lf)
    summary = {"overcap_station_hours": int(overcap), "excess_pax": round(excess, 1), "peak_lf": round(peak, 3), "cost_proxy": round(cost, 2)}
    return SimResult(rows=rows, summary=summary, diverted_off_metro=round(diverted, 1), notes=notes)

def score(baseline: SimResult, option: SimResult) -> float:
    lam = corridor()["interventions"]["ranking_lambda"]
    return (baseline.summary["excess_pax"] - option.summary["excess_pax"]) - lam * option.summary["cost_proxy"]
