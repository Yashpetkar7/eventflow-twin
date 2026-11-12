"""Fetch OpenStreetMap data for the Sheikh Zayed Road corridor (one-time, needs internet).

Raw Overpass responses are cached in data/raw/osm/ (git-ignored). `scripts/build_scene.py` then bakes them
into the small local file the 3D twin loads (apps/web/public/geo/corridor_scene.json), so the exhibit itself
never touches the network. Licence: © OpenStreetMap contributors (ODbL) — credited in the UI footer.

    python scripts/fetch_osm_corridor.py            # fetch what is missing
    python scripts/fetch_osm_corridor.py --force    # refetch everything
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from scene_frame import corridor_bbox  # noqa: E402

OUT = ROOT / "data/raw/osm"
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]
UA = {"User-Agent": "corridor-scene-build/1.0 (one-time research extract)"}

QUERIES = {
    "buildings": '(way["building"]({b});way["building:part"]({b});relation["building"]({b});relation["building:part"]({b}););out tags geom;',
    "roads": '(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|service)$"]({b}););out tags geom;',
    "rail": '(way["railway"~"^(subway|tram|light_rail)$"]({b});node["railway"="station"]({b});way["railway"="platform"]({b});way["highway"="footway"]["bridge"]({b}););out tags geom;',
    "nature": '(way["natural"="water"]({b});relation["natural"="water"]({b});way["waterway"]({b});way["natural"="coastline"]({b});way["leisure"~"^(park|garden|pitch|golf_course)$"]({b});relation["leisure"~"^(park|garden)$"]({b});way["landuse"~"^(grass|recreation_ground|construction|cemetery)$"]({b});way["natural"~"^(sand|beach|scrub)$"]({b}););out tags geom;',
}


def fetch(query: str, label: str) -> dict:
    body = urllib.parse.urlencode({"data": f"[out:json][timeout:180];{query}"}).encode()
    last = None
    for attempt in range(6):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            t0 = time.time()
            with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=UA), timeout=240) as r:
                data = json.loads(r.read())
            if "elements" not in data:
                raise IOError("no elements in response")
            print(f"  {label}: {len(data['elements'])} elements from {url.split('/')[2]} in {time.time() - t0:.0f}s", flush=True)
            return data
        except Exception as e:  # noqa: BLE001 — any failure → next mirror
            last = e
            print(f"  {label}: {url.split('/')[2]} failed ({e}); retrying", flush=True)
            time.sleep(4 + 4 * attempt)
    raise SystemExit(f"Could not fetch {label}: {last}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    s, w, n, e = corridor_bbox()
    # buildings are heavy: split the box into 3 x 3 tiles
    tiles = []
    for i in range(3):
        for j in range(3):
            tiles.append((s + (n - s) * i / 3, w + (e - w) * j / 3, s + (n - s) * (i + 1) / 3, w + (e - w) * (j + 1) / 3))
    jobs = [(f"buildings_{k}", QUERIES["buildings"], t) for k, t in enumerate(tiles)]
    jobs += [(name, q, (s, w, n, e)) for name, q in QUERIES.items() if name != "buildings"]
    for name, q, box in jobs:
        f = OUT / f"{name}.json"
        if f.exists() and not args.force:
            print(f"  {name}: cached")
            continue
        b = ",".join(f"{v:.5f}" for v in box)
        data = fetch(q.replace("{b}", b), name)
        f.write_text(json.dumps(data), encoding="utf-8")
    print("done →", OUT)


if __name__ == "__main__":
    main()
