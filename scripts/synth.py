"""Generate a clearly-labelled SYNTHETIC hourly station panel so the demo works before real data arrives.
Output: data/synthetic/station_hour_synthetic.parquet (is_synthetic = True on every row)."""
from __future__ import annotations
import sys
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apps.api.eventflow.config import corridor  # noqa: E402

rng = np.random.default_rng(42)
SCALE = {"MAX": 0.7, "WTC": 0.9, "EMT": 1.0, "FIC": 1.1, "BKD": 1.6, "BBY": 1.2}

def hourly_shape(h: int, weekend: bool) -> float:
    am = np.exp(-0.5 * ((h - 8) / 1.2) ** 2)
    pm = np.exp(-0.5 * ((h - 18) / 1.6) ** 2)
    mid = 0.35 * np.exp(-0.5 * ((h - 13) / 3) ** 2)
    night = 0.05 if h < 5 else 0.0
    if weekend:
        return 0.25 * am + 0.6 * pm + 0.6 * mid + 0.4 * np.exp(-0.5 * ((h - 21) / 2) ** 2) + night
    return am + pm + mid + night

def main(weeks: int = 12) -> Path:
    start = pd.Timestamp("2026-07-06")  # Monday; synthetic calendar, not real dates of record
    rows = []
    for d in range(weeks * 7):
        day = start + pd.Timedelta(days=d)
        weekend = day.dayofweek >= 5  # UAE weekend Sat–Sun (post-2022)
        surge_day = d in {20, 41, 62}  # synthetic 'event' days
        for s in [st["id"] for st in corridor()["stations"]]:
            for h in range(24):
                base = 1500 * SCALE[s] * hourly_shape(h, weekend)
                ent = base * rng.lognormal(0, 0.08)
                ex = base * 0.95 * rng.lognormal(0, 0.08)
                if surge_day and s in {"WTC", "EMT"} and h in {18, 19}:
                    ent *= 2.2
                rows.append({"ts": day + pd.Timedelta(hours=h), "station_id": s, "entries": round(ent), "exits": round(ex),
                             "event_flag": int(surge_day), "is_synthetic": True})
    df = pd.DataFrame(rows)
    out = ROOT / "data/synthetic/station_hour_synthetic.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    print(f"SYNTHETIC panel written: {out} rows={len(df)}")
    return out

if __name__ == "__main__":
    main()
