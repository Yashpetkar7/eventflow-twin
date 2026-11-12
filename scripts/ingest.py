"""Ingest RTA's open metro ridership (data.dubai "Dubai Metro Ridership", https://data.dubai/en/l/466403).

    python tasks.py ingest                                    # = python scripts/ingest.py  (report only)
    python scripts/ingest.py --start 2025-09-01 --end 2025-12-31 --write-panel

What the data looks like (checked 12 Nov 2026, see docs/14_RIDERSHIP_DATA.md):
  * 3,141 files `metro_ridership_<export>_<NNNN>.csv.gz`, ~155 MB each (~490 GB in all), Dubai Open Data Licence.
  * One row per fare-gate transaction: end_location, end_zone, line_name, start_location, start_zone, txn_date,
    txn_time, txn_type ("Check in" / "Check out"), load_timestamp. Station names like
    "Burj Khalifa/ Dubai Mall Metro Station"; old station names appear (the data runs 2017–2026).
  * Each file is a MIXED SAMPLE across all dates, not a block of days. So a handful of files gives every day, but
    only a fraction of each day's taps; counts are scaled by total_files / files_read (assumes the split is random —
    the report checks how even it is) or, better, to official monthly station totals (--ddse).

Steps:
  1. read every data/raw/ridership/*.csv.gz in chunks, keep the date window, map station names
     (config/corridor.yaml + config/station_aliases.yaml) → sample counts per station, date and hour:
     entries = "Check in" at start_location, exits = "Check out" at end_location   → data/interim/ridership_counts.parquet
  2. write a check report → eval/results/ridership_check_<YYYYMMDD-HHMM>.json: coverage, unmatched names, how sparse
     the sample is, real vs synthetic station volumes and hourly shapes, and GITEX 2025 (13–17 Oct) at World Trade
     Centre against the same weekdays around it.
  3. only with --write-panel (and enough data, or --force): data/processed/station_hour.parquet in the forecast's
     panel format. The API then uses it automatically instead of the synthetic panel — every number on screen
     changes, so follow docs/14_RIDERSHIP_DATA.md §5 afterwards (evals, caches, snapshot, metrics, poster numbers).
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/ridership"
INTERIM = ROOT / "data/interim/ridership_counts.parquet"
PANEL = ROOT / "data/processed/station_hour.parquet"
SYNTH = ROOT / "data/synthetic/station_hour_synthetic.parquet"
RESULTS = ROOT / "eval/results"
TOTAL_FILES = 3141                                   # files listed on data.dubai on 12 Nov 2026
GITEX_DAYS = [f"2025-10-{d}" for d in range(13, 18)]  # GITEX Global 2025 ran 13–17 Oct (config/events.yaml)
USECOLS = ["start_location", "end_location", "txn_date", "txn_time", "txn_type"]
MIN_CELL = 20                                        # median sample taps per corridor station-hour before a panel is trusted


# ---------------------------------------------------------------- station names
def norm(name: str) -> str:
    s = (name or "").lower().replace("&", "and")
    s = re.sub(r"\bmetro\s+station\b|\bstation\b|\bmetro\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def station_mapper(cfg: dict | None = None, aliases: dict | None = None):
    cfg = cfg or yaml.safe_load((ROOT / "config/corridor.yaml").read_text(encoding="utf-8"))
    if aliases is None:
        p = ROOT / "config/station_aliases.yaml"
        aliases = (yaml.safe_load(p.read_text(encoding="utf-8")) or {}).get("aliases", {}) if p.exists() else {}
    table = {norm(s["name_en"]): s["id"] for s in cfg["stations"]}
    table |= {norm(s["id"].replace("_", " ")): s["id"] for s in cfg["stations"]}
    table |= {norm(k): v for k, v in aliases.items()}
    cache: dict[str, str | None] = {}

    def to_id(name: str) -> str | None:
        if name not in cache:
            cache[name] = table.get(norm(name))
        return cache[name]
    return to_id


# ---------------------------------------------------------------- step 1: sample counts
def read_counts(files: list[Path], start: str, end: str, chunksize: int = 2_000_000, to_id=None) -> tuple[pd.DataFrame, dict]:
    to_id = to_id or station_mapper()
    parts, unmatched = [], collections.Counter()
    st = {"rows_read": 0, "rows_in_window": 0, "rows_mapped": 0, "duplicate_rows": 0, "txn_types": collections.Counter(),
          "date_min": None, "date_max": None, "files": [f.name for f in files]}
    for f in files:
        for ch in pd.read_csv(f, usecols=USECOLS, dtype=str, chunksize=chunksize, compression="infer"):
            st["rows_read"] += len(ch)
            st["duplicate_rows"] += int(ch.duplicated().sum())
            dmin, dmax = ch["txn_date"].min(), ch["txn_date"].max()
            st["date_min"] = min(filter(None, [st["date_min"], dmin]))
            st["date_max"] = max(filter(None, [st["date_max"], dmax]))
            ch = ch[(ch["txn_date"] >= start) & (ch["txn_date"] <= end)]
            st["rows_in_window"] += len(ch)
            st["txn_types"].update(ch["txn_type"].value_counts().to_dict())
            typ = ch["txn_type"].str.lower().str.replace(" ", "", regex=False)
            name = np.where(typ == "checkin", ch["start_location"], ch["end_location"])
            sid = pd.Series(name, index=ch.index).map(to_id)
            miss = sid.isna()
            unmatched.update(pd.Series(name, index=ch.index)[miss].value_counts().to_dict())
            ok = ~miss & typ.isin(["checkin", "checkout"])
            ch = ch[ok]
            st["rows_mapped"] += len(ch)
            g = pd.DataFrame({"date": ch["txn_date"], "hour": ch["txn_time"].str[:2].astype(int), "station_id": sid[ok],
                              "entries": (typ[ok] == "checkin").astype(int), "exits": (typ[ok] == "checkout").astype(int)})
            parts.append(g.groupby(["date", "hour", "station_id"], as_index=False)[["entries", "exits"]].sum())
    counts = (pd.concat(parts).groupby(["date", "hour", "station_id"], as_index=False)[["entries", "exits"]].sum()
              if parts else pd.DataFrame(columns=["date", "hour", "station_id", "entries", "exits"]))
    st["unmatched_top"] = unmatched.most_common(25)
    st["txn_types"] = dict(st["txn_types"])
    return counts, st


# ---------------------------------------------------------------- step 2: report
def _corridor() -> list[str]:
    cfg = yaml.safe_load((ROOT / "config/corridor.yaml").read_text(encoding="utf-8"))
    return [s["id"] for s in cfg["stations"] if s.get("in_corridor")]


def _weekdays(df: pd.DataFrame) -> pd.DataFrame:
    d = pd.to_datetime(df["date"])
    return df[(d.dt.day_of_week < 5) & ~df["date"].isin(GITEX_DAYS)]       # Mon–Fri, UAE weekend is Sat–Sun


def gitex_check(counts: pd.DataFrame, scale: float, station: str = "WTC") -> dict:
    """Entries on GITEX days vs the same weekdays in the 4 weeks before and after (sample counts and a 95 % CI)."""
    s = counts[counts.station_id == station]
    days = pd.to_datetime(pd.Series(GITEX_DAYS))
    comp = sorted({(d + pd.Timedelta(weeks=w)).strftime("%Y-%m-%d") for d in days for w in (-4, -3, -2, -1, 1, 2, 3, 4)})
    ev = s[s.date.isin(GITEX_DAYS)].groupby("date").entries.sum()
    base = s[s.date.isin(comp)].groupby("date").entries.sum()
    if ev.empty or base.empty:
        return {"station": station, "status": "no data for these days in the files read"}
    a, b = float(ev.mean()), float(base.mean())
    ratio = a / b if b else math.nan
    se = math.sqrt(1 / max(ev.sum(), 1) + 1 / max(base.sum(), 1))     # Poisson, on the log scale
    hours = (s[s.date.isin(GITEX_DAYS)].groupby("hour").entries.sum() / len(ev)
             - s[s.date.isin(comp)].groupby("hour").entries.sum() / len(base)).reindex(range(24), fill_value=0)
    return {"station": station, "event_days_found": len(ev), "comparison_days_found": len(base),
            "sample_entries_per_event_day": round(a, 1), "sample_entries_per_comparison_day": round(b, 1),
            "scaled_entries_per_event_day": round(a * scale), "scaled_entries_per_comparison_day": round(b * scale),
            "uplift_ratio": round(ratio, 3), "uplift_ratio_ci95": [round(ratio * math.exp(-1.96 * se), 3), round(ratio * math.exp(1.96 * se), 3)],
            "extra_entries_by_hour_scaled": [round(float(v) * scale) for v in hours],
            "note": "Sample counts × scale. A CI that includes 1.0 means no detectable GITEX effect at this sample size."}


def report(counts: pd.DataFrame, st: dict, scale: float, scale_note: str, start: str, end: str) -> dict:
    cor = _corridor()
    wk = _weekdays(counts[counts.station_id.isin(cor)])
    n_days = max(wk.date.nunique(), 1)
    # sparsity over the FULL grid (corridor stations × weekdays × 06–23 h), zeros included — taps in and out
    grid = pd.MultiIndex.from_product([sorted(wk.date.unique()), range(6, 24), cor], names=["date", "hour", "station_id"])
    day_hours = (wk.assign(taps=wk.entries + wk.exits).groupby(["date", "hour", "station_id"]).taps.sum()
                 .reindex(grid, fill_value=0)) if not wk.empty else pd.Series(dtype=float)
    per_station = {}
    synth = pd.read_parquet(SYNTH) if SYNTH.exists() else None
    if synth is not None:
        synth["ts"] = pd.to_datetime(synth["ts"])
        sw = synth[(synth.ts.dt.day_of_week < 5) & (synth.event_flag == 0)]
    for s in cor:
        r = wk[wk.station_id == s]
        real_day = r.entries.sum() / n_days * scale
        shape_r = r.groupby("hour").entries.sum().reindex(range(24), fill_value=0)
        row = {"weekday_entries_per_day_scaled": round(float(real_day)), "sample_taps": int(r.entries.sum() + r.exits.sum())}
        if synth is not None:
            ss = sw[sw.station_id == s]
            syn_day = ss.entries.sum() / max(ss.ts.dt.date.nunique(), 1)
            shape_s = ss.groupby(ss.ts.dt.hour).entries.sum().reindex(range(24), fill_value=0)
            row |= {"synthetic_weekday_entries_per_day": round(float(syn_day)),
                    "real_over_synthetic": round(float(real_day / syn_day), 3) if syn_day else None,
                    "hourly_shape_correlation": round(float(np.corrcoef(shape_r, shape_s)[0, 1]), 3) if shape_r.sum() and shape_s.sum() else None}
        per_station[s] = row
    by_date = counts.groupby("date").entries.sum()
    metrics = {
        "files_read": len(st["files"]), "rows_read": st["rows_read"], "rows_in_window": st["rows_in_window"],
        "mapped_share": round(st["rows_mapped"] / st["rows_in_window"], 4) if st["rows_in_window"] else 0.0,
        "duplicate_share": round(st["duplicate_rows"] / st["rows_read"], 4) if st["rows_read"] else 0.0,
        "data_date_min": st["date_min"], "data_date_max": st["date_max"], "window": [start, end],
        "days_in_window_with_data": int(by_date.size),
        "evenness_cv_of_daily_sample": round(float(by_date.std() / by_date.mean()), 3) if by_date.size > 1 else None,
        "median_sample_taps_per_corridor_station_hour": float(day_hours.median()) if not day_hours.empty else 0.0,
        "panel_ready": bool(not day_hours.empty and day_hours.median() >= MIN_CELL),
        "scale_factor": round(scale, 3), "scale_method": scale_note,
        "corridor_stations": per_station, "gitex_2025_wtc": gitex_check(counts, scale, "WTC"),
        "gitex_2025_emt": gitex_check(counts, scale, "EMT"), "unmatched_station_names": st["unmatched_top"],
        "txn_types": st["txn_types"],
    }
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        sha = ""
    return {"suite": "ridership_check", "git_sha": sha, "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
            "models": None, "dataset_version": f"rta_metro_ridership_open:{len(st['files'])}files:{start}..{end}",
            "metrics": metrics, "n": int(counts.entries.sum() + counts.exits.sum()), "split": "all", "is_synthetic": False}


# ---------------------------------------------------------------- step 3: panel
def ddse_scale(counts: pd.DataFrame, path: Path) -> pd.DataFrame:
    """Per station and month: official check-ins / sample check-ins. CSV columns: station, month (YYYY-MM), checkins."""
    to_id = station_mapper()
    off = pd.read_csv(path)
    off["station_id"] = off["station"].map(to_id)
    off = off.dropna(subset=["station_id"]).groupby(["station_id", "month"], as_index=False).checkins.sum()
    smp = counts.assign(month=counts.date.str[:7]).groupby(["station_id", "month"], as_index=False).entries.sum()
    m = off.merge(smp, on=["station_id", "month"])
    m["factor"] = m.checkins / m.entries.where(m.entries > 0)
    return m[["station_id", "month", "factor"]]


def to_panel(counts: pd.DataFrame, scale: float, factors: pd.DataFrame | None, source: str) -> pd.DataFrame:
    full = pd.MultiIndex.from_product([sorted(counts.date.unique()), range(24), sorted(counts.station_id.unique())],
                                      names=["date", "hour", "station_id"])
    p = counts.set_index(["date", "hour", "station_id"]).reindex(full, fill_value=0).reset_index()
    if factors is not None:
        p = p.assign(month=p.date.str[:7]).merge(factors, on=["station_id", "month"], how="left")
        f = p.pop("factor").fillna(scale)
        p = p.drop(columns="month")
    else:
        f = scale
    p["entries"] = (p.entries * f).round().astype(int)
    p["exits"] = (p.exits * f).round().astype(int)
    p["ts"] = pd.to_datetime(p.date) + pd.to_timedelta(p.hour, unit="h")
    p["event_flag"] = p.date.isin(GITEX_DAYS).astype(int)
    p["is_synthetic"] = False
    p["source_file"] = source
    return p[["ts", "station_id", "entries", "exits", "event_flag", "is_synthetic", "source_file"]].sort_values(["ts", "station_id"])


def _rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Ingest RTA metro ridership chunks → counts, check report, optional panel.")
    ap.add_argument("--raw", type=Path, default=RAW)
    ap.add_argument("--start", default="2025-07-01")
    ap.add_argument("--end", default="2025-12-31")
    ap.add_argument("--total-files", type=int, default=TOTAL_FILES, help="files in the full dataset (for scaling)")
    ap.add_argument("--ddse", type=Path, default=None, help="official monthly check-ins per station (CSV: station,month,checkins)")
    ap.add_argument("--write-panel", action="store_true", help="write data/processed/station_hour.parquet (the API switches to it)")
    ap.add_argument("--force", action="store_true", help="write the panel even if the sample is sparse")
    a = ap.parse_args(argv)

    files = sorted(a.raw.glob("*.csv.gz")) + sorted(a.raw.glob("*.csv"))
    if not files:
        print(f"No files in {a.raw}. Download chunks from https://data.dubai/en/l/466403 (docs/14_RIDERSHIP_DATA.md).")
        return 1
    print(f"reading {len(files)} file(s), window {a.start} … {a.end}")
    counts, st = read_counts(files, a.start, a.end)
    INTERIM.parent.mkdir(parents=True, exist_ok=True)
    counts.to_parquet(INTERIM, index=False)
    scale = a.total_files / len(files)
    factors = ddse_scale(counts, a.ddse) if a.ddse else None
    note = (f"official monthly check-ins per station ({a.ddse.name}); fallback ×{scale:.1f}" if factors is not None
            else f"files: {a.total_files} total / {len(files)} read (assumes a random split)")
    rep = report(counts, st, scale, note, a.start, a.end)
    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"ridership_check_{dt.datetime.now():%Y%m%d-%H%M}.json"
    out.write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
    m = rep["metrics"]
    print(f"rows read {m['rows_read']:,}; in window {m['rows_in_window']:,}; mapped {m['mapped_share']:.1%}; "
          f"days {m['days_in_window_with_data']}; median taps per corridor station-hour {m['median_sample_taps_per_corridor_station_hour']}")
    if m["unmatched_station_names"]:
        print("unmatched names (add to config/station_aliases.yaml):", m["unmatched_station_names"][:10])
    g = m["gitex_2025_wtc"]
    print("GITEX 2025 at World Trade Centre:", {k: g[k] for k in ("uplift_ratio", "uplift_ratio_ci95") if k in g} or g)
    print(f"report → {_rel(out)}")
    if a.write_panel:
        if not m["panel_ready"] and not a.force:
            print(f"Panel NOT written: median {m['median_sample_taps_per_corridor_station_hour']} sample taps per corridor "
                  f"station-hour < {MIN_CELL}. Download more files, or pass --force (the forecast would be noisy).")
            return 2
        panel = to_panel(counts, scale, factors, f"rta_metro_ridership_open:{len(files)}files")
        PANEL.parent.mkdir(parents=True, exist_ok=True)
        panel.to_parquet(PANEL, index=False)
        print(f"panel → {_rel(PANEL)} ({len(panel):,} rows). The API now uses REAL data: follow "
              "docs/14_RIDERSHIP_DATA.md §5.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
