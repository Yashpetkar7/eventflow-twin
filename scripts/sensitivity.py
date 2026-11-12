"""Break-point sensitivity: at what attendance does each event first push a station over the comfort threshold,
for a range of `boardable_share` (space left on arriving trains) and `metro_share` values?

These two are the softest assumptions until metro ridership (origin–destination) data is ingested, so instead of
tuning them we publish how the conclusion depends on them. Writes eval/results/sensitivity_<ts>.json.

    python scripts/sensitivity.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apps.api.eventflow.config import corridor, events  # noqa: E402
from apps.api.eventflow.event_model import station_weights  # noqa: E402
from apps.api.eventflow.forecast import build_forecast  # noqa: E402
from apps.api.eventflow.simulate import simulate  # noqa: E402
from eval.common import write_result  # noqa: E402

BOARDABLE = [0.15, 0.20, 0.25, 0.30, 0.35]
METRO_SHARE = [0.35, 0.45, 0.55]
ATTENDANCE = list(range(5000, 150001, 2500))


def break_point(event_id: str) -> tuple[int | None, str | None]:
    """Smallest attendance at which a station that receives the event's trips goes over the comfort threshold,
    and the station/hour where it happens first. Stations the event does not reach are ignored: across the
    whole network some may be over the line for unrelated reasons, which says nothing about the event."""
    ev = next(e for e in events() if e["id"] == event_id)
    served = {s for s, w in station_weights(ev).items() if w > 0}
    thr = corridor()["capacity"]["overcap_threshold"]
    for att in ATTENDANCE:
        fc = build_forecast(event_id, attendance=att)
        res = simulate(fc["demand"], weekday=fc["weekday"])
        hot = [r for r in res.hourly if r["station_id"] in served and r["peak_lf"] > thr]
        if hot:
            worst = max(hot, key=lambda r: r["peak_lf"])
            return att, f"{worst['station_id']} {worst['hour']:02d}:00"
    return None, None


def main() -> None:
    cfg = corridor()                      # cached dict; mutated in-process only, restored at the end
    original = (cfg["capacity"]["boardable_share"], cfg["event_model"]["metro_share"])
    rows = []
    try:
        for ev in events():
            for ms in METRO_SHARE:
                for bs in BOARDABLE:
                    cfg["capacity"]["boardable_share"], cfg["event_model"]["metro_share"] = bs, ms
                    att, where = break_point(ev["id"])
                    rows.append({"event_id": ev["id"], "assumed_attendance": ev["attendance"], "metro_share": ms,
                                 "boardable_share": bs, "break_attendance": att, "first_hotspot": where})
    finally:
        cfg["capacity"]["boardable_share"], cfg["event_model"]["metro_share"] = original

    print("event         metro_share  " + "  ".join(f"bs={b:.2f}" for b in BOARDABLE))
    for ev in events():
        for ms in METRO_SHARE:
            cells = [r for r in rows if r["event_id"] == ev["id"] and r["metro_share"] == ms]
            print(f"{ev['id']:<13} {ms:<12} " + "  ".join(f"{(r['break_attendance'] or 0):>7,}" for r in cells))
    defaults = {r["event_id"]: r["break_attendance"] for r in rows
                if r["boardable_share"] == original[0] and r["metro_share"] == original[1]}
    metrics = {f"break_attendance_default__{k}": v for k, v in defaults.items()}
    fc = build_forecast(events()[0]["id"])
    p = write_result("sensitivity", metrics, n=len(rows), split="scenario-grid",
                     models={"simulator": "deterministic-15min-queue", "capacity": cfg["capacity"].get("source")},
                     dataset_version=fc["dataset_version"], is_synthetic=fc["is_synthetic"], grid=rows,
                     note="break_attendance = smallest attendance (2,500 steps) at which a station receiving the event's trips has a 15-min bin over the comfort threshold")
    print(f"written {p.name}")


if __name__ == "__main__":
    main()
