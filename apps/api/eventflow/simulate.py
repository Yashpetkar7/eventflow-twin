"""Deterministic capacity & intervention simulator (docs/05 §5.4–5.5).

Resolution: `bins_per_hour` bins per hour (default 4 → 15-min bins, 96 per day).
Demand per station-bin is split into a 'base' part and an 'event' part so a staggered exit reshapes only the
event surge. Over-capacity passengers are not lost: a deterministic fluid queue carries anyone who could not
board into the next bin, which yields the platform-wait metrics.

Definitions (per station s, bin b; all assumptions live in config/corridor.yaml):
    cap(s,b)      = trains_in_bin × train_capacity × boardable_share
    load_factor   = demand / cap (docs/05 definition); over-capacity if load_factor > overcap_threshold
    offered(s,b)  = demand(s,b) + queue carried in from b-1
    served(s,b)   = min(offered, cap);  queue_out = offered − served   (feeds the wait metrics only)
    excess_pax    = Σ max(0, demand − threshold × cap)   (fresh demand only; no double counting)
    wait_min(s,b) = queue_out / cap × bin_minutes          (extra wait beyond the next train)
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field

import numpy as np

from .config import corridor
from .interventions import (ExtraTrains, RobotaxiStaging, ShuttleBus, StaggeredExit, WayfindingRedirect,
                            validate_interventions)

Demand = dict[str, dict[str, list[float]]]   # {station: {"base": [n_bins], "event": [n_bins]}}


def bins_per_hour() -> int:
    return int(corridor().get("bins_per_hour", 4))


def headway_for_hour(h: int, hw: dict) -> float:
    if 7 <= h <= 9 or 17 <= h <= 20:
        return hw["peak"]
    if 6 <= h <= 23:
        return hw["offpeak"]
    return hw["night"]


def capacity_table(stations: list[str], headway_override: dict[tuple[str, int], float] | None = None,
                   bph: int | None = None) -> dict[str, list[float]]:
    """Boardable capacity per station per bin. `headway_override` is keyed by (line, hour)."""
    cfg = corridor()
    cap, bph = cfg["capacity"], bph or bins_per_hour()
    line_of = {s["id"]: s["line"] for s in cfg["stations"]}
    bin_min = 60 / bph
    out = {}
    for s in stations:
        row = []
        for b in range(24 * bph):
            h = b // bph
            hw = (headway_override or {}).get((line_of.get(s, "Red"), h), headway_for_hour(h, cap["headway_min"]))
            row.append(bin_min / hw * cap["train_capacity"] * cap["boardable_share"])
        out[s] = row
    return out


def hourly_to_bins(series: list[float], bph: int | None = None) -> list[float]:
    """Spread an hourly series evenly over its bins (conserves totals)."""
    bph = bph or bins_per_hour()
    return [v / bph for v in series for _ in range(bph)]


@dataclass
class SimResult:
    rows: list[dict]            # per station-bin
    hourly: list[dict]          # per station-hour (for the heat strip / table view)
    summary: dict
    effects: list[dict]         # what each intervention actually did (numbers the explainer may cite)
    diverted_off_metro: float = 0.0
    notes: list[str] = field(default_factory=list)


def _total(d: Demand, s: str, b: int) -> float:
    return d[s]["base"][b] + d[s]["event"][b]


def _take(d: Demand, s: str, b: int, amount: float) -> float:
    """Remove up to `amount` from station s, bin b (event part first). Returns the amount removed."""
    amount = max(0.0, min(amount, _total(d, s, b)))
    take_event = min(amount, d[s]["event"][b])
    d[s]["event"][b] -= take_event
    d[s]["base"][b] -= amount - take_event
    return amount


def _move(d: Demand, src: str, dst: str, b: int, amount: float) -> float:
    moved = _take(d, src, b, amount)
    d[dst]["event"][b] += moved
    return moved


def stagger(series: list[float], spread_minutes: float, bph: int) -> list[float]:
    """Staggered release: each passenger's exit is delayed uniformly over [0, spread_minutes).
    Computed at 1-minute resolution and re-aggregated, so any spread (e.g. 20 or 45 min) has an effect.
    Mass that would spill past midnight is kept in the last bin, so the total is conserved exactly."""
    bin_min = 60 // bph
    per_min = np.repeat(np.asarray(series, dtype=float) / bin_min, bin_min)
    k = max(1, int(round(spread_minutes)))
    full = np.convolve(per_min, np.full(k, 1.0 / k))
    out = full[: len(per_min)].copy()
    out[-1] += full[len(per_min):].sum()
    return out.reshape(-1, bin_min).sum(axis=1).tolist()


def _hours_to_bins(hours: list[int], bph: int) -> list[int]:
    return [h * bph + j for h in sorted(set(hours)) for j in range(bph)]


def simulate(demand: Demand, interventions: list | None = None) -> SimResult:
    """Pure function: same inputs → same outputs. Raises InterventionError on invalid interventions."""
    cfg = corridor()
    cap_cfg, iv_cfg = cfg["capacity"], cfg["interventions"]
    bph = bins_per_hour()
    n, bin_min, thr = 24 * bph, 60 / bph, cap_cfg["overcap_threshold"]
    stations = list(demand.keys())
    for s in stations:
        for part in ("base", "event"):
            if len(demand[s][part]) != n:
                raise ValueError(f"demand[{s}][{part}] has {len(demand[s][part])} bins; expected {n}")

    ivs = validate_interventions(interventions or [])
    d = deepcopy(demand)
    cost, diverted = 0.0, 0.0
    effects: list[dict] = []

    # Pass 1 — reshape the surge and set capacity.
    hw_override: dict[tuple[str, int], float] = {}
    for iv in ivs:
        if isinstance(iv, StaggeredExit):
            before = max((_total(d, s, b) for s in stations for b in range(n)), default=0.0)
            for s in stations:
                d[s]["event"] = stagger(d[s]["event"], iv.params.spread_minutes, bph)
            after = max((_total(d, s, b) for s in stations for b in range(n)), default=0.0)
            cost += iv_cfg["cost_proxy"]["staggered_exit"]
            effects.append({"type": iv.type, "peak_bin_demand_before": round(before, 1), "peak_bin_demand_after": round(after, 1)})
        elif isinstance(iv, ExtraTrains):
            for h in iv.params.hours:
                key = (iv.params.line, h)
                hw_override[key] = min(hw_override.get(key, float("inf")), iv.params.headway_min)
    added_trains = 0.0
    for (line, h), new_hw in list(hw_override.items()):
        base_hw = headway_for_hour(h, cap_cfg["headway_min"])
        if new_hw >= base_hw:
            del hw_override[(line, h)]           # no improvement → no change, no cost
            continue
        added_trains += 60 / new_hw - 60 / base_hw
    if any(isinstance(iv, ExtraTrains) for iv in ivs):
        cost += added_trains * iv_cfg["cost_proxy"]["extra_trains_per_train_hour"]
        effects.append({"type": "extra_trains", "added_train_trips": round(added_trains, 1)})
    cap = capacity_table(stations, hw_override, bph)

    # Pass 2 — move or divert demand (targeted at crowding, never creating a new hotspot for shuttles).
    for iv in ivs:
        p = iv.params
        if isinstance(iv, WayfindingRedirect):
            moved = sum(_move(d, p.from_station, p.to_station, b, _total(d, p.from_station, b) * p.share)
                        for b in _hours_to_bins(p.hours, bph))
            cost += iv_cfg["cost_proxy"]["wayfinding_redirect"] * len(set(p.hours))
            effects.append({"type": iv.type, "moved_pax": round(moved, 1)})
        elif isinstance(iv, ShuttleBus):
            per_bin = p.buses * iv_cfg["bus_capacity"] * iv_cfg["bus_trips_per_hour"] / bph
            moved = 0.0
            for b in _hours_to_bins(p.hours, bph):
                excess = max(0.0, _total(d, p.from_station, b) - thr * cap[p.from_station][b])
                spare = max(0.0, thr * cap[p.to_station][b] - _total(d, p.to_station, b))
                moved += _move(d, p.from_station, p.to_station, b, min(per_bin, excess, spare))
            cost += iv_cfg["cost_proxy"]["shuttle_bus_hour"] * p.buses * len(set(p.hours))
            effects.append({"type": iv.type, "moved_pax": round(moved, 1)})
        elif isinstance(iv, RobotaxiStaging):
            per_bin = p.vehicles * iv_cfg["robotaxi_occupancy"] * iv_cfg["robotaxi_trips_per_hour"] / bph
            taken = 0.0
            for b in _hours_to_bins(p.hours, bph):
                excess = max(0.0, _total(d, p.station, b) - thr * cap[p.station][b])
                taken += _take(d, p.station, b, min(per_bin, excess))
            diverted += taken
            cost += iv_cfg["cost_proxy"]["robotaxi_vehicle_hour"] * p.vehicles * len(set(p.hours))
            effects.append({"type": iv.type, "diverted_pax": round(taken, 1)})

    # Queue + metrics.
    rows, hourly = [], []
    overcap_bins, excess, peak_lf, max_wait, delay_pax_min, end_queue, total_dem = 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    for s in stations:
        q = 0.0
        hour_acc: dict[int, dict] = {}
        for b in range(n):
            dem, c = _total(d, s, b), cap[s][b]
            offered = dem + q
            served = min(offered, c)
            q = offered - served
            lf = dem / c if c else 0.0
            wait = q / c * bin_min if c else 0.0
            total_dem += dem
            overcap_bins += lf > thr
            excess += max(0.0, dem - thr * c)
            peak_lf, max_wait = max(peak_lf, lf), max(max_wait, wait)
            delay_pax_min += q * bin_min
            rows.append({"station_id": s, "bin": b, "time": f"{int(b * bin_min) // 60:02d}:{int(b * bin_min) % 60:02d}",
                         "demand": round(dem, 1), "capacity": round(c, 1), "load_factor": round(lf, 3),
                         "queue": round(q, 1), "wait_min": round(wait, 1)})
            acc = hour_acc.setdefault(b // bph, {"demand": 0.0, "capacity": 0.0, "peak_lf": 0.0, "overcap_bins": 0})
            acc["demand"] += dem
            acc["capacity"] += c
            acc["peak_lf"] = max(acc["peak_lf"], lf)
            acc["overcap_bins"] += lf > thr
        end_queue += q
        hourly += [{"station_id": s, "hour": h, "demand": round(a["demand"], 1), "capacity": round(a["capacity"], 1),
                    "peak_lf": round(a["peak_lf"], 3), "overcap_bins": a["overcap_bins"]} for h, a in hour_acc.items()]

    summary = {
        "overcap_station_hours": round(overcap_bins / bph, 2),
        "excess_pax": round(excess, 1),
        "peak_lf": round(peak_lf, 3),
        "max_wait_min": round(max_wait, 1),
        "delay_pax_min": round(delay_pax_min, 1),
        "cost_proxy": round(cost, 2),
        "total_demand": round(total_dem, 1),
        "end_of_day_queue": round(end_queue, 1),
        "bins_per_hour": bph,
    }
    return SimResult(rows=rows, hourly=hourly, summary=summary, effects=effects, diverted_off_metro=round(diverted, 1))


def score(baseline: SimResult, option: SimResult) -> float:
    """Ranking score (docs/05 §5.5): passengers relieved minus λ × cost. Deterministic; never from the LLM."""
    lam = corridor()["interventions"]["ranking_lambda"]
    return (baseline.summary["excess_pax"] - option.summary["excess_pax"]) - lam * option.summary["cost_proxy"]
