"""Scenario forecast service: background demand + parametric event overlay → per-station demand.

Background (v1, this file): empirical p10/p50/p90 of the same weekday's non-event days in the panel.
Stream A replaces `background_quantiles` with the LightGBM quantile model + conformal calibration; the
output shape stays identical, so the API and UI do not change.

Run ids are deterministic (hash of request + dataset version + config), so a restarted API, the offline
demo cache and the evaluation suites all refer to the same run for the same inputs.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

from .config import ROOT, corridor, events
from .event_model import overlay
from .simulate import Demand, bins_per_hour, hourly_to_bins

REAL = ROOT / "data/processed/station_hour.parquet"
SYNTH = ROOT / "data/synthetic/station_hour_synthetic.parquet"


class NoDataError(RuntimeError):
    pass


@dataclass(frozen=True)
class Panel:
    df: pd.DataFrame
    dataset_version: str
    is_synthetic: bool
    path: Path


def _file_sig(p: Path) -> str:
    st = p.stat()
    return f"{st.st_size}-{int(st.st_mtime)}"


@lru_cache(maxsize=4)
def _load(path_str: str, sig: str) -> Panel:
    p = Path(path_str)
    df = pd.read_parquet(p)
    df["ts"] = pd.to_datetime(df["ts"])
    if "event_flag" not in df:
        df["event_flag"] = 0
    is_syn = bool(df["is_synthetic"].any()) if "is_synthetic" in df else False
    kind = "synthetic" if is_syn else "real"
    version = f"{kind}:{df.ts.min().date()}..{df.ts.max().date()}:{len(df)}rows"
    return Panel(df=df, dataset_version=version, is_synthetic=is_syn, path=p)


def load_panel() -> Panel:
    """Real processed panel if present, else the labelled synthetic panel."""
    p = REAL if REAL.exists() else SYNTH
    if not p.exists():
        raise NoDataError("No data. Run `python tasks.py synth` (or the Phase 1 ingest).")
    return _load(str(p), _file_sig(p))


def config_hash() -> str:
    h = hashlib.sha256()
    for f in ("config/corridor.yaml", "config/events.yaml"):
        h.update((ROOT / f).read_bytes())
    return h.hexdigest()[:10]


@lru_cache(maxsize=32)
def _background(path_str: str, sig: str, weekday: int) -> dict[str, dict[str, dict[str, list[float]]]]:
    df = _load(path_str, sig).df
    sub = df[(df.ts.dt.day_of_week == weekday) & (df.event_flag == 0)]
    if sub.empty:
        sub = df[df.event_flag == 0]
    q = (sub.assign(hour=sub.ts.dt.hour).groupby(["station_id", "hour"])[["entries", "exits"]]
         .quantile([0.1, 0.5, 0.9]).unstack())           # columns: (col, quantile)
    hours = range(24)
    out: dict = {}
    for s in [st["id"] for st in corridor()["stations"]]:
        rows = q.loc[s].reindex(hours).fillna(0.0) if s in q.index.get_level_values(0) else None
        out[s] = {col: {name: ([float(v) for v in rows[(col, qq)]] if rows is not None else [0.0] * 24)
                        for name, qq in (("p10", 0.1), ("p50", 0.5), ("p90", 0.9))} for col in ("entries", "exits")}
    return out


def background_quantiles(panel: Panel, weekday: int) -> dict[str, dict[str, dict[str, list[float]]]]:
    """{station: {"entries"|"exits": {"p10"|"p50"|"p90": [24]}}} from same-weekday non-event days (cached)."""
    return _background(str(panel.path), _file_sig(panel.path), weekday)


def find_event(event_id: str | None) -> dict | None:
    if not event_id:
        return None
    ev = next((e for e in events() if e["id"] == event_id), None)
    if ev is None:
        raise KeyError(event_id)
    return ev


def make_run_id(prefix: str, payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str).encode()
    return f"{prefix}_{hashlib.sha256(blob).hexdigest()[:12]}"


def build_forecast(event_id: str | None = None, date: str | None = None, weekday: int | None = None,
                   attendance: float | None = None, end: str | None = None) -> dict:
    """Return {run_id, demand (bins, p50), rows (hourly p10/p50/p90), meta...}. Pure for fixed data+config."""
    panel = load_panel()
    ev = find_event(event_id)
    if weekday is None:
        day = date or (ev or {}).get("date")
        weekday = dt.date.fromisoformat(day).weekday() if day else 2
    payload = {"event_id": event_id, "date": date, "weekday": weekday, "attendance": attendance, "end": end,
               "dataset": panel.dataset_version, "config": config_hash()}
    run_id = make_run_id("fc", payload)

    bph = bins_per_hour()
    bg = background_quantiles(panel, weekday)
    lo, hi = corridor()["event_model"]["attendance_band"]
    ov = {k: overlay(ev, bins_per_hour=1, attendance=attendance, end=end, scale=m) for k, m in
          (("p10", lo), ("p50", 1.0), ("p90", hi))} if ev else {}
    ov_bins = overlay(ev, bins_per_hour=bph, attendance=attendance, end=end) if ev else {}

    demand: Demand = {}
    rows = []
    for s, cols in bg.items():
        demand[s] = {"base": hourly_to_bins(cols["entries"]["p50"], bph),
                     "event": list(ov_bins[s]["entries"]) if ev else [0.0] * (24 * bph)}
        for h in range(24):
            row = {"station_id": s, "hour": h}
            for col in ("entries", "exits"):
                for qn in ("p10", "p50", "p90"):
                    extra = ov[qn][s][col][h] if ev else 0.0
                    row[f"{col}_{qn}"] = round(cols[col][qn][h] + extra, 1)
            row["event_entries_p50"] = round(ov["p50"][s]["entries"][h], 1) if ev else 0.0
            rows.append(row)

    return {
        "run_id": run_id,
        "model": "empirical-weekday-quantiles + parametric-event-overlay (v1)",
        "dataset_version": panel.dataset_version,
        "is_synthetic": panel.is_synthetic,
        "event": ev,
        "event_is_assumption": bool(ev and ev.get("is_assumption")),
        "weekday": weekday,
        "attendance_used": (attendance if attendance is not None else ev["attendance"]) if ev else None,
        "end_used": (end or ev["end"]) if ev else None,
        "band_note": "p10/p90 = background weekday quantiles + event surge at attendance × "
                     f"{lo}/{hi} (assumption band, not a calibrated interval)",
        "demand": demand,
        "rows": rows,
    }
