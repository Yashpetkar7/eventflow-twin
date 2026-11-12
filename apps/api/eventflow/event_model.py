"""Parametric event-surge overlay (docs/05 §5.2). Transparent and labelled as a scenario model.

Resolution is `bins_per_hour` (default from corridor.yaml, 4 = 15-min bins) so a 30-min exit surge is
represented faithfully. Arrivals to the venue show up as EXITS at stations; departures as ENTRIES.
"""
from __future__ import annotations

import math

from .config import corridor


def _haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def walk_minutes(lat: float, lon: float, s_lat: float, s_lon: float) -> float:
    """Straight-line distance × 1.3 detour factor at 4.8 km/h. Assumption; refine with OSM paths."""
    return _haversine_km(lat, lon, s_lat, s_lon) * 1.3 / 4.8 * 60


def station_weights(event: dict) -> dict[str, float]:
    cfg = corridor()
    tau, cutoff = cfg["event_model"]["walk_tau_min"], cfg["event_model"].get("walk_cutoff_min", 30)
    w = {}
    for s in cfg["stations"]:
        walk = walk_minutes(event["lat"], event["lon"], s["lat"], s["lon"])
        w[s["id"]] = math.exp(-walk / tau) if walk <= cutoff else 0.0
    tot = sum(w.values())
    # No station within walking distance: the event generates no metro trips (all weights 0).
    return {k: (v / tot if tot else 0.0) for k, v in w.items()}


def gauss_bins(center_min: float, sigma_min: float, bins_per_hour: int) -> list[float]:
    """Normalised Gaussian evaluated at bin mid-points across one day (sums to 1)."""
    width = 60 / bins_per_hour
    n = 24 * bins_per_hour
    vals = [math.exp(-0.5 * ((i * width + width / 2 - center_min) / sigma_min) ** 2) for i in range(n)]
    tot = sum(vals) or 1.0
    return [v / tot for v in vals]


def to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def timing_params(event: dict) -> dict:
    """Event-model parameters with the event's timing profile applied (corridor.yaml event_model.profiles)."""
    em = dict(corridor()["event_model"])
    profile = event.get("profile", "default")
    profiles = em.pop("profiles", {}) or {}
    if profile not in profiles:
        raise ValueError(f"event {event.get('id')}: unknown profile '{profile}' (known: {sorted(profiles)})")
    return {**em, **(profiles[profile] or {})}


def overlay(event: dict, *, bins_per_hour: int | None = None, attendance: float | None = None,
            end: str | None = None, scale: float = 1.0, metro_share: float | None = None,
            exit_sigma_min: float | None = None) -> dict[str, dict[str, list[float]]]:
    """Extra trips caused by `event`: {station_id: {"entries": [n_bins], "exits": [n_bins]}}.

    `attendance` / `end` override the event's values (live what-if sliders); `scale` multiplies the whole
    surge (used for the p10/p90 attendance band). `metro_share` (weather what-if) and `exit_sigma_min`
    (venue exit window) override the configured assumptions. Totals are conserved exactly: Σ entries = trips_out.
    """
    em = timing_params(event)
    if metro_share is not None:
        em["metro_share"] = float(metro_share)
    if exit_sigma_min is not None:
        em["exit_sigma_min"] = float(exit_sigma_min)
    bph = bins_per_hour or corridor().get("bins_per_hour", 4)
    att = float(event["attendance"] if attendance is None else attendance) * scale
    trips_in = att * em["metro_share"]
    trips_out = trips_in * em["return_factor"]
    arr = gauss_bins(to_min(event["start"]) + em["arrival_offset_min"], em["arrival_sigma_min"], bph)
    dep = gauss_bins(to_min(end or event["end"]) + em["exit_offset_min"], em["exit_sigma_min"], bph)
    return {sid: {"entries": [trips_out * w * d for d in dep], "exits": [trips_in * w * a for a in arr]}
            for sid, w in station_weights(event).items()}


def to_hourly(series: list[float], bins_per_hour: int) -> list[float]:
    return [sum(series[h * bins_per_hour:(h + 1) * bins_per_hour]) for h in range(len(series) // bins_per_hour)]
