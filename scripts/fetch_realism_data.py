"""Download the open data for the realism bake (docs/13_REALISM_FABLE_TASKS.md, R1) into data/raw/realism/.

Needs internet, once; nothing here is committed (data/raw is git-ignored). No accounts or keys.

    pip install -r requirements-realism.txt
    python scripts/fetch_realism_data.py                 # everything (about 1 GB)
    python scripts/fetch_realism_data.py --only s2 dem   # some steps: overture s2 worldcover dem globfp

    overture/    buildings, building parts (ring) and water (wide box)   Overture Maps, release OVERTURE
    s2/          Sentinel-2 L2A red/green/blue crops, 13 Oct – 30 Nov 2025  Microsoft Planetary Computer STAC
    worldcover/  ESA WorldCover 2021 v200 land-cover crop
    dem/         Copernicus DEM GLO-30 crops
    globfp/      3D-GloBFP building heights for the grid cells that cover the ring (Zenodo → figshare)

Then: python scripts/build_scene.py --only v2
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from scene_frame import RING, WIDE, corridor_bbox  # noqa: E402

RAW = ROOT / "data/raw/realism"
OVERTURE = "2026-10-21.0"
S2_DATES = "2025-10-13/2025-11-30"          # GITEX period
S2_MAX_DATES = 8                            # the median of 8 near-cloudless dates is stable; more only costs download
STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/{account}/{container}"   # one read token for all crops
UA = {"User-Agent": "eventflow-twin-bake"}


def get_json(url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers={**UA, "content-type": "application/json"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as ex:           # Planetary Computer rate-limits anonymous clients
            if ex.code != 429 or attempt == 5:
                raise
            time.sleep(20 * (attempt + 1))


def download(url: str, dst: Path) -> Path:
    if not dst.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".part")
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, tmp.open("wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        tmp.replace(dst)
    return dst


def crop(url: str, dst: Path, box: tuple[float, float, float, float], decimate: int = 1) -> bool:
    """Save the part of a remote cloud-optimised GeoTIFF inside box = (south, west, north, east); False if no overlap."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import Window, from_bounds

    if dst.exists():
        return True
    s, w, n, e = box
    with rasterio.open(url) as src:
        l, b, r, t = transform_bounds("EPSG:4326", src.crs, w, s, e, n)
        win = from_bounds(l, b, r, t, src.transform).round_offsets().round_lengths()
        win = win.intersection(Window(0, 0, src.width, src.height)) if _overlaps(win, src) else None
        if win is None or win.width < 2 or win.height < 2:
            return False
        shape = (src.count, max(1, round(win.height / decimate)), max(1, round(win.width / decimate)))
        data = src.read(window=win, out_shape=shape, resampling=Resampling.average if decimate > 1 else Resampling.nearest)
        tr = src.window_transform(win) * rasterio.Affine.scale(win.width / shape[2], win.height / shape[1])
        prof = {"driver": "GTiff", "count": src.count, "dtype": data.dtype, "crs": src.crs, "transform": tr,
                "width": shape[2], "height": shape[1], "compress": "deflate", "nodata": src.nodata}
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".part.tif")
    with rasterio.open(tmp, "w", **prof) as out:
        out.write(data)
    tmp.replace(dst)
    return True


def _overlaps(win, src) -> bool:
    return win.col_off < src.width and win.row_off < src.height and win.col_off + win.width > 0 and win.row_off + win.height > 0


# ---------------------------------------------------------------- Overture
def fetch_overture() -> None:
    import duckdb

    out = RAW / "overture"
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    base = f"s3://overturemaps-us-west-2/release/{OVERTURE}"
    where = "bbox.xmin < {e} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s}"
    jobs = {
        "buildings": (RING, "buildings/type=building", "id, names.primary AS name, height, num_floors, min_height, subtype, class, "
                      "has_parts, sources[1].dataset AS source, geometry"),
        "building_parts": (RING, "buildings/type=building_part", "id, building_id, names.primary AS name, height, num_floors, "
                           "min_height, sources[1].dataset AS source, geometry"),
        "water": (WIDE, "base/type=water", "id, subtype, class, names.primary AS name, geometry"),
    }
    for name, (extent, path, cols) in jobs.items():
        dst = out / f"{name}.parquet"
        if dst.exists():
            continue
        s, w, n, e = corridor_bbox(extent)
        con.execute(f"COPY (SELECT {cols} FROM read_parquet('{base}/theme={path}/*', hive_partitioning=1) "
                    f"WHERE {where.format(s=s, w=w, n=n, e=e)}) TO '{dst.as_posix()}' (FORMAT parquet)")
        print(f"overture {name}: {con.execute(f'SELECT count(*) FROM read_parquet(\'{dst.as_posix()}\')').fetchone()[0]} rows")
    (out / "RELEASE.txt").write_text(OVERTURE, encoding="utf-8")


