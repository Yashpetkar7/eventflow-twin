"""Build the web app's metro line geometry from the official RTA GTFS feed.

Output: apps/web/public/geo/metro.geojson
  - LineString per metro line (longest shape of direction 0), properties {kind: "line", line, color}
Stations come from the API (/stations, generated from the same feed by scripts/build_network.py).

    python scripts/build_geo.py
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/gtfs_official_2021"
OUT = ROOT / "apps/web/public/geo/metro.geojson"
LINES = {"MRed": ("Red", "#D9483B"), "MGrn": ("Green", "#2E9E5B"), "MBrch": ("Branch", "#E07A6E")}


def main() -> Path:
    zpath = sorted(RAW.glob("*.zip"))[-1]
    z = zipfile.ZipFile(zpath)
    read = lambda n, **k: pd.read_csv(z.open(n), dtype=str, **k)  # noqa: E731
    routes, trips, shapes = read("routes.txt"), read("trips.txt"), read("shapes.txt")
    features = []
    for _, r in routes[(routes.route_type == "1") & routes.route_short_name.isin(LINES)].iterrows():
        line, color = LINES[r.route_short_name]
        t = trips[(trips.route_id == r.route_id) & (trips.direction_id == "0")]
        sh = shapes[shapes.shape_id.isin(t.shape_id.unique())].copy()
        sh["seq"] = sh.shape_pt_sequence.astype(int)
        longest = sh.groupby("shape_id").size().idxmax()
        pts = sh[sh.shape_id == longest].sort_values("seq")
        coords = [[round(float(lon), 5), round(float(lat), 5)] for lat, lon in zip(pts.shape_pt_lat, pts.shape_pt_lon)]
        features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                         "properties": {"kind": "line", "line": line, "color": color}})
    fc = {"type": "FeatureCollection", "features": features,
          "properties": {"source": "RTA GTFS (official, service Sep–Dec 2021) via Mobility Database mdb-904",
                         "file": zpath.name, "licence": "RTA open data — credit RTA"}}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({len(features)} lines, {OUT.stat().st_size // 1024} KB)")
    return OUT


if __name__ == "__main__":
    main()
