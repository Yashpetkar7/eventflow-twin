"""Build the whole Dubai Metro network from the official RTA GTFS feed.

Input : data/raw/gtfs_official_2021/*.zip (service 2021-09-09..2021-12-31, via Mobility Database mdb-904)
Output: config/network.yaml        stations (id, names EN/AR, coords, lines), line orders, walkable neighbours
        config/capacity_gtfs.yaml  scheduled boardable departures per hour: [daytype][station][line][dir0|dir1]

Rules
- A station = all metro platforms sharing a name ("<Name> Metro Station 1/2"); interchanges carry several lines.
- Featured-corridor stations keep the ids declared in corridor.yaml (matched by gtfs_stop_ids); all other ids
  are derived from the English name (e.g. AL_RIGGA).
- A trip's final stop is not counted: nobody can board there, so a terminus only has capacity in one direction.
- Hours >= 24 (after-midnight trips of the same service day) are folded into hour 0.
- Arabic names come from GTFS translations.txt.

    python scripts/build_network.py
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apps.api.eventflow.event_model import walk_minutes  # noqa: E402

RAW = ROOT / "data/raw/gtfs_official_2021"
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
LINES = {"MRed": "Red", "MGrn": "Green", "MBrch": "Branch"}   # Branch = Jabal Ali–UAE Exchange shuttle (2021 timetable)
PLATFORM = re.compile(r"\s*Metro Station\s*\d\s*$", re.IGNORECASE)
AR_PREFIX = re.compile(r"^محطة المترو_\s*")


def clean_name(raw: str) -> str:
    n = PLATFORM.sub("", raw)
    n = re.sub(r"\(.*?\)", "", n)                 # "Union  (Green Line )" → "Union"
    n = re.sub(r"\s*/\s*", "/", n)                # "Burj Khalifa/ Dubai Mall"
    n = re.sub(r"\s+", " ", n).strip()
    return n[:1].upper() + n[1:]                  # "max" → "Max", "centrepoint" → "Centrepoint"


def clean_ar(raw: str) -> str:
    n = AR_PREFIX.sub("", raw)
    n = re.sub(r"\(.*?\)", "", n)
    n = re.sub(r"\s*\d\s*$", "", n)
    return re.sub(r"\s+", " ", n).strip()


def make_id(name: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")


def main() -> None:
    zips = sorted(RAW.glob("*.zip"))
    if not zips:
        raise SystemExit(f"No GTFS zip in {RAW}. See data/raw/MANIFEST.md.")
    zpath = zips[-1]
    z = zipfile.ZipFile(zpath)
    read = lambda n, **k: pd.read_csv(z.open(n), dtype=str, **k)  # noqa: E731
    routes, trips, cal, stops, tr = (read(f"{n}.txt") for n in ("routes", "trips", "calendar", "stops", "translations"))
    corridor_cfg = yaml.safe_load((ROOT / "config/corridor.yaml").read_text(encoding="utf-8"))

    metro = routes[(routes.route_type == "1") & routes.route_short_name.isin(LINES)]
    mt = trips[trips.route_id.isin(metro.route_id)].merge(metro[["route_id", "route_short_name"]], on="route_id")
    mt["line"] = mt.route_short_name.map(LINES)
    keep = set(mt.trip_id)
    st = pd.concat([c[c.trip_id.isin(keep)] for c in pd.read_csv(
        z.open("stop_times.txt"), dtype=str, usecols=["trip_id", "stop_id", "stop_sequence", "departure_time"],
        chunksize=1_000_000)])
    st = st.merge(mt[["trip_id", "line", "direction_id", "service_id"]], on="trip_id").merge(
        stops[["stop_id", "stop_name", "stop_lat", "stop_lon"]], on="stop_id")
    st["seq"] = st.stop_sequence.astype(int)
    st["name"] = st.stop_name.map(clean_name)
    st["key"] = st.name.str.casefold()

    # ---- stations
    legacy = {str(i): s["id"] for s in corridor_cfg["stations"] for i in s.get("gtfs_stop_ids", [])}
    ar = tr[(tr.table_name == "stops") & (tr.field_name == "stop_name") & (tr.language == "ar")].set_index("record_id").translation
    stations, key_to_id = [], {}
    for key, g in st.groupby("key"):
        stop_ids = sorted(g.stop_id.unique())
        sid = next((legacy[s] for s in stop_ids if s in legacy), None) or make_id(g.name.iloc[0])
        if sid in key_to_id.values():
            raise SystemExit(f"duplicate station id {sid}")
        key_to_id[key] = sid
        pts = g.drop_duplicates("stop_id")
        lines = sorted(g.line.unique(), key=list(LINES.values()).index)
        name_ar = next((clean_ar(ar[s]) for s in stop_ids if s in ar.index), None)
        stations.append({"id": sid, "name_en": g.name.iloc[0], "name_ar": name_ar, "line": lines[0], "lines": lines,
                         "lat": round(float(pts.stop_lat.astype(float).mean()), 6),
                         "lon": round(float(pts.stop_lon.astype(float).mean()), 6),
                         "in_corridor": any(s in legacy for s in stop_ids), "gtfs_stop_ids": [int(s) for s in stop_ids]})
    st["station"] = st.key.map(key_to_id)

    # ---- line orders (longest direction-0 trip) and geographic order for the UI
    line_order = {}
    for line, g in st.groupby("line"):
        longest = g[g.direction_id == "0"].groupby("trip_id").size().idxmax()
        line_order[line] = g[g.trip_id == longest].sort_values("seq").station.tolist()
    rank = {}
    for line in LINES.values():
        for s in line_order.get(line, []):
            rank.setdefault(s, len(rank))
    stations.sort(key=lambda s: rank[s["id"]])

    # ---- walkable neighbours: adjacent on a line and within the walking limit
    limit = corridor_cfg["interventions"]["bounds"]["max_redirect_walk_min"]
    by_id = {s["id"]: s for s in stations}
    neighbours: dict[str, list[str]] = {s["id"]: [] for s in stations}
    for order in line_order.values():
        for a, b in zip(order, order[1:]):
            if walk_minutes(by_id[a]["lat"], by_id[a]["lon"], by_id[b]["lat"], by_id[b]["lon"]) <= limit:
                neighbours[a].append(b) if b not in neighbours[a] else None
                neighbours[b].append(a) if a not in neighbours[b] else None

    # ---- boardable departures per hour (exclude each trip's final stop)
    last = st.groupby("trip_id").seq.transform("max")
    dep = st[st.seq < last].copy()
    dep["hour"] = dep.departure_time.str.split(":").str[0].astype(int) % 24
    c = cal.set_index("service_id")
    dep["daytype"] = dep.service_id.map(lambda s: "+".join(d[:3] for d in DAYS if c.loc[s, d] == "1"))
    tph: dict = {}
    counts = dep.groupby(["daytype", "station", "line", "direction_id", "hour"]).size()
    for (daytype, station, line, direction), g in counts.groupby(level=[0, 1, 2, 3]):
        hours = g.droplevel([0, 1, 2, 3])
        tph.setdefault(daytype, {}).setdefault(station, {}).setdefault(line, {"dir0": [0] * 24, "dir1": [0] * 24})[
            f"dir{direction}"] = [int(hours.get(h, 0)) for h in range(24)]

    provenance = {
        "source": "RTA GTFS schedule feed (official), via Mobility Database mdb-904",
        "url": "https://files.mobilitydatabase.org/mdb-904/mdb-904-202406071531/mdb-904-202406071531.zip",
        "file": zpath.name, "sha256": hashlib.sha256(zpath.read_bytes()).hexdigest(),
        "service_period": f"{cal.start_date.min()}..{cal.end_date.max()}", "generated": dt.date.today().isoformat(),
        "licence": "Dubai Pulse / RTA open data terms; credit RTA open data",
    }
    head = "# GENERATED by scripts/build_network.py — do not edit by hand\n"
    (ROOT / "config/network.yaml").write_text(head + yaml.safe_dump(
        {"_provenance": provenance, "lines": line_order, "neighbours": neighbours, "stations": stations},
        sort_keys=False, allow_unicode=True, width=200), encoding="utf-8")
    (ROOT / "config/capacity_gtfs.yaml").write_text(head + yaml.safe_dump(
        {"_provenance": {**provenance, "notes": "Boardable departures per clock hour (a trip's final stop excluded); "
                         "hours >= 24 folded into 0. 2021 calendar = Fri–Sat weekend; see corridor.yaml "
                         "capacity.gtfs_daytype_for_weekday."}, "trains_per_hour": tph},
        sort_keys=False, default_flow_style=None, width=200), encoding="utf-8")
    print(f"network: {len(stations)} stations, lines {{{', '.join(f'{k}: {len(v)}' for k, v in line_order.items())}}}, "
          f"{sum(len(v) for v in neighbours.values()) // 2} walkable pairs, {len(tph)} day types")


if __name__ == "__main__":
    main()
