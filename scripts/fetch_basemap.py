"""Cut an offline Dubai basemap out of the Protomaps OpenStreetMap build (vector tiles, PMTiles format).

Only the tiles inside the Dubai box are fetched, with HTTP range requests; the planet file itself is never
downloaded. Output: apps/web/public/map/dubai.pmtiles (git-ignored; regenerate with this script).
Licence: © OpenStreetMap contributors (ODbL) — attribution is shown on the map.

    python scripts/fetch_basemap.py --estimate          # read the index only, print tile count and size
    python scripts/fetch_basemap.py --download          # fetch the tiles and write the local archive
    python scripts/fetch_basemap.py --assets            # map fonts (Latin + Arabic glyph ranges) and icon sprites
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pmtiles.tile import deserialize_directory, deserialize_header, find_tile, zxy_to_tileid
from pmtiles.writer import Writer

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/web/public/map/dubai.pmtiles"
DEFAULT_BUILD = "https://build.protomaps.com/20261111.pmtiles"
# Dubai emirate incl. Jebel Ali, Expo City and the Sharjah border (lon_min, lat_min, lon_max, lat_max)
BBOX = (54.95, 24.75, 55.65, 25.38)
MAX_ZOOM = 15
UA = {"User-Agent": "eventflow-twin-basemap/1.0"}


class Remote:
    def __init__(self, url: str):
        self.url, self.bytes_read, self.requests = url, 0, 0

    def get(self, offset: int, length: int) -> bytes:
        for attempt in range(4):
            try:
                req = urllib.request.Request(self.url, headers={**UA, "Range": f"bytes={offset}-{offset + length - 1}"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                if len(data) != length:
                    raise IOError(f"short read {len(data)}/{length}")
                self.bytes_read += length
                self.requests += 1
                return data
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(1.5 * (attempt + 1))
        raise AssertionError


def tile_range(z: int) -> tuple[range, range]:
    n = 2 ** z
    lon2x = lambda lon: int((lon + 180) / 360 * n)                                   # noqa: E731
    lat2y = lambda lat: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)  # noqa: E731
    x0, x1 = lon2x(BBOX[0]), lon2x(BBOX[2])
    y0, y1 = lat2y(BBOX[3]), lat2y(BBOX[1])
    return range(x0, x1 + 1), range(y0, y1 + 1)


def collect(src: Remote, header: dict) -> list[tuple[int, int, int]]:
    """(tile_id, data_offset, length) for every tile in the box, resolving leaf directories (cached)."""
    root = deserialize_directory(src.get(header["root_offset"], header["root_length"]))
    leaves: dict[tuple[int, int], list] = {}
    out = []
    for z in range(0, MAX_ZOOM + 1):
        xs, ys = tile_range(z)
        for x in xs:
            for y in ys:
                tid = zxy_to_tileid(z, x, y)
                entries = root
                for _ in range(4):
                    e = find_tile(entries, tid)
                    if e is None:
                        break
                    if e.run_length == 0:
                        key = (e.offset, e.length)
                        if key not in leaves:
                            leaves[key] = deserialize_directory(src.get(header["leaf_directory_offset"] + e.offset, e.length))
                        entries = leaves[key]
                        continue
                    out.append((tid, e.offset, e.length))
                    break
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default=DEFAULT_BUILD)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--estimate", action="store_true")
    g.add_argument("--download", action="store_true")
    g.add_argument("--assets", action="store_true")
    a = ap.parse_args()
    if a.assets:
        fetch_assets()
        return

    src = Remote(a.build)
    header = deserialize_header(src.get(0, 127))
    tiles = collect(src, header)
    unique = {off: ln for _, off, ln in tiles}
    size = sum(unique.values())
    print(f"{len(tiles):,} tiles z0–{MAX_ZOOM} in {BBOX} · {len(unique):,} unique · {size / 1e6:.1f} MB of tile data "
          f"(index reads so far: {src.requests} requests, {src.bytes_read / 1e6:.1f} MB)")
    if a.estimate:
        return

    # Merge nearby byte ranges into requests of at most 8 MB, fetch in parallel.
    spans: list[list[int]] = []
    for off in sorted(unique):
        end = off + unique[off]
        if spans and off - spans[-1][1] < 65536 and end - spans[-1][0] < 8_000_000:
            spans[-1][1] = max(spans[-1][1], end)
        else:
            spans.append([off, end])
    base = header["tile_data_offset"]
    blobs: dict[int, bytes] = {}

    def fetch(span):
        s, e = span
        return s, src.get(base + s, e - s)

    with ThreadPoolExecutor(8) as ex:
        for done, (s, data) in enumerate(ex.map(fetch, spans), 1):
            blobs[s] = data
            if done % 20 == 0 or done == len(spans):
                print(f"  {done}/{len(spans)} ranges · {src.bytes_read / 1e6:.1f} MB", flush=True)

    starts = sorted(blobs)

    def tile_bytes(off: int, ln: int) -> bytes:
        import bisect
        s = starts[bisect.bisect_right(starts, off) - 1]
        return blobs[s][off - s: off - s + ln]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        w = Writer(f)
        for tid, off, ln in sorted(tiles):
            w.write_tile(tid, tile_bytes(off, ln))
        meta = json.loads(json.dumps(_metadata(src, header)))
        meta["eventflow_extract"] = {"source": a.build, "bbox": BBOX, "max_zoom": MAX_ZOOM,
                                     "attribution": "© OpenStreetMap contributors"}
        h = dict(header)
        h.update(min_lon_e7=int(BBOX[0] * 1e7), min_lat_e7=int(BBOX[1] * 1e7), max_lon_e7=int(BBOX[2] * 1e7),
                 max_lat_e7=int(BBOX[3] * 1e7), center_zoom=11, center_lon_e7=int(55.27 * 1e7), center_lat_e7=int(25.2 * 1e7))
        w.finalize(h, meta)
    tmp.replace(OUT)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB) in {src.requests} requests")


ASSETS = "https://protomaps.github.io/basemaps-assets"
FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"]
# Latin, Latin Extended, Arabic, Arabic Supplement, General Punctuation, Arabic Presentation Forms A and B
RANGES = ["0-255", "256-511", "1536-1791", "1792-2047", "8192-8447", "64256-64511", "65024-65279"]
SPRITES = ["light.json", "light.png", "light@2x.json", "light@2x.png"]


def fetch_assets() -> None:
    """Glyph PBFs + sprites so map labels and icons render offline (Apache-2.0 / OFL assets from Protomaps)."""
    base = OUT.parent
    n, size = 0, 0
    jobs = [(f"{ASSETS}/fonts/{f.replace(' ', '%20')}/{r}.pbf", base / "fonts" / f / f"{r}.pbf") for f in FONTS for r in RANGES]
    jobs += [(f"{ASSETS}/sprites/v4/{s}", base / "sprites" / s) for s in SPRITES]
    for url, dest in jobs:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            data = r.read()
        if len(data) < 64 and dest.suffix == ".pbf":
            continue                      # empty range for this font (e.g. Arabic in the italic face)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        n, size = n + 1, size + len(data)
    print(f"wrote {n} asset files ({size / 1e6:.2f} MB) under {base}")


def _metadata(src: Remote, header: dict) -> dict:
    import gzip
    raw = src.get(header["metadata_offset"], header["metadata_length"])
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass
    return json.loads(raw)


if __name__ == "__main__":
    sys.exit(main())
