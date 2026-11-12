"""Deterministic capacity & intervention simulator (docs/05 §5.4–5.5).

Resolution: `bins_per_hour` bins per hour (default 4 → 15-min bins, 96 per day).
Demand per station-bin is split into a 'base' part and an 'event' part so a staggered exit reshapes only the
event surge. Over-capacity passengers are not lost: a deterministic fluid queue carries anyone who could not
board into the next bin, which yields the platform-wait metrics.

Capacity: scheduled trains per hour per direction from the official RTA GTFS timetable
(config/capacity_gtfs.yaml; `capacity.source: assumption` falls back to headway_min). With a share p of boarders
heading in direction 0, a line's effective boarding capacity at a station is set by the busier-relative direction,
and an interchange offers the sum over its lines:
    cap_dir(s,l,b) = boardable_departures_in_bin × train_capacity × boardable_share
    cap(s,b)       = Σ_lines min(cap_dir0 / p, cap_dir1 / (1 − p))     (one-directional service: that direction)
Bins with no scheduled service (metro closed) put their demand in `no_service_pax`; they are never queued.

Definitions (per station s, bin b; all assumptions live in config/corridor.yaml):
    load_factor   = demand / cap (docs/05 definition); over-capacity if load_factor > overcap_threshold
    offered(s,b)  = demand(s,b) + queue carried in from b-1
    served(s,b)   = min(offered, cap);  queue_out = offered − served   (feeds the wait metrics only)
    excess_pax    = Σ max(0, demand − threshold × cap)   (fresh demand only; no double counting)
    wait_min(s,b) = queue_out / cap × bin_minutes          (extra wait beyond the next train)
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

import yaml

from .config import ROOT, corridor
from .interventions import (ExtendedHours, ExtraTrains, RobotaxiStaging, ShuttleBus, StaggeredExit, StationMetering,
                            WayfindingRedirect, validate_interventions)

Demand = dict[str, dict[str, list[float]]]   # {station: {"base": [n_bins], "event": [n_bins]}}


def bins_per_hour() -> int:
    return int(corridor().get("bins_per_hour", 4))


def headway_for_hour(h: int, hw: dict) -> float:
    if 7 <= h <= 9 or 17 <= h <= 20:
        return hw["peak"]
    if 6 <= h <= 23:
        return hw["offpeak"]
    return hw["night"]


@lru_cache(maxsize=1)
def gtfs_table() -> dict | None:
    p = ROOT / "config/capacity_gtfs.yaml"
    return yaml.safe_load(p.read_text(encoding="utf-8")) if p.exists() else None


def scheduled_tph(station: str, line: str, hour: int, weekday: int) -> tuple[float, float]:
    """Scheduled boardable departures per hour (direction 0, direction 1) at a station on one line."""
    cap = corridor()["capacity"]
    table = gtfs_table() if cap.get("source", "assumption") == "gtfs" else None
    if table:
        daytype = cap["gtfs_daytype_for_weekday"][weekday]
        dirs = table["trains_per_hour"].get(daytype, {}).get(station, {}).get(line)
        if dirs is None:
            return 0.0, 0.0
        return float(dirs["dir0"][hour]), float(dirs["dir1"][hour])
    t = 60.0 / headway_for_hour(hour, cap["headway_min"])
    return t, t


def _direction_capacity(c0: float, c1: float, p: float) -> float:
    """Boarding capacity of one line at a station. With service both ways the busier-relative direction binds;
    where only one direction can be boarded (a terminus, or first/last trains) everyone boards that way."""
    if c0 <= 0 or c1 <= 0:
        return max(c0, c1)
    return min(c0 / p, c1 / (1 - p))


def _opened(t0: float, t1: float, key: tuple[str, int], extend: dict[tuple[str, int], float]) -> tuple[float, float]:
    """Extended hours: a (line, hour) with no scheduled service at all gets trains both ways at the given headway."""
    if key in extend and t0 <= 0 and t1 <= 0:
        t = 60.0 / extend[key]
        return t, t
    return t0, t1


def capacity_table(stations: list[str], headway_override: dict[tuple[str, int], float] | None = None,
                   bph: int | None = None, weekday: int = 2,
                   extend: dict[tuple[str, int], float] | None = None) -> tuple[dict[str, list[float]], float]:
    """Effective boarding capacity per station per bin, plus train trips added by `headway_override`
    (keyed by (line, hour); a direction never gets fewer trains than scheduled) and by `extend` (extended hours:
    service in hours that normally have none). Added trips are counted once per line and direction."""
    cfg = corridor()
    cap, bph = cfg["capacity"], bph or bins_per_hour()
    lines_of = {s["id"]: s.get("lines") or [s["line"]] for s in cfg["stations"]}
    p = float(cap.get("direction_split", 0.5))
    seat = cap["train_capacity"] * cap["boardable_share"]
    override, extend = headway_override or {}, extend or {}
    added: dict[tuple[str, int], float] = {}
    out = {}
    for s in stations:
        row = []
        for h in range(24):
            total = 0.0
            for line in lines_of.get(s, ["Red"]):       # an interchange offers the capacity of each of its lines
                key = (line, h)
                s0, s1 = scheduled_tph(s, line, h, weekday)
                t0, t1 = _opened(s0, s1, key, extend)
                if (t0, t1) != (s0, s1):
                    added[key] = max(added.get(key, 0.0), (t0 - s0) + (t1 - s1))
                if key in override:
                    floor = 60.0 / override[key]
                    # extra trains run the whole line, but a direction with no boardable service here stays at 0
                    n0, n1 = (max(t0, floor) if t0 > 0 else 0.0), (max(t1, floor) if t1 > 0 else 0.0)
                    added[key] = max(added.get(key, 0.0), (n0 - s0) + (n1 - s1))
                    t0, t1 = n0, n1
                total += _direction_capacity(t0 / bph * seat, t1 / bph * seat, p)
            row += [total] * bph
        out[s] = row
    return out, sum(added.values())


def trains_table(stations: list[str], headway_override: dict[tuple[str, int], float] | None = None,
                 weekday: int = 2, extend: dict[tuple[str, int], float] | None = None) -> dict[str, list[float]]:
    """Boardable trains per hour in the busier direction of each station's primary line, including any
    extra-train override. Shown in the UI ("trains per hour now") and used to pace the animated trains."""
    cfg = corridor()
    primary = {s["id"]: s["line"] for s in cfg["stations"]}
    override, extend = headway_override or {}, extend or {}
    out = {}
    for s in stations:
        line, row = primary.get(s, "Red"), []
        for h in range(24):
            t0, t1 = _opened(*scheduled_tph(s, line, h, weekday), (line, h), extend)
            if (line, h) in override:
                floor = 60.0 / override[(line, h)]
                t0, t1 = (max(t0, floor) if t0 > 0 else 0.0), (max(t1, floor) if t1 > 0 else 0.0)
            row.append(round(max(t0, t1), 1))
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


def simulate(demand: Demand, interventions: list | None = None, weekday: int = 2, *,
             threshold: float | None = None, report: list[str] | None = None) -> SimResult:
    """Pure function: same inputs → same outputs. Raises InterventionError on invalid interventions.

    `threshold` overrides the comfort threshold (planner what-if). `report` limits the rows and the summary to
    those stations (e.g. the featured corridor); every station still takes part in the simulation itself."""
    cfg = corridor()
    cap_cfg, iv_cfg = cfg["capacity"], cfg["interventions"]
    bph = bins_per_hour()
    n, bin_min = 24 * bph, 60 / bph
    thr = cap_cfg["overcap_threshold"] if threshold is None else float(threshold)
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
    extend: dict[tuple[str, int], float] = {}
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
        elif isinstance(iv, ExtendedHours):
            for h in iv.params.hours:
                key = (iv.params.line, h)
                extend[key] = min(extend.get(key, float("inf")), iv.params.headway_min)
    cap, added_trains = capacity_table(stations, hw_override, bph, weekday, extend)
    _, ext_trips = capacity_table(stations, None, bph, weekday, extend) if extend else (None, 0.0)
    if any(isinstance(iv, (ExtraTrains, ExtendedHours)) for iv in ivs):
        cost += added_trains * iv_cfg["cost_proxy"]["extra_trains_per_train_hour"]
    if any(isinstance(iv, ExtraTrains) for iv in ivs):
        effects.append({"type": "extra_trains", "added_train_trips": round(added_trains - ext_trips, 1)})
    if extend:
        on_line = {line: [x["id"] for x in cfg["stations"] if line in (x.get("lines") or [x["line"]]) and x["id"] in demand]
                   for line, _ in extend}
        opened = sorted({h for (line, h) in extend
                         if all(scheduled_tph(s, line, h, weekday) == (0.0, 0.0) for s in on_line[line][:1])})
        cost += iv_cfg["cost_proxy"].get("extended_hours_hour", 2.0) * len(opened)
        effects.append({"type": "extended_hours", "opened_hours": opened, "added_train_trips": round(ext_trips, 1)})

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

    # Pass 3 — entry metering at the gates, on whatever demand is left (riders held back wait outside, or walk).
    outside_delay, outside_wait_max, outside_left = 0.0, 0.0, 0.0
    for iv in ivs:
        if not isinstance(iv, StationMetering):
            continue
        p = iv.params
        bins = _hours_to_bins(p.hours, bph)
        held = redirected = waiting = delay = wait_max = 0.0
        for b in bins:
            if waiting > 0:                                   # riders already waiting outside reach the gates now
                d[p.station]["event"][b] += waiting
            allowed = p.max_load * cap[p.station][b] * (1 - 1e-9)   # held exactly at the line, never a hair over it
            over = _take(d, p.station, b, max(0.0, _total(d, p.station, b) - allowed))
            held += over if waiting == 0 else max(0.0, over - waiting)
            if p.to_station:
                d[p.to_station]["event"][b] += over
                redirected += over
                waiting = 0.0
            else:
                waiting = over
                delay += waiting * bin_min
                if allowed > 0:
                    wait_max = max(wait_max, waiting / allowed * bin_min)
        if waiting > 0:                                       # metering ends: the queue enters in the next bin
            nxt = bins[-1] + 1
            if nxt < n:
                d[p.station]["event"][nxt] += waiting
            else:
                outside_left += waiting
        cost += iv_cfg["cost_proxy"].get("station_metering_hour", 1.0) * len(set(p.hours))
        cost += iv_cfg["cost_proxy"].get("metered_wait_per_pax_hour", 0.01) * delay / 60.0
        outside_delay, outside_wait_max = outside_delay + delay, max(outside_wait_max, wait_max)
        effects.append({"type": iv.type, "held_pax": round(held, 1), "redirected_pax": round(redirected, 1),
                        "outside_wait_pax_min": round(delay, 1), "max_outside_wait_min": round(wait_max, 1),
                        "closed": p.max_load == 0})

    # Queue + metrics.
    rows, hourly = [], []
    overcap_bins, excess, peak_lf, max_wait, delay_pax_min, end_queue, total_dem = 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    no_service = 0.0
    tph = trains_table(stations, hw_override, weekday, extend)
    for s in (stations if report is None else [x for x in stations if x in set(report)]):
        q = 0.0
        hour_acc: dict[int, dict] = {}
        for b in range(n):
            dem, c = _total(d, s, b), cap[s][b]
            total_dem += dem
            if c <= 0:                       # metro closed: not queued, reported separately
                no_service += dem + q
                q = 0.0
                rows.append({"station_id": s, "bin": b, "time": f"{int(b * bin_min) // 60:02d}:{int(b * bin_min) % 60:02d}",
                             "demand": round(dem, 1), "capacity": 0.0, "load_factor": 0.0, "queue": 0.0, "wait_min": 0.0})
                acc = hour_acc.setdefault(b // bph, {"demand": 0.0, "capacity": 0.0, "peak_lf": 0.0, "overcap_bins": 0})
                acc["demand"] += dem
                continue
            offered = dem + q
            served = min(offered, c)
            q = offered - served
            lf = dem / c if c else 0.0
            wait = q / c * bin_min if c else 0.0
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
                    "peak_lf": round(a["peak_lf"], 3), "overcap_bins": a["overcap_bins"],
                    "trains_per_hour": tph[s][h]} for h, a in hour_acc.items()]

    summary = {
        "overcap_station_hours": round(overcap_bins / bph, 2),
        "excess_pax": round(excess, 1),
        "peak_lf": round(peak_lf, 3),
        "max_wait_min": round(max(max_wait, outside_wait_max), 1),     # inside the station or outside its gates
        "delay_pax_min": round(delay_pax_min + outside_delay, 1),
        "cost_proxy": round(cost, 2),
        "total_demand": round(total_dem, 1),
        "end_of_day_queue": round(end_queue + outside_left, 1),
        "no_service_pax": round(no_service, 1),
        "bins_per_hour": bph,
        "threshold": thr,
    }
    return SimResult(rows=rows, hourly=hourly, summary=summary, effects=effects, diverted_off_metro=round(diverted, 1))


def score(baseline: SimResult, option: SimResult) -> float:
    """Ranking score (docs/05 §5.5): passengers relieved minus λ × cost. Deterministic; never from the LLM."""
    lam = corridor()["interventions"]["ranking_lambda"]
    return (baseline.summary["excess_pax"] - option.summary["excess_pax"]) - lam * option.summary["cost_proxy"]