# ---------------------------------------------------------------- Sentinel-2
def fetch_s2() -> None:
    s, w, n, e = corridor_bbox(WIDE)
    items = get_json(STAC, {"collections": ["sentinel-2-l2a"], "bbox": [w, s, e, n], "datetime": S2_DATES,
                            "query": {"eo:cloud_cover": {"lt": 5}}, "limit": 200})["features"]
    by_date: dict[str, list[dict]] = {}
    for it in items:
        by_date.setdefault(it["properties"]["datetime"][:10], []).append(it)
    # clearest dates first; a date counts as its cloudiest tile
    dates = sorted(by_date, key=lambda d: max(i["properties"]["eo:cloud_cover"] for i in by_date[d]))[:S2_MAX_DATES]
    jobs, tokens = [], {}
    for d in dates:
        for it in by_date[d]:
            for band in ("B04", "B03", "B02"):
                u = urllib.parse.urlsplit(it["assets"][band]["href"])
                key = (u.netloc.split(".")[0], u.path.split("/")[1])
                if key not in tokens:
                    tokens[key] = get_json(TOKEN.format(account=key[0], container=key[1]))["token"]
                href = f"{u.geturl()}?{tokens[key]}"
                # full 10 m resolution over the ring, 40 m over the wide box
                jobs.append((href, RAW / f"s2/ring/{it['id']}_{band}.tif", corridor_bbox(RING), 1))
                jobs.append((href, RAW / f"s2/wide/{it['id']}_{band}.tif", (s, w, n, e), 4))
    with ThreadPoolExecutor(6) as ex:
        done = list(ex.map(lambda j: crop(*j), jobs))
    (RAW / "s2/ITEMS.json").write_text(json.dumps(
        {"dates": sorted(dates), "items": sorted(it["id"] for d in dates for it in by_date[d]), "window": S2_DATES}, indent=1), encoding="utf-8")
    print(f"sentinel-2: {len(dates)} dates, {sum(done)} crops of {len(jobs)} requested")


# ---------------------------------------------------------------- WorldCover + DEM
def degree_tiles(box, step: int):
    s, w, n, e = box
    for lat in range(int(s // step) * step, int(n) + 1, step):
        for lon in range(int(w // step) * step, int(e) + 1, step):
            yield lat, lon


def fetch_worldcover() -> None:
    box = corridor_bbox(WIDE)
    for lat, lon in degree_tiles(box, 3):
        name = f"ESA_WorldCover_10m_2021_v200_N{lat:02d}E{lon:03d}_Map"
        ok = crop(f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/{name}.tif", RAW / f"worldcover/{name}.tif", box)
        print("worldcover", name, "ok" if ok else "no overlap")


def fetch_dem() -> None:
    box = corridor_bbox(WIDE)
    for lat, lon in degree_tiles(box, 1):
        name = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
        try:
            ok = crop(f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif", RAW / f"dem/{name}.tif", box)
        except Exception as ex:                     # all-sea cells have no tile
            print("dem", name, "missing:", type(ex).__name__)
            continue
        print("dem", name, "ok" if ok else "no overlap")


# ---------------------------------------------------------------- 3D-GloBFP
def fetch_globfp() -> None:
    import duckdb

    out = RAW / "globfp"
    zen = "https://zenodo.org/api/records/15487006/files/{}/content"
    grid_zip = download(zen.format("world_grid.zip"), out / "world_grid.zip")
    links = download(zen.format("data_links.txt"), out / "data_links.txt").read_text(encoding="utf-8")
    if not (out / "world_grid/world_grid.shp").exists():
        zipfile.ZipFile(grid_zip).extractall(out / "world_grid")
    s, w, n, e = corridor_bbox(RING)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    shp = (out / "world_grid/world_grid.shp").as_posix()
    cols = [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM ST_Read('{shp}')").fetchall()]
    id_col = next(c for c in cols if c.lower() in ("grid_id", "gridid", "id", "fid_1"))
    ids = [int(r[0]) for r in con.execute(
        f"SELECT {id_col} FROM ST_Read('{shp}') WHERE ST_Intersects(geom, ST_MakeEnvelope({w}, {s}, {e}, {n}))").fetchall()]
    print("3D-GloBFP grid cells over the ring:", ids)
    articles = [int(u.rstrip("/").split("/")[-1]) for u in links.split() if u.startswith("https://figshare.com")]
    for art in articles:
        files = get_json(f"https://api.figshare.com/v2/articles/{art}/files?page_size=1000")
        for f in files:
            if f["name"].split("_")[0].isdigit() and int(f["name"].split("_")[0]) in ids:
                z = download(f["download_url"], out / f["name"])
                if z.suffix == ".zip":
                    zipfile.ZipFile(z).extractall(out / z.stem)
                print("3D-GloBFP", f["name"], f"{z.stat().st_size / 1e6:.0f} MB")


STEPS = {"overture": fetch_overture, "s2": fetch_s2, "worldcover": fetch_worldcover, "dem": fetch_dem, "globfp": fetch_globfp}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", nargs="+", choices=list(STEPS), default=list(STEPS))
    for step in ap.parse_args().only:
        STEPS[step]()
