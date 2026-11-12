"""Bake the OpenStreetMap extract (scripts/fetch_osm_corridor.py) into the files the 3D twin loads offline.

    apps/web/public/geo/corridor_scene.json   buildings, major roads, Sheikh Zayed Road carriageways, flyovers,
                                              footbridges, water, Red Line centreline, landmark anchors
    apps/web/public/geo/ground.png            ground map (sand, paving, parks, water, minor streets) ≈ 2 m / px

Everything is in the local frame of scripts/scene_frame.py (real metres, corridor along +x, sea side +z).

What is real and what is estimated (also written into the JSON `meta`, shown in the UI footer):
  * footprints, roads, water, parks: OpenStreetMap (© OpenStreetMap contributors, ODbL)
  * building heights: OSM `height` / `building:levels` where tagged; otherwise ESTIMATED from footprint area
    and district (deterministic, seeded by the OSM id)
  * Red Line: official RTA GTFS shape (apps/web/public/geo/metro.geojson)

    python scripts/build_scene.py
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from scene_frame import EXTENT, frame, project  # noqa: E402

RAW = ROOT / "data/raw/osm"
OUT = ROOT / "apps/web/public/geo"
F = frame()
X0, X1, Z0, Z1 = EXTENT
CAMERA_SIDE_CUT = 42.0   # sea-side frontage towers are drawn solid up to this height, ghosted above (stations stay visible)


def load(name: str) -> list[dict]:
    out = {}
    for fn in sorted(glob.glob(str(RAW / f"{name}*.json"))):
        for e in json.loads(Path(fn).read_text(encoding="utf-8"))["elements"]:
            out[(e["type"], e["id"])] = e
    if not out:
        raise SystemExit(f"No OSM data for '{name}'. Run: python scripts/fetch_osm_corridor.py")
    return list(out.values())


def pts(geom: list[dict]) -> list[tuple[float, float]]:
    return [project(p["lat"], p["lon"], F) for p in geom if p]


def inside(x: float, z: float, m: float = 0.0) -> bool:
    return X0 - m <= x <= X1 + m and Z0 - m <= z <= Z1 + m


def area(ring: list[tuple[float, float]]) -> float:
    return 0.5 * sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))


def centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def pip(x: float, z: float, ring: list[tuple[float, float]]) -> bool:
    c, j = False, len(ring) - 1
    for i in range(len(ring)):
        (xi, zi), (xj, zj) = ring[i], ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def simplify(line: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas–Peucker."""
    if len(line) < 3:
        return line
    (ax, az), (bx, bz) = line[0], line[-1]
    dx, dz = bx - ax, bz - az
    ln = math.hypot(dx, dz) or 1e-9
    closed = math.hypot(dx, dz) < 1e-6          # ring: measure from the start point instead of a zero-length chord
    best, idx = 0.0, 0
    for i in range(1, len(line) - 1):
        d = math.hypot(line[i][0] - ax, line[i][1] - az) if closed else abs((line[i][0] - ax) * dz - (line[i][1] - az) * dx) / ln
        if d > best:
            best, idx = d, i
    if best <= tol:
        return [line[0], line[-1]]
    return simplify(line[: idx + 1], tol)[:-1] + simplify(line[idx:], tol)


def num(v, default=None):
    try:
        return float(str(v).replace("m", "").replace(",", ".").split(";")[0].strip())
    except (TypeError, ValueError):
        return default


def flat(line, nd=1) -> list[float]:
    out = []
    for x, z in line:
        out += [round(x, nd), round(z, nd)]
    return out


def name_of(t: dict) -> str:
    return t.get("name:en") or t.get("name") or ""


# ---------------------------------------------------------------- buildings
def tower_zone(x: float, z: float) -> bool:
    return ((abs(z) < 330 and -2300 < x < 3950) or (-300 < x < 750 and -820 < z < -150)
            or (700 < x < 2250 and -1750 < z < -250) or (1900 < x < 4100 and -2000 < z < -250))


