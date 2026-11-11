"""Generate a clearly-labelled SYNTHETIC hourly station panel so the demo works before real data arrives.

Event days are generated with the SAME parametric overlay the forecaster uses (apps/api/eventflow/event_model.py),
so the backtest exercises the real event path rather than a hard-coded bump.
Output: data/synthetic/station_hour_synthetic.parquet (is_synthetic = True on every row).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apps.api.eventflow.config import corridor  # noqa: E402
from apps.api.eventflow.event_model import overlay  # noqa: E402

SCALE = {"MAX": 0.7, "WTC": 0.9, "EMT": 1.0, "FIC": 1.1, "BKD": 1.6, "BBY": 1.2}

# Synthetic events (NOT real events): venue near World Trade Centre, evening exit surges.
SYNTH_EVENTS = {
    20: {"id": "synth_a", "lat": 25.2240, "lon": 55.2870, "start": "10:00", "end": "18:00", "attendance": 12000},
    41: {"id": "synth_b", "lat": 25.2240, "lon": 55.2870, "start": "16:00", "end": "21:00", "attendance": 9000},
    62: {"id": "synth_c", "lat": 25.2178, "lon": 55.2823, "start": "09:30", "end": "18:00", "attendance": 15000},
}


def hourly_shape(h: int, weekend: bool) -> float:
    am = np.exp(-0.5 * ((h - 8) / 1.2) ** 2)
    pm = np.exp(-0.5 * ((h - 18) / 1.6) ** 2)
    mid = 0.35 * np.exp(-0.5 * ((h - 13) / 3) ** 2)
    night = 0.05 if h < 5 else 0.0
    if weekend:
        return 0.25 * am + 0.6 * pm + 0.6 * mid + 0.4 * np.exp(-0.5 * ((h - 21) / 2) ** 2) + night
    return am + pm + mid + night


def main(weeks: int = 12, seed: int = 42) -> Path:
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-07-06")  # Monday; synthetic calendar, not real dates of record
    stations = [st["id"] for st in corridor()["stations"]]
    rows = []
    for d in range(weeks * 7):
        day = start + pd.Timedelta(days=d)
        weekend = day.day_of_week >= 5  # UAE weekend Sat–Sun (post-2022)
        ev = SYNTH_EVENTS.get(d)
        extra = overlay(ev, bins_per_hour=1) if ev else {}
        for s in stations:
            for h in range(24):
                base = 1500 * SCALE[s] * hourly_shape(h, weekend)
                ent = base * rng.lognormal(0, 0.08)
                ex = base * 0.95 * rng.lognormal(0, 0.08)
                if ev:
                    ent += extra[s]["entries"][h] * rng.lognormal(0, 0.10)
                    ex += extra[s]["exits"][h] * rng.lognormal(0, 0.10)
                rows.append({"ts": day + pd.Timedelta(hours=h), "station_id": s, "entries": round(ent),
                             "exits": round(ex), "event_flag": int(ev is not None), "is_synthetic": True,
                             "source_file": "synthetic"})
    df = pd.DataFrame(rows)
    out = ROOT / "data/synthetic/station_hour_synthetic.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    print(f"SYNTHETIC panel written: {out} rows={len(df)}")
    return out


if __name__ == "__main__":
    main()
