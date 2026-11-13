"""Road-pressure proxy: extra vehicles an event puts on the roads around its venue (config/road.yaml).

A labelled scenario model, not a traffic model. Event visitors who do not take the metro mostly leave by road;
their vehicles follow the same arrival and exit timing as the metro surge (event_model.py). Interventions change
it the way they change the surge: a staggered exit spreads the departures, feeder shuttles and staged robotaxis
add vehicles in their hours. Nothing here feeds back into the metro simulation.

    vehicles(b) = [non-metro trips in(b) + out(b)] × road_share / car_occupancy  + shuttle PCU(b) + robotaxi trips(b)
    pressure    = busiest hour's vehicles / (reference_lanes × lane_capacity_veh_per_hour)
"""
from __future__ import annotations

from functools import lru_cache

import yaml

from .config import ROOT, corridor
from .event_model import gauss_bins, timing_params, to_min
from .simulate import bins_per_hour, stagger


@lru_cache(maxsize=1)
def road_config() -> dict:
    return yaml.safe_load((ROOT / "config/road.yaml").read_text(encoding="utf-8"))


def road_pressure(run: dict, interventions: list[dict], effects: list[dict]) -> dict | None:
    """Hourly extra vehicles and the pressure index for a forecast run under `interventions`. None without an event.
    `effects` are the simulator's own (riders the robotaxis actually carried), so both models tell one story."""
    ev = run.get("event")
    if not ev or not run.get("attendance_used"):
        return None
    rc, iv_cfg, bph = road_config(), corridor()["interventions"], bins_per_hour()
    em = timing_params(ev)
    share = float(run["metro_share_used"] if run.get("metro_share_used") is not None else em["metro_share"])
    sigma = float(run["exit_sigma_used"] if run.get("exit_sigma_used") is not None else em["exit_sigma_min"])
    trips = float(run["attendance_used"]) * (1.0 - share) * rc["road_share_of_non_metro"]
    arr = gauss_bins(to_min(ev["start"]) + em["arrival_offset_min"], em["arrival_sigma_min"], bph)
    dep = gauss_bins(to_min(run.get("end_used") or ev["end"]) + em["exit_offset_min"], sigma, bph)
    occ = rc["car_occupancy"]
    veh_in = [trips * a / occ for a in arr]
    veh_out = [trips * em["return_factor"] * d / occ for d in dep]
    extra = [0.0] * (24 * bph)
    taxi_effects = [e for e in effects if e.get("type") == "robotaxi_staging"]
    for iv in interventions:
        p = iv["params"]
        if iv["type"] == "staggered_exit":
            veh_out = stagger(veh_out, p["spread_minutes"], bph)
        elif iv["type"] == "shuttle_bus":
            for h in set(p["hours"]):
                for j in range(bph):
                    extra[h * bph + j] += p["buses"] * iv_cfg["bus_trips_per_hour"] * rc["bus_pcu"] / bph
        elif iv["type"] == "robotaxi_staging" and taxi_effects:
            carried = taxi_effects.pop(0).get("diverted_pax", 0.0)         # same order as the simulator applied them
            bins = [h * bph + j for h in set(p["hours"]) for j in range(bph)]
            for b in bins:
                extra[b] += carried / iv_cfg["robotaxi_occupancy"] / len(bins)
    per_bin = [a + b + c for a, b, c in zip(veh_in, veh_out, extra)]
    hourly = [round(sum(per_bin[h * bph:(h + 1) * bph]), 1) for h in range(24)]
    peak_hour = max(range(24), key=lambda h: (hourly[h], -h))
    cap = float(rc["reference_lanes"] * rc["lane_capacity_veh_per_hour"])
    return {"peak_veh_per_hour": hourly[peak_hour], "peak_hour": peak_hour, "pressure": round(hourly[peak_hour] / cap, 3),
            "vehicles_total": round(sum(per_bin), 1), "reference_capacity": cap, "hourly": hourly, "is_assumption": True}