def estimate_height(t: dict, a: float, x: float, z: float, seed: int) -> float:
    r = random.Random(seed)
    kind = t.get("building", "yes")
    if kind in ("house", "detached", "residential", "garage", "garages", "shed", "hut", "roof", "carport", "kiosk", "service"):
        return 4.0 + r.random() * 5 if kind not in ("roof", "carport", "shed", "kiosk") else 3.5
    if kind in ("mosque", "school", "retail", "supermarket", "warehouse", "industrial", "parking", "train_station"):
        return 9.0 + r.random() * 8
    if tower_zone(x, z):
        if 450 <= a <= 5000:
            return 70.0 + r.random() * 150 if kind in ("yes", "apartments", "commercial", "office", "hotel", "tower") else 40 + r.random() * 60
        if a > 5000:
            return 14.0 + r.random() * 14
        return 10.0 + r.random() * 16
    if a < 450:
        return 4.5 + r.random() * 5.5
    if a < 2000:
        return 8.0 + r.random() * 14
    return 9.0 + r.random() * 9


LANDMARKS = {      # key → (name matcher, clear radius in metres)
    "burj": (lambda n: n == "Burj Khalifa", 95.0),
    "et1": (lambda n: n == "Emirates Office Tower", 0.0),
    "et2": (lambda n: n == "Jumeirah Emirates Towers Hotel", 0.0),
    "mof": (lambda n: n.lower() == "museum of the future", 62.0),
    "dwtc": (lambda n: n == "Sheikh Rashid Tower", 0.0),
    "frame": (lambda n: n == "Dubai Frame", 30.0),
}


def principal_angle(ring: list[tuple[float, float]]) -> float:
    cx, cz = centroid(ring)
    sxx = sum((p[0] - cx) ** 2 for p in ring)
    szz = sum((p[1] - cz) ** 2 for p in ring)
    sxz = sum((p[0] - cx) * (p[1] - cz) for p in ring)
    return 0.5 * math.atan2(2 * sxz, sxx - szz)


