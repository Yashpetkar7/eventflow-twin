"""Build the web app's offline map geometry from the official RTA GTFS feed (no remote tiles needed).

Output: apps/web/public/geo/metro.geojson
  - LineString per metro route (longest shape of direction 0), properties {kind: "line", route, color}
  - Point per metro station (two platforms merged), properties {kind: "station", name, corridor_id|null}

    python scripts/build_geo.py
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apps.api.eventflow.config import corridor  # noqa: E402

RAW = ROOT / "data/raw/gtfs_official_2021"
OUT = ROOT / "apps/web/public/geo/metro.geojson"
LINE_COLORS = {"MRed": "#C2410C", "MGrn": "#15803D", "MBrch": "#B91C1C"}   # muted, map-only
PLATFORM = re.compile(r"^(.*?)\s*Metro Station\s*\d$", re.IGNORECASE)


def main() -> Path:
    zpath = sorted(RAW.glob("*.zip"))[-1]
    z = zipfile.ZipFile(zpath)
    read = lambda n, **k: pd.read_csv(z.open(n), dtype=str, **k)  # noqa: E731
    routes, trips, stops = read("routes.txt"), read("trips.txt"), read("stops.txt")
    shapes = read("shapes.txt")
    metro = routes[routes.route_type == "1"]

    features = []
    for _, r in metro.iterrows():
        t = trips[(trips.route_id == r.route_id) & (trips.direction_id == "0")]
        sh = shapes[shapes.shape_id.isin(t.shape_id.unique())].copy()
        sh["seq"] = sh.shape_pt_sequence.astype(int)
        longest = sh.groupby("shape_id").size().idxmax()
        pts = sh[sh.shape_id == longest].sort_values("seq")
        coords = [[round(float(lon), 5), round(float(lat), 5)] for lat, lon in zip(pts.shape_pt_lat, pts.shape_pt_lon)]
        features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                         "properties": {"kind": "line", "route": r.route_short_name,
                                        "color": LINE_COLORS.get(r.route_short_name, "#64748B")}})

    corridor_by_stop = {str(i): s["id"] for s in corridor()["stations"] for i in s.get("gtfs_stop_ids", [])}
    plat = stops[stops.stop_name.str.match(PLATFORM, na=False)].copy()
    plat["name"] = plat.stop_name.str.extract(PLATFORM)[0].str.strip()
    for name, g in plat.groupby("name"):
        cid = next((corridor_by_stop[s] for s in g.stop_id if s in corridor_by_stop), None)
        features.append({"type": "Feature",
                         "geometry": {"type": "Point", "coordinates": [round(g.stop_lon.astype(float).mean(), 5),
                                                                       round(g.stop_lat.astype(float).mean(), 5)]},
                         "properties": {"kind": "station", "name": name[:1].upper() + name[1:], "corridor_id": cid}})

    fc = {"type": "FeatureCollection", "features": features,
          "properties": {"source": "RTA GTFS (official, service Sep–Dec 2021) via Mobility Database mdb-904",
                         "file": zpath.name, "licence": "RTA open data — credit RTA"}}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_st = sum(f["properties"]["kind"] == "station" for f in features)
    print(f"wrote {OUT} ({len(metro)} lines, {n_st} stations, {OUT.stat().st_size // 1024} KB)")
    return OUT


if __name__ == "__main__":
    main()
