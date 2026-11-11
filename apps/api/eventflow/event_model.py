"""Parametric event-surge overlay (docs/05 §5.2). Transparent and labelled as a scenario model."""
from __future__ import annotations
import math
from .config import corridor

def _haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))

def station_weights(event: dict) -> dict[str, float]:
    cfg = corridor()
    tau = cfg["event_model"]["walk_tau_min"]
    w = {}
    for s in cfg["stations"]:
        walk_min = _haversine_km(event["lat"], event["lon"], s["lat"], s["lon"]) * 1.3 / 4.8 * 60  # detour 1.3, 4.8 km/h
        w[s["id"]] = math.exp(-walk_min / tau)
    tot = sum(w.values())
    return {k: v / tot for k, v in w.items()}

def _gauss_hourly(center_min: float, sigma_min: float) -> list[float]:
    vals = [math.exp(-0.5 * ((h * 60 + 30 - center_min) / sigma_min) ** 2) for h in range(24)]
    tot = sum(vals) or 1.0
    return [v / tot for v in vals]

def _to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)

def overlay(event: dict, exit_sigma_min: float | None = None) -> dict[str, dict[str, list[float]]]:
    """Return {station_id: {"entries": [24], "exits": [24]}} extra trips caused by the event.
    Arrivals to the venue show up as EXITS at stations; departures as ENTRIES."""
    em = corridor()["event_model"]
    trips_in = event["attendance"] * em["metro_share"]
    trips_out = trips_in * em["return_factor"]
    arr = _gauss_hourly(_to_min(event["start"]) + em["arrival_offset_min"], em["arrival_sigma_min"])
    dep = _gauss_hourly(_to_min(event["end"]) + em["exit_offset_min"], exit_sigma_min or em["exit_sigma_min"])
    out = {}
    for sid, w in station_weights(event).items():
        out[sid] = {"entries": [trips_out * w * d for d in dep], "exits": [trips_in * w * a for a in arr]}
    return out