def build_buildings(stations: list[dict]) -> tuple[list, dict, dict, list]:
    els = load("buildings")
    rings = []      # (tags, ring, is_part, osm_id)
    for e in els:
        t = e.get("tags", {})
        if e["type"] == "way":
            ring = pts(e.get("geometry", []))
            if len(ring) >= 4:
                rings.append((t, ring[:-1] if ring[0] == ring[-1] else ring, "building:part" in t, e["id"]))
        else:
            for m in e.get("members", []):
                if m.get("role") == "outer" and m.get("geometry"):
                    ring = pts(m["geometry"])
                    if len(ring) >= 4 and math.hypot(ring[0][0] - ring[-1][0], ring[0][1] - ring[-1][1]) < 1.0:
                        rings.append((t, ring[:-1], "building:part" in t, e["id"] * 7 + len(rings)))

    landmarks: dict[str, dict] = {}
    for t, ring, _, _ in rings:
        n = name_of(t)
        for key, (match, _) in LANDMARKS.items():
            if match(n) and (key not in landmarks or abs(area(ring)) > landmarks[key]["area"]):
                cx, cz = centroid(ring)
                landmarks[key] = {"x": round(cx, 1), "z": round(cz, 1), "area": round(abs(area(ring)), 1),
                                  "angle": round(principal_angle(ring), 4), "h": num(t.get("height")),
                                  "ring": flat(simplify(ring + [ring[0]], 0.8)[:-1])}
    st_xy = [project(s["lat"], s["lon"], F) for s in stations]

    def replaced(t: dict, cx: float, cz: float) -> bool:
        n = name_of(t)
        for key, (match, radius) in LANDMARKS.items():
            lm = landmarks.get(key)
            if lm and (match(n) or (radius and math.hypot(cx - lm["x"], cz - lm["z"]) < radius)):
                return True
        if t.get("building") == "train_station" and any(math.hypot(cx - sx, cz - sz) < 110 for sx, sz in st_xy):
            return True                            # replaced by the modelled station
        return False

    parts = [(centroid(r), r) for t, r, is_part, _ in rings if is_part]
    cell = 120.0
    grid: dict[tuple[int, int], list] = {}
    for (cx, cz), _ in parts:
        grid.setdefault((int(cx // cell), int(cz // cell)), []).append((cx, cz))

    out, stats, ghosts = [], {"tagged_height": 0, "tagged_levels": 0, "estimated": 0}, []
    for t, ring, is_part, oid in rings:
        cx, cz = centroid(ring)
        if not inside(cx, cz) or replaced(t, cx, cz):
            continue
        a = abs(area(ring))
        if a < 28:
            continue
        if not is_part:                             # an outline that has building:part children is drawn by its parts
            xs, zs = [p[0] for p in ring], [p[1] for p in ring]
            has_part = False
            for gx in range(int(min(xs) // cell), int(max(xs) // cell) + 1):
                for gz in range(int(min(zs) // cell), int(max(zs) // cell) + 1):
                    if any(pip(px, pz, ring) for px, pz in grid.get((gx, gz), [])):
                        has_part = True
                        break
                if has_part:
                    break
            if has_part:
                continue
        h, lv = num(t.get("height")), num(t.get("building:levels"))
        if h and h > 2:
            stats["tagged_height"] += 1
        elif lv and lv >= 1:
            h = lv * 3.5 + 1.5
            stats["tagged_levels"] += 1
        else:
            h = estimate_height(t, a, cx, cz, oid)
            stats["estimated"] += 1
        h = min(h, 520.0)
        mh = num(t.get("min_height"), 0.0) or (num(t.get("building:min_level"), 0.0) or 0.0) * 3.5
        if mh >= h:
            continue
        if area(ring) < 0:
            ring = ring[::-1]
        ring = simplify(ring + [ring[0]], 0.6 if a > 200 else 0.9)[:-1]
        if len(ring) < 3:
            continue
        # Sea-side (camera-side) frontage towers: solid up to a podium height, the rest as a translucent ghost.
        if cz > 22 and h > CAMERA_SIDE_CUT + 12 and mh < CAMERA_SIDE_CUT:
            ghosts.append([round(h, 1), CAMERA_SIDE_CUT, *flat(ring)])
            h = CAMERA_SIDE_CUT
        out.append([round(h, 1), round(mh, 1), *flat(ring)])
    return out, landmarks, stats, ghosts


# ---------------------------------------------------------------- roads
WIDTH = {"motorway": 3.6, "motorway_link": 3.6, "trunk": 3.5, "trunk_link": 3.5, "primary": 3.4, "primary_link": 3.4,
         "secondary": 3.3, "secondary_link": 3.3, "tertiary": 3.2, "tertiary_link": 3.2}
DEF_LANES = {"motorway": 4, "motorway_link": 2, "trunk": 3, "trunk_link": 1, "primary": 3, "primary_link": 1,
             "secondary": 2, "secondary_link": 1, "tertiary": 2, "tertiary_link": 1}


def chain(ways: list[dict]) -> list[list[dict]]:
    """Join one-way ways head to tail (matching end coordinates) into ordered chains."""
    key = lambda p: (round(p["lat"], 6), round(p["lon"], 6))                                     # noqa: E731
    by_start: dict = {}
    for w in ways:
        by_start.setdefault(key(w["geometry"][0]), []).append(w)
    ends = {key(w["geometry"][-1]) for w in ways}
    used, chains = set(), []
    starts = [w for w in ways if key(w["geometry"][0]) not in ends] or ways[:1]
    for s in starts:
        cur, ch = s, []
        while cur and cur["id"] not in used:
            used.add(cur["id"])
            ch.append(cur)
            nxt = [w for w in by_start.get(key(cur["geometry"][-1]), []) if w["id"] not in used]
            cur = nxt[0] if nxt else None
        if ch:
            chains.append(ch)
    return chains


def build_roads() -> tuple[list, list, list, list]:
    els = [e for e in load("roads") if e.get("geometry")]
    major, minor, szr_ways, bridges = [], [], [], []
    for e in els:
        t = e["tags"]
        hw = t["highway"]
        line = pts(e["geometry"])
        if not any(inside(x, z, 60) for x, z in line):
            continue
        lanes = num(t.get("lanes"), None)
        is_bridge = t.get("bridge") in ("yes", "viaduct") and (num(t.get("layer"), 1) or 1) >= 1
        if hw == "motorway" and (t.get("ref") == "E11" or "Sheikh Zayed" in name_of(t) or "Sheikh Rashid Road" in name_of(t)):
            szr_ways.append({**e, "lanes": lanes or 5})
            continue
        if hw in WIDTH:
            n = lanes or DEF_LANES[hw]
            if t.get("oneway") != "yes" and not lanes:
                n *= 2
            w = max(4.0, n * WIDTH[hw] + 1.0)
            rec = {"w": round(w, 1), "line": simplify(line, 0.35), "layer": int(num(t.get("layer"), 0) or 0), "e": e,
                   "cls": 0 if hw.startswith(("motorway", "trunk")) else 1 if hw.startswith("primary") else 2}
            if rec["layer"] < 0 or t.get("tunnel") == "yes":
                continue                            # underpasses are not drawn
            (bridges if is_bridge else major).append(rec)
        else:
            if hw == "service" and (t.get("service") in ("parking_aisle", "driveway", "drive-through") or len(line) < 3):
                w = 3.0
            else:
                w = 6.5 if hw in ("residential", "unclassified", "living_street") else 4.0
            minor.append((w, line))

    # Sheikh Zayed Road: one chain per direction, used for the lane-marked carriageways and the traffic.
    szr = []
    for ch in chain(szr_ways):
        line, lanes = [], []
        for w in ch:
            p = pts(w["geometry"])
            if line:
                p = p[1:]
            line += p
            lanes += [w["lanes"]] * len(p)
        keep = [i for i, (x, z) in enumerate(line) if inside(x, z, 250)]
        if len(keep) < 2:
            continue
        line, lanes = line[keep[0]: keep[-1] + 1], lanes[keep[0]: keep[-1] + 1]
        length = sum(math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) for i in range(len(line) - 1))
        if length > 1500:
            szr.append({"len": round(length), "dir": 1 if line[-1][0] > line[0][0] else -1,
                        "p": flat(line), "lanes": [int(v) for v in lanes]})
    szr.sort(key=lambda c: -c["len"])
    szr = szr[:2] if len({c["dir"] for c in szr[:2]}) == 2 else szr[:4]

    # Flyovers: chains of bridge ways, exported with an arch height profile (0 at both ends).
    fly = []
    for layer in sorted({b["layer"] for b in bridges}):
        group = [b for b in bridges if b["layer"] == layer]
        for ch in chain([{**b["e"], "_rec": b} for b in group]):
            line = []
            for w in ch:
                p = pts(w["geometry"])
                line += p[1:] if line else p
            line = simplify(line, 0.3)
            cum = [0.0]
            for i in range(len(line) - 1):
                cum.append(cum[-1] + math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]))
            total = cum[-1] or 1.0
            top = 7.5 * max(1, layer)
            ramp = min(0.42, 110.0 / total)

            def y(u: float) -> float:
                k = min(u, 1 - u) / ramp
                k = max(0.0, min(1.0, k))
                return top * k * k * (3 - 2 * k)
            fly.append({"w": ch[0]["_rec"]["w"], "p": [v for (x, z), c in zip(line, cum) for v in (round(x, 1), round(y(c / total), 1), round(z, 1))]})
    major_out = [[r["cls"], r["w"], *flat(r["line"])] for r in major]
    return major_out, minor, szr, fly


# ---------------------------------------------------------------- water, parks, footbridges, metro
def polygons(els: list[dict], pred) -> list[list[tuple[float, float]]]:
    out = []
    for e in els:
        t = e.get("tags", {})
        if not pred(t):
            continue
        geoms = [e["geometry"]] if e["type"] == "way" and e.get("geometry") else \
            [m["geometry"] for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
        for g in geoms:
            ring = pts(g)
            if len(ring) >= 4 and math.hypot(ring[0][0] - ring[-1][0], ring[0][1] - ring[-1][1]) < 2.0 \
                    and any(inside(x, z, 100) for x, z in ring):
                out.append(simplify(ring, 0.8))
    return out


def canal_from_relations(els: list[dict]) -> list[list[tuple[float, float]]]:
    """Water multipolygons whose outer ring is split over several ways: stitch the pieces."""
    out = []
    for e in els:
        if e["type"] != "relation" or e.get("tags", {}).get("natural") != "water":
            continue
        segs = [pts(m["geometry"]) for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
        segs = [s for s in segs if len(s) >= 2 and math.hypot(s[0][0] - s[-1][0], s[0][1] - s[-1][1]) >= 2.0]
        while segs:
            ring = segs.pop(0)
            grew = True
            while grew and math.hypot(ring[0][0] - ring[-1][0], ring[0][1] - ring[-1][1]) > 2.0:
                grew = False
                for i, s in enumerate(segs):
                    if math.hypot(s[0][0] - ring[-1][0], s[0][1] - ring[-1][1]) < 2.0:
                        ring += s[1:]
                    elif math.hypot(s[-1][0] - ring[-1][0], s[-1][1] - ring[-1][1]) < 2.0:
                        ring += s[::-1][1:]
                    else:
                        continue
                    segs.pop(i)
                    grew = True
                    break
            if len(ring) >= 4 and any(inside(x, z, 100) for x, z in ring):
                out.append(simplify(ring, 0.8))
    return out


def metro_line(rail: list[dict]) -> tuple[list[tuple[float, float]], str]:
    """Red Line centreline: the OSM viaduct track where available (matches the OSM buildings to the metre),
    else the coarser official GTFS shape."""
    best: list[tuple[float, float]] = []
    for e in rail:
        t = e.get("tags", {})
        if t.get("railway") == "subway" and e.get("geometry") and "Red Line" in name_of(t):
            line = [q for q in pts(e["geometry"]) if X0 - 400 <= q[0] <= X1 + 400]
            if len(line) > len(best):
                best = line
    if len(best) >= 20:
        if best[0][0] > best[-1][0]:
            best.reverse()
        return best, "OpenStreetMap railway=subway (Red Line Metro)"
    return metro_line_gtfs(), "RTA GTFS shape"


def metro_line_gtfs() -> list[tuple[float, float]]:
    gj = json.loads((OUT / "metro.geojson").read_text(encoding="utf-8"))
    red = next(f for f in gj["features"] if f["properties"].get("line") == "Red")
    line = [project(lat, lon, F) for lon, lat in red["geometry"]["coordinates"]]
    line = [p for p in line if X0 - 400 <= p[0] <= X1 + 400 and abs(p[1]) < 900]
    if line[0][0] > line[-1][0]:
        line.reverse()
    dedup = [line[0]]
    for p in line[1:]:
        if math.hypot(p[0] - dedup[-1][0], p[1] - dedup[-1][1]) > 1.0:
            dedup.append(p)
    return dedup


# ---------------------------------------------------------------- ground map
def ground_map(buildings, minor, major, water, parks, pitches, szr, px_per_m: float = 0.5) -> Image.Image:
    pad = 300
    gx0, gx1, gz0, gz1 = X0 - pad, X1 + pad, Z0 - pad, Z1 + pad
    w, h = int((gx1 - gx0) * px_per_m), int((gz1 - gz0) * px_per_m)
    tx = lambda x, z: ((x - gx0) * px_per_m, (z - gz0) * px_per_m)                                # noqa: E731
    sand, paved, street, park, wat = (219, 196, 152), (201, 194, 180), (128, 128, 132), (108, 148, 92), (52, 124, 160)
    img = Image.new("RGB", (w, h), sand)
    # paved city blocks = the neighbourhood of buildings (blurred mask so the city fades into the sand)
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    for b in buildings:
        ring = [tx(b[i], b[i + 1]) for i in range(2, len(b), 2)]
        md.polygon(ring, fill=255)
    for wd, line in minor:
        md.line([tx(x, z) for x, z in line], fill=255, width=max(1, int(wd * px_per_m * 2)))
    mask = mask.filter(ImageFilter.MaxFilter(21)).filter(ImageFilter.GaussianBlur(14))
    img.paste(Image.new("RGB", (w, h), paved), (0, 0), mask)
    d = ImageDraw.Draw(img)
    for ring in parks:
        d.polygon([tx(x, z) for x, z in ring], fill=park)
    for ring in pitches:
        d.polygon([tx(x, z) for x, z in ring], fill=(96, 140, 86))
    for wd, line in minor:
        d.line([tx(x, z) for x, z in line], fill=street, width=max(1, round(wd * px_per_m)), joint="curve")
    for r in major:                                # soft kerb under the 3D road ribbons
        d.line([tx(r[i], r[i + 1]) for i in range(2, len(r), 2)], fill=(168, 166, 162), width=max(2, round((r[1] + 5) * px_per_m)), joint="curve")
    for c in szr:
        d.line([tx(c["p"][i], c["p"][i + 1]) for i in range(0, len(c["p"]), 2)], fill=(160, 158, 156), width=round(34 * px_per_m), joint="curve")
    for ring in water:
        d.polygon([tx(x, z) for x, z in ring], fill=wat)
    for b in buildings:                            # contact shadow under every footprint
        d.polygon([tx(b[i], b[i + 1]) for i in range(2, len(b), 2)], fill=(158, 151, 139))
    return img.filter(ImageFilter.GaussianBlur(0.6))


def main() -> None:
    import yaml
    cfg = yaml.safe_load((ROOT / "config/corridor.yaml").read_text(encoding="utf-8"))
    stations = cfg["stations"]
    buildings, landmarks, stats, ghosts = build_buildings(stations)
    major, minor, szr, fly = build_roads()
    nature = load("nature")
    water = polygons(nature, lambda t: t.get("natural") == "water") + canal_from_relations(nature)
    water = [r for r in water if abs(area(r)) > 150]
    parks = polygons(nature, lambda t: t.get("leisure") in ("park", "garden", "golf_course") or t.get("landuse") in ("grass", "recreation_ground", "cemetery"))
    pitches = polygons(nature, lambda t: t.get("leisure") == "pitch")
    rail = load("rail")
    foot = []
    st_xy = [project(s["lat"], s["lon"], F) for s in stations]
    for e in rail:
        t = e.get("tags", {})
        if t.get("highway") == "footway" and t.get("bridge") and e.get("geometry"):
            line = pts(e["geometry"])
            length = sum(math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) for i in range(len(line) - 1))
            if length > 25 and any(inside(x, z) for x, z in line) and min(abs(z) for _, z in line) < 260:
                foot.append(flat(simplify(line, 0.4)))
    metro, metro_src = metro_line(rail)

    OUT.mkdir(parents=True, exist_ok=True)
    img = ground_map(buildings, minor, major, water, parks, pitches, szr)
    img.save(OUT / "ground.png", optimize=True)
    pad = 300
    scene = {
        "meta": {
            "frame": {k: round(v, 9) for k, v in F.items()}, "extent": list(EXTENT),
            "ground": {"file": "ground.png", "x0": X0 - pad, "x1": X1 + pad, "z0": Z0 - pad, "z1": Z1 + pad},
            "generated": dt.date.today().isoformat(),
            "attribution": "Map data © OpenStreetMap contributors (ODbL). Stations and timetable: RTA GTFS open data.",
            "metro_source": metro_src,
            "height_sources": stats, "camera_side_cut_m": CAMERA_SIDE_CUT,
            "notes": "Building heights: OSM tags where present, otherwise estimated from footprint and district.",
        },
        "landmarks": landmarks,
        "buildings": buildings, "ghosts": ghosts,
        "roads": major, "szr": szr, "flyovers": fly, "footbridges": foot,
        "water": [flat(r) for r in water], "parks": [flat(r) for r in parks if abs(area(r)) > 400],
        "metro": flat(metro),
        "stations_osm": [{"id": s["id"], "x": round(x, 1), "z": round(z, 1)} for s, (x, z) in zip(stations, st_xy)],
    }
    f = OUT / "corridor_scene.json"
    f.write_text(json.dumps(scene, separators=(",", ":")), encoding="utf-8")
    print(f"buildings {len(buildings)} (+{len(ghosts)} ghosted tops) heights {stats}")
    print(f"roads major {len(major)} minor(texture) {len(minor)} szr chains {[(c['len'], c['dir']) for c in szr]} flyovers {len(fly)} footbridges {len(foot)}")
    print(f"water {len(water)} parks {len(parks)} metro pts {len(metro)} landmarks {sorted(landmarks)}")
    print(f"{f.name}: {f.stat().st_size / 1e6:.2f} MB · ground.png {img.size} {(OUT / 'ground.png').stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
