"""Realism bake (docs/13_REALISM_FABLE_TASKS.md, R1): real open data → chunked offline scene, apps/web/public/geo/v2/.

Run through `python scripts/build_scene.py --only v2` after `python scripts/fetch_realism_data.py`.

    manifest.json           chunk list, counts per height source and class, provenance rows (shown in the app credits)
    b_<i>_<j>.json          buildings of one 5 km chunk: [height, min_height, x0, z0, …] + roof colour, class, height source
    g_<i>_<j>.jpg           ground: Sentinel-2 L2A median, colour-graded          (≈ 10 m / px)
    ao_<i>_<j>.jpg          ambient occlusion baked from the footprints           (≈ 5 m / px)
    m_<i>_<j>.png           masks: R = vegetation, G = water, B = built-up; black = bare / sand
    overview.jpg, overview_mask.png, dem.png      40 km × 40 km low-resolution surround; ao_corridor.jpg 2 m / px

Everything is in the local frame of scripts/scene_frame.py. The corridor (EXTENT) keeps full footprint detail, the
ring around it is simplified. Heights that no dataset gives are estimated and counted as `estimated`.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import zlib
from pathlib import Path

import yaml

from scene_frame import CHUNK, EXTENT, RING, WIDE, frame, project

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/realism"
OUT = ROOT / "apps/web/public/geo/v2"
F = frame()
LEVEL_M = 3.3
CLASSES = ["tower", "midrise", "villa", "lowrise", "industrial", "mosque", "stadium"]
SOURCES = ["osm_height", "osm_levels", "overture_height", "overture_floors", "globfp_calibrated", "landmark_list", "estimated"]
GROUND_PX = 512          # per 5 km chunk ≈ Sentinel-2's 10 m
AO_PX = 1024


# ---------------------------------------------------------------- pure rules (tested in tests/test_realism_bake.py)
def pick_height(source: str | None, height: float | None, floors: float | None, globfp: float | None,
                landmark: float | None, estimate: float) -> tuple[float, str]:
    """Height priority of R1: OSM height → OSM levels → Overture height / floors → 3D-GloBFP (calibrated) → named-tower list → estimate.
    Overture carries the OSM `height` and `building:levels` tags for footprints whose source is OpenStreetMap."""
    osm = source == "OpenStreetMap"
    if height and height > 2:
        return float(height), "osm_height" if osm else "overture_height"
    if floors and floors >= 1:
        return float(floors) * LEVEL_M, "osm_levels" if osm else "overture_floors"
    if globfp and globfp > 2:
        return float(globfp), "globfp_calibrated"
    if landmark:
        return float(landmark), "landmark_list"
    return estimate, "estimated"


def classify(subtype: str | None, cls: str | None, h: float, area: float) -> str:
    """Type class for the façade system (R3), from Overture subtype/class (OSM tags) and size."""
    if cls == "mosque" or subtype == "religious":
        return "mosque"
    if cls in ("stadium", "grandstand", "sports_centre", "sports_hall"):
        return "stadium"
    if subtype == "industrial" or cls in ("warehouse", "industrial", "hangar", "factory", "manufacture"):
        return "industrial"
    if h >= 60:
        return "tower"
    if cls in ("house", "detached", "semidetached_house", "bungalow", "villa", "terrace") or (h <= 12 and area < 600 and subtype in (None, "residential")):
        return "villa"
    if subtype == "residential" or cls in ("apartments", "residential", "dormitory", "hotel") or (h > 12 and area < 4000):
        return "midrise"
    return "lowrise"


def chunk_of(x: float, z: float) -> tuple[int, int] | None:
    if not (RING[0] <= x < RING[1] and RING[2] <= z < RING[3]):
        return None
    return int((x - RING[0]) // CHUNK), int((z - RING[2]) // CHUNK)


def chunk_extent(i: int, j: int) -> list[float]:
    return [RING[0] + i * CHUNK, RING[0] + (i + 1) * CHUNK, RING[2] + j * CHUNK, RING[2] + (j + 1) * CHUNK]


# ---------------------------------------------------------------- rasters → local frame
def local_grid(extent, w: int, h: int):
    """lat, lon of every pixel centre of a w×h image covering extent (row 0 = z0, like ground.png)."""
    import numpy as np
    x0, x1, z0, z1 = extent
    x = x0 + (np.arange(w) + 0.5) * (x1 - x0) / w
    z = z0 + (np.arange(h) + 0.5) * (z1 - z0) / h
    xx, zz = np.meshgrid(x, z)
    e, n = xx * F["ux"] + zz * F["uy"], xx * F["uy"] - zz * F["ux"]
    return F["lat0"] + n / F["m_lat"], F["lon0"] + e / F["m_lon"]


def sample(path: Path, lat, lon, bilinear: bool = True, cache: dict | None = None):
    """One raster band resampled onto the local grid as float32 (NaN outside the raster or where it is no-data)."""
    import numpy as np
    import rasterio
    from rasterio.warp import transform

    with rasterio.open(path) as src:
        band, crs, inv, nodata = src.read(1).astype("float32"), src.crs, ~src.transform, src.nodata
    key = crs.to_string()
    if cache is None or key not in cache:
        xs, ys = transform("EPSG:4326", crs, lon.ravel(), lat.ravel())
        pts = (np.asarray(xs).reshape(lat.shape), np.asarray(ys).reshape(lat.shape))
        if cache is not None:
            cache[key] = pts
    else:
        pts = cache[key]
    col, row = inv * pts
    col, row = col - 0.5, row - 0.5
    hh, ww = band.shape
    if nodata is not None:
        band[band == nodata] = np.nan
    ok = (col >= 0) & (col <= ww - 1) & (row >= 0) & (row <= hh - 1)
    c, r = np.clip(col, 0, ww - 1), np.clip(row, 0, hh - 1)
    if bilinear:
        c0, r0 = np.minimum(c.astype(int), ww - 2), np.minimum(r.astype(int), hh - 2)
        fc, fr = c - c0, r - r0
        out = (band[r0, c0] * (1 - fc) + band[r0, c0 + 1] * fc) * (1 - fr) + (band[r0 + 1, c0] * (1 - fc) + band[r0 + 1, c0 + 1] * fc) * fr
    else:
        out = band[np.rint(r).astype(int), np.rint(c).astype(int)]
    out[~ok] = np.nan
    return out


def s2_median(kind: str, extent, w: int, h: int):
    """Cloud-free true colour: per band, the median over dates of surface reflectance (tiles of one date are merged)."""
    import numpy as np
    lat, lon = local_grid(extent, w, h)
    cache: dict = {}
    files = sorted((RAW / "s2" / kind).glob("*.tif"))
    if not files:
        raise SystemExit("No Sentinel-2 crops. Run: python scripts/fetch_realism_data.py --only s2")
    rgb = np.zeros((h, w, 3), "float32")
    for k, band in enumerate(("B04", "B03", "B02")):
        by_date: dict[str, np.ndarray] = {}
        for f in files:
            if not f.stem.endswith(band):
                continue
            a = sample(f, lat, lon, cache=cache)
            a[a == 0] = np.nan                                   # 0 = no data in L2A
            date = f.stem.split("_")[2][:8]
            by_date[date] = np.where(np.isnan(by_date[date]), a, by_date[date]) if date in by_date else a
        stack = np.stack(list(by_date.values()))
        rgb[..., k] = (np.nanmedian(stack, axis=0) - 1000.0) / 10000.0      # processing baseline ≥ 04.00: offset −1000
    return np.nan_to_num(rgb, nan=0.0), len(by_date)


def grade(refl):
    """Reflectance → display colour, graded to a warm desert tone: white point just above bright sand, soft gamma,
    a little more saturation, warm cast."""
    import numpy as np
    v = np.clip(refl / 0.42, 0, 1) ** (1 / 2.3)
    lum = v @ np.array([0.3, 0.59, 0.11], "float32")
    v = lum[..., None] + (v - lum[..., None]) * 1.22
    v = v * np.array([1.05, 1.0, 0.9], "float32")
    return (np.clip(v, 0, 1) * 255 + 0.5).astype("uint8")


def worldcover_mask(extent, w: int, h: int, water_rings):
    """RGB mask: R vegetation (tree cover and mangroves 255, shrub / grass / crops / wetland 128), G water
    (WorldCover water or inside an Overture water polygon), B built-up. Bare / sand stays black."""
    import numpy as np
    from PIL import Image, ImageDraw
    lat, lon = local_grid(extent, w, h)
    wc = np.full((h, w), np.nan, "float32")
    for f in sorted((RAW / "worldcover").glob("*.tif")):
        a = sample(f, lat, lon, bilinear=False)
        wc = np.where(np.isnan(wc), a, wc)
    veg = np.where(np.isin(wc, (10, 95)), 255, np.where(np.isin(wc, (20, 30, 40, 90)), 128, 0)).astype("uint8")
    wimg = Image.fromarray(((wc == 80) * 255).astype("uint8"))
    d = ImageDraw.Draw(wimg)
    x0, x1, z0, z1 = extent
    for ring in water_rings:
        d.polygon([((x - x0) * w / (x1 - x0), (z - z0) * h / (z1 - z0)) for x, z in ring], fill=255)
    return Image.merge("RGB", [Image.fromarray(veg), wimg, Image.fromarray(((wc == 50) * 255).astype("uint8"))])


def dem_image(extent, w: int, h: int):
    import numpy as np
    from PIL import Image
    lat, lon = local_grid(extent, w, h)
    dem = np.full((h, w), np.nan, "float32")
    for f in sorted((RAW / "dem").glob("*.tif")):
        a = sample(f, lat, lon)
        dem = np.where(np.isnan(dem), a, dem)
    dem = np.nan_to_num(dem, nan=0.0)                             # sea cells have no tile
    lo, hi = float(dem.min()), float(dem.max())
    return Image.fromarray(((dem - lo) / max(1e-6, hi - lo) * 255 + 0.5).astype("uint8")), lo, hi


def ao_image(buildings: list[list], extent, w: int, h: int, blur_m: float = 14.0):
    """Ground ambient occlusion: footprints weighted by height, blurred; bright = open ground."""
    from PIL import Image, ImageDraw, ImageFilter
    x0, x1, z0, z1 = extent
    sx, sz = w / (x1 - x0), h / (z1 - z0)
    occ = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(occ)
    m = 60.0                                                       # buildings just outside still shade the edge
    for b in sorted(buildings, key=lambda b: b[0]):                # tallest drawn last
        if not (x0 - m < b[2] < x1 + m and z0 - m < b[3] < z1 + m):
            continue
        d.polygon([((b[i] - x0) * sx, (b[i + 1] - z0) * sz) for i in range(2, len(b), 2)], fill=min(255, int(95 + b[0] * 2.2)))
    occ = occ.filter(ImageFilter.GaussianBlur(blur_m * sx))
    return occ.point(lambda v: 255 - int(v * 0.6))


# ---------------------------------------------------------------- buildings
def _rings(geojson: str) -> list[list[tuple[float, float]]]:
    g = json.loads(geojson)
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
    return [[project(lat, lon, F) for lon, lat in p[0]] for p in polys if p and len(p[0]) >= 4]


def load_water() -> list[list[tuple[float, float]]]:
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    f = (RAW / "overture/water.parquet").as_posix()
    rows = con.execute(f"SELECT ST_AsGeoJSON(geometry) FROM read_parquet('{f}') "
                       "WHERE ST_GeometryType(geometry) IN ('POLYGON', 'MULTIPOLYGON')").fetchall()
    return [r for (gj,) in rows for r in _rings(gj)]


def calibration(pairs: list[tuple[float, float]], bins: int = 12) -> list[tuple[float, float]]:
    """Monotone map 3D-GloBFP height → tagged height, from buildings that have both: the median tagged height per
    quantile bin of the 3D-GloBFP value. Returns [(globfp_m, tagged_m), …] for linear interpolation."""
    pairs = sorted(pairs)
    n, out, top = len(pairs), [], 0.0
    for k in range(bins):
        part = pairs[k * n // bins: (k + 1) * n // bins]
        if not part:
            continue
        g, t = sorted(p[0] for p in part), sorted(p[1] for p in part)
        top = max(top, t[len(t) // 2])                              # never decreasing
        out.append((round(g[len(g) // 2], 1), round(top, 1)))
    return out


def calibrated(g: float, table: list[tuple[float, float]]) -> float:
    if g <= table[0][0]:
        return table[0][1]
    for (g0, t0), (g1, t1) in zip(table, table[1:]):
        if g <= g1:
            return t0 + (t1 - t0) * (g - g0) / max(1e-9, g1 - g0)
    return table[-1][1] * g / table[-1][0]                          # above the last bin: keep the ratio


def globfp_heights(con) -> tuple[dict[str, float], list[tuple[float, float]], int]:
    """Overture building id → calibrated 3D-GloBFP height (building centre inside a 3D-GloBFP footprint), and the
    calibration table. Raw 3D-GloBFP is not usable here: in Dubai it puts two-storey houses anywhere between 1 m and
    29 m and towers at 40–70 m, so it is mapped onto the heights OpenStreetMap tags for the same buildings."""
    shps = [s for s in sorted((RAW / "globfp").rglob("*.shp")) if s.stem != "world_grid"]
    b = (RAW / "overture/buildings.parquet").as_posix()
    raw: dict[str, float] = {}
    pairs: list[tuple[float, float]] = []
    for shp in shps:
        cols = [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM ST_Read('{shp.as_posix()}')").fetchall()]
        hcol = next((c for c in cols if c.lower() in ("height", "hgt", "h")), None)
        if not hcol:
            continue
        rows = con.execute(f"""
            WITH g AS (SELECT {hcol} AS h, ST_SetCRS(geom, 'OGC:CRS84') AS geom FROM ST_Read('{shp.as_posix()}')),
                 o AS (SELECT id, coalesce(height, num_floors * {LEVEL_M}) AS tagged, ST_Centroid(geometry) AS c FROM read_parquet('{b}'))
            SELECT o.id, any_value(o.tagged), max(g.h) FROM o JOIN g ON ST_Contains(g.geom, o.c) GROUP BY o.id""").fetchall()
        for i, tagged, h in rows:
            if h and tagged:
                pairs.append((float(h), float(tagged)))
            elif h:
                raw[i] = float(h)
    table = calibration(pairs) if len(pairs) >= 200 else []
    return ({i: calibrated(h, table) for i, h in raw.items()} if table else {}), table, len(pairs)


def build_buildings(v1: dict, roof_rgb, landmark_heights: dict[str, float]):
    """→ per-chunk records, ghosts, counts. roof_rgb: graded ring image (numpy h×w×3) sampled under each footprint."""
    import duckdb
    from build_scene import CAMERA_SIDE_CUT, LANDMARKS, area, centroid, estimate_height, flat, pip, simplify

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    bq, pq = (RAW / "overture/buildings.parquet").as_posix(), (RAW / "overture/building_parts.parquet").as_posix()
    gfp, gfp_table, gfp_pairs = globfp_heights(con)
    has_parts = {r[0] for r in con.execute(f"SELECT DISTINCT building_id FROM read_parquet('{pq}')").fetchall()}
    rows = con.execute(f"""
        SELECT id, name, height, num_floors, min_height, subtype, class, source, ST_AsGeoJSON(geometry), false FROM read_parquet('{bq}')
        UNION ALL
        SELECT p.id, coalesce(p.name, b.name), p.height, p.num_floors, p.min_height, b.subtype, b.class, p.source, ST_AsGeoJSON(p.geometry), true
        FROM read_parquet('{pq}') p LEFT JOIN read_parquet('{bq}') b ON b.id = p.building_id""").fetchall()

    lms = [(v["x"], v["z"], LANDMARKS[k][1]) for k, v in v1["landmarks"].items() if k in LANDMARKS]
    stations = [(s["x"], s["z"]) for s in v1["stations_osm"]]
    rh, rw = roof_rgb.shape[:2]
    chunks: dict[tuple[int, int], dict] = {}
    by_source = dict.fromkeys(SOURCES, 0)
    by_class = dict.fromkeys(CLASSES, 0)
    ghosts, all_b, landmark_hits = [], [], set()
    for oid, name, height, floors, min_h, subtype, cls, source, gj, is_part in rows:
        if not is_part and oid in has_parts:
            continue                                               # drawn by its parts
        for ring in _rings(gj):
            ring = ring[:-1] if ring[0] == ring[-1] else ring
            if len(ring) < 3:
                continue
            cx, cz = centroid(ring)
            ch = chunk_of(cx, cz)
            if ch is None:
                continue
            corridor = EXTENT[0] <= cx <= EXTENT[1] and EXTENT[2] <= cz <= EXTENT[3]
            a = abs(area(ring))
            if a < (28 if corridor else 60):                       # ring: lower detail
                continue
            # replaced by a modelled landmark or metro station (as in the v1 bake)
            if any(math.hypot(cx - lx, cz - lz) < r or pip(lx, lz, ring) for lx, lz, r in lms):
                continue
            if (cls == "train_station" or subtype == "transportation") and any(math.hypot(cx - sx, cz - sz) < 110 for sx, sz in stations):
                continue
            seed = zlib.crc32(oid.encode())
            lm = landmark_heights.get((name or "").strip().lower())
            h, src = pick_height(source, height, floors, gfp.get(oid), lm,
                                 estimate_height({"building": cls or "yes"}, a, cx, cz, seed) if corridor
                                 else estimate_height({"building": cls or "yes"}, a, 1e9, 1e9, seed))
            if src == "landmark_list":
                landmark_hits.add(name)
            h = min(h, 830.0)
            mh = float(min_h or 0.0)
            if mh >= h:
                continue
            if area(ring) < 0:
                ring = ring[::-1]
            ring = simplify(ring + [ring[0]], (0.6 if a > 200 else 0.9) if corridor else 1.6)[:-1]
            if len(ring) < 3:
                continue
            px, pz = int((cx - RING[0]) / (RING[1] - RING[0]) * rw), int((cz - RING[2]) / (RING[3] - RING[2]) * rh)
            k = 1 if a > 900 else 0          # ponytail: centre pixel (3×3 mean for big roofs) at 10 m; per-pixel polygon mean if R3 needs it
            r, g, b = roof_rgb[max(0, pz - k): pz + k + 1, max(0, px - k): px + k + 1].reshape(-1, 3).mean(axis=0)
            kind = classify(subtype, cls, h, a)
            by_source[src] += 1
            by_class[kind] += 1
            pts = flat(ring, 1) if corridor else [round(v * 2) / 2 for v in flat(ring, 2)]
            # sea-side frontage towers in the corridor: solid to podium height, ghosted above (stations stay visible)
            if corridor and cz > 22 and h > CAMERA_SIDE_CUT + 12 and mh < CAMERA_SIDE_CUT:
                ghosts.append([round(h, 1), CAMERA_SIDE_CUT, *pts])
                h = CAMERA_SIDE_CUT
            rec = [round(h, 1), round(mh, 1), *pts]
            c = chunks.setdefault(ch, {"buildings": [], "roof": [], "cls": [], "src": []})
            c["buildings"].append(rec)
            c["roof"].append((int(r) << 16) | (int(g) << 8) | int(b))
            c["cls"].append(CLASSES.index(kind))
            c["src"].append(SOURCES.index(src))
            all_b.append(rec)
    return chunks, ghosts, all_b, by_source, by_class, sorted(landmark_hits), {"pairs": gfp_pairs, "table": gfp_table}


# ---------------------------------------------------------------- main
def main() -> None:
    import numpy as np
    from PIL import Image

    if not (RAW / "overture/buildings.parquet").exists():
        raise SystemExit("No realism data. Run: python scripts/fetch_realism_data.py")
    v1 = json.loads((ROOT / "apps/web/public/geo/corridor_scene.json").read_text(encoding="utf-8"))
    towers = yaml.safe_load((ROOT / "config/landmark_heights.yaml").read_text(encoding="utf-8"))["towers"]
    landmark_heights = {n.lower(): t["height_m"] for t in towers for n in [t["name"], *t.get("aliases", [])]}
    n = round((RING[1] - RING[0]) / CHUNK)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*"):
        old.unlink()
    refl, n_dates = s2_median("ring", RING, n * GROUND_PX, n * GROUND_PX)
    ground = grade(refl)
    wide, _ = s2_median("wide", WIDE, 1024, 1024)
    Image.fromarray(grade(wide)).save(OUT / "overview.jpg", quality=86)
    water = load_water()
    worldcover_mask(WIDE, 1024, 1024, water).save(OUT / "overview_mask.png", optimize=True)
    mask = worldcover_mask(RING, n * GROUND_PX, n * GROUND_PX, water)
    dem, dem_lo, dem_hi = dem_image(WIDE, 512, 512)
    dem.save(OUT / "dem.png", optimize=True)

    chunks, ghosts, all_b, by_source, by_class, landmark_hits, gfp_cal = build_buildings(v1, ground, landmark_heights)
    ao_image(all_b, EXTENT, round((EXTENT[1] - EXTENT[0]) / 2), round((EXTENT[3] - EXTENT[2]) / 2), 9.0).save(OUT / "ao_corridor.jpg", quality=85)
    listing = []
    for j in range(n):
        for i in range(n):
            ext = chunk_extent(i, j)
            c = chunks.get((i, j), {"buildings": [], "roof": [], "cls": [], "src": []})
            box = (i * GROUND_PX, j * GROUND_PX, (i + 1) * GROUND_PX, (j + 1) * GROUND_PX)
            Image.fromarray(ground).crop(box).save(OUT / f"g_{i}_{j}.jpg", quality=88)
            mask.crop(box).save(OUT / f"m_{i}_{j}.png", optimize=True)
            ao_image(all_b, ext, AO_PX, AO_PX).save(OUT / f"ao_{i}_{j}.jpg", quality=85)
            (OUT / f"b_{i}_{j}.json").write_text(json.dumps(c, separators=(",", ":")), encoding="utf-8")
            listing.append({"id": f"{i}_{j}", "extent": ext, "n": len(c["buildings"]), "buildings": f"b_{i}_{j}.json",
                            "ground": f"g_{i}_{j}.jpg", "ao": f"ao_{i}_{j}.jpg", "mask": f"m_{i}_{j}.png"})

    total = sum(by_source.values())
    release = (RAW / "overture/RELEASE.txt").read_text(encoding="utf-8").strip()
    s2 = json.loads((RAW / "s2/ITEMS.json").read_text(encoding="utf-8"))
    today = dt.date.today().isoformat()
    manifest = {
        "version": 2, "generated": today, "frame": {k: round(v, 9) for k, v in F.items()},
        "extent": list(EXTENT), "ring": list(RING), "wide": list(WIDE), "chunk_m": CHUNK,
        "classes": CLASSES, "height_sources": SOURCES, "camera_side_cut_m": v1["meta"]["camera_side_cut_m"],
        "mask_channels": {"r": "vegetation (255 trees / mangroves, 128 shrub, grass, crops, wetland)", "g": "water", "b": "built-up", "black": "bare / sand"},
        "overview": {"file": "overview.jpg", "mask": "overview_mask.png", "extent": list(WIDE)},
        "dem": {"file": "dem.png", "extent": list(WIDE), "min_m": round(dem_lo, 1), "max_m": round(dem_hi, 1)},
        "ao_corridor": {"file": "ao_corridor.jpg", "extent": list(EXTENT)},
        "ghosts": ghosts, "chunks": listing,
        "counts": {"buildings": total, "ghosted_tops": len(ghosts), "by_height_source": by_source, "by_class": by_class,
                   "estimated": by_source["estimated"], "landmark_list_matched": landmark_hits,
                   "globfp_calibration": gfp_cal},
        "provenance": [
            {"dataset": "Building footprints, classes, tagged heights", "source": f"Overture Maps Foundation, buildings theme, release {release} (includes OpenStreetMap)",
             "licence": "ODbL 1.0 (© OpenStreetMap contributors, Overture Maps Foundation)", "date": release[:10], "count": f"{total} buildings in the 20 km ring"},
            {"dataset": "Building heights where untagged (calibrated)", "source": f"3D-GloBFP (Che et al. 2024, ESSD 16, 5357–5374), Zenodo 15487006; mapped onto OpenStreetMap-tagged heights of {gfp_cal['pairs']} buildings that have both",
             "licence": "CC BY 4.0", "date": "2024", "count": f"{by_source['globfp_calibrated']} buildings"},
            {"dataset": "Named tower heights", "source": "config/landmark_heights.yaml (source URL per tower)",
             "licence": "Facts; Wikipedia text CC BY-SA 4.0", "date": today, "count": f"{by_source['landmark_list']} buildings"},
            {"dataset": "Building heights, ESTIMATED", "source": "Seeded estimate from footprint area and type (scripts/build_scene.py)",
             "licence": "n/a (not data)", "date": today, "count": f"{by_source['estimated']} buildings ({100 * by_source['estimated'] / max(1, total):.1f} %)"},
            {"dataset": "Ground image", "source": f"Copernicus Sentinel-2 L2A, median of {n_dates} near-cloudless dates {s2['dates'][0]} – {s2['dates'][-1]}, via Microsoft Planetary Computer; colour-graded",
             "licence": "Contains modified Copernicus Sentinel data 2025 (free and open)", "date": s2["window"], "count": f"{len(s2['items'])} scenes, 10 m"},
            {"dataset": "Land-cover masks (vegetation, water, built-up, bare)", "source": "ESA WorldCover 10 m 2021 v200",
             "licence": "CC BY 4.0 (© ESA WorldCover project 2021)", "date": "2021", "count": f"{n * n} chunk masks + 1 overview"},
            {"dataset": "Water outline", "source": f"Overture Maps Foundation, base theme (water), release {release}",
             "licence": "ODbL 1.0", "date": release[:10], "count": f"{len(water)} polygons"},
            {"dataset": "Terrain height", "source": "Copernicus DEM GLO-30 (AWS Open Data), resampled to 78 m",
             "licence": "© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; free licence",
             "date": "2011–2015", "count": f"1 texture, {dem_lo:.0f}–{dem_hi:.0f} m"},
            {"dataset": "Ground ambient occlusion", "source": "Baked from the footprints and heights above (scripts/realism_bake.py)",
             "licence": "derived", "date": today, "count": f"{n * n} chunk textures + corridor"},
        ],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.glob("*"))
    print(f"v2: {total} buildings in {len(chunks)} chunks (+{len(ghosts)} ghosted tops)")
    print("heights:", by_source)
    print("classes:", by_class)
    print(f"landmark list matched: {landmark_hits}")
    print(f"{OUT.relative_to(ROOT)}: {size / 1e6:.1f} MB, largest {max(f.stat().st_size for f in OUT.glob('*')) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
