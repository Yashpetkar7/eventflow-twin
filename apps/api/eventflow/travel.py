"""Rider travel advice (decision #140): "when should I leave, from which station, and how long will I wait?"

Everything comes from the simulator's answer for the scenario (15-minute rows: load and platform wait per station)
with the measures a duty manager approved and published; walking time to a neighbouring station is distance ÷ an
assumed walking speed (config/travel.yaml, labelled). No language model is involved. Each figure carries the
simulator run behind it.
"""
from __future__ import annotations

from functools import lru_cache

import yaml

from .config import ROOT, corridor


@lru_cache(maxsize=1)
def settings() -> dict:
    return yaml.safe_load((ROOT / "config/travel.yaml").read_text(encoding="utf-8"))


def _km(a: dict, b: dict) -> float:
    from .event_model import _haversine_km
    return _haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])


def _hour_view(rows: list[dict], hourly: list[dict], station: str, hour: int) -> dict:
    """Peak load (hourly row) and longest platform wait (15-minute rows) at a station in one hour."""
    h = next((r for r in hourly if r["station_id"] == station and r["hour"] == hour), None)
    waits = [r["wait_min"] for r in rows if r["station_id"] == station and int(r["time"][:2]) == hour]
    return {"hour": hour, "load": round(h["peak_lf"], 3) if h else None, "wait_min": round(max(waits), 1) if waits else 0.0,
            "trains_per_hour": h["trains_per_hour"] if h else None}


def advice(sim: dict, station: str, hour: int, threshold: float, applied: list[dict], notices: list[dict]) -> dict:
    """`sim`: a /simulate answer with detail rows. Returns the advice for a rider at `station` at `hour`."""
    cfg, t = corridor(), settings()
    by = {s["id"]: s for s in cfg["stations"]}
    if station not in by:
        raise KeyError(station)
    rows, hourly = sim.get("rows") or [], sim["hourly"]
    horizon = [h for h in range(hour, min(24, hour + int(t["horizon_h"]) + 1))]
    ahead = [_hour_view(rows, hourly, station, h) for h in horizon]
    now = ahead[0]
    quiet = float(t["quiet_wait_min"])

    def easy(v: dict) -> bool:
        return v["load"] is not None and v["load"] <= threshold and v["wait_min"] <= quiet

    status = "closed" if (now["trains_per_hour"] or 0) == 0 else "easy" if easy(now) else "busy" if now["load"] <= threshold else "crowded"
    busy_until = None
    if status in ("busy", "crowded"):
        later = next((v for v in ahead[1:] if easy(v)), None)
        busy_until = later["hour"] if later else None
    leave_later = None
    if status in ("busy", "crowded"):
        later = next((v for v in ahead[1:] if easy(v)), None)
        if later:
            leave_later = {"hour": later["hour"], "wait_min": later["wait_min"], "saves_min": round(max(0.0, now["wait_min"] - later["wait_min"]), 1)}
    alts = []
    for nb in cfg["neighbours"].get(station, []):
        if nb not in by:
            continue
        walk = _km(by[station], by[nb]) / float(t["walk_kmh"]) * 60
        if walk > float(t["walk_max_min"]):
            continue
        v = _hour_view(rows, hourly, nb, hour)
        if v["load"] is None or (v["trains_per_hour"] or 0) == 0:
            continue
        alts.append({"station": nb, "walk_min": round(walk), "load": v["load"], "wait_min": v["wait_min"],
                     "better": v["wait_min"] + walk < now["wait_min"] or (v["load"] <= threshold < now["load"])})
    alts.sort(key=lambda a: (not a["better"], a["wait_min"] + a["walk_min"], a["station"]))
    metered = sorted({iv["params"].get("station") for iv in applied if iv.get("type") == "station_metering"} - {None})
    # a notice names its stations; a line-wide measure (extra trains) names none and applies to every station
    mine = [n for n in notices if not n.get("stations") or station in n["stations"]]
    return {"station": station, "hour": hour, "status": status, "now": now, "ahead": ahead, "busy_until": busy_until,
            "leave_later": leave_later, "alternatives": alts[:3], "entry_metered": station in metered, "metered_stations": metered,
            "notices": mine, "threshold": threshold, "is_synthetic": sim["is_synthetic"],
            "assumptions": {"walk_kmh": t["walk_kmh"], "quiet_wait_min": quiet},
            "source": {"tool": "simulate", "run_id": sim["run_id"], "forecast_run_id": sim["source_forecast"]}}
