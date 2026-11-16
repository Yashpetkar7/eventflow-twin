"""Footprints for the second set of hand-built landmarks (decision #127), taken from the baked scene itself.

The realism ring's chunks (apps/web/public/geo/v2/b_*.json, from Overture Maps / OpenStreetMap) already hold every
footprint in scene coordinates, so this needs no raw map data. For each landmark it picks the mapped records by place
and height, and writes

    scripts/blender/landmark_sites.json     the rings each Blender builder stands on (scripts/blender/build_models.py)

Every picked record is replaced by the model: scripts/r8b_polys.py adds its ring to apps/web/public/models/sites.json,
and the web app leaves out the ring buildings inside it. Burj Al Arab lies outside the detailed ring (11.6 km from the
corridor), so it has no mapped footprint here: it is placed by its coordinates, as a distant silhouette on the coast.

    python scripts/landmark_sites.py && python scripts/r8b_polys.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V2 = ROOT / "apps/web/public/geo/v2"
OUT = ROOT / "scripts/blender/landmark_sites.json"

# model → where to look and which mapped records to take. `pick(h, min_h, area, cls)`; cls 3 = low-rise (podiums).
# Heights are the map's own (OpenStreetMap tags via Overture); `facts` are published figures used for proportions only.
SITES = [
    {"model": "one_zaabeel", "name": "One Za'abeel", "lat": 25.2274, "lon": 55.2912, "r": 180,
     "pick": lambda h, mh, a, c: h >= 200 or mh >= 60,
     "facts": {"tower_m": 305, "residences_m": 235, "link_length_m": 230, "link_above_ground_m": 100},
     "source": "https://en.wikipedia.org/wiki/One_Za%27abeel"},
    {"model": "address_sky_view", "name": "Address Sky View", "lat": 25.2005, "lon": 55.2715, "r": 170,
     "pick": lambda h, mh, a, c: h >= 150,
     "facts": {"towers": 2, "bridge": "sky bridge between the towers near the top"},
     "source": "https://en.wikipedia.org/wiki/Address_Sky_View"},
    {"model": "address_downtown", "name": "Address Downtown", "lat": 25.1937, "lon": 55.2792, "r": 80,
     "pick": lambda h, mh, a, c: h >= 200,
     "facts": {"height_m": 302}, "source": "https://en.wikipedia.org/wiki/Address_Downtown"},
    {"model": "coca_cola_arena", "name": "Coca-Cola Arena", "lat": 25.2053, "lon": 55.2653, "r": 200,
     "pick": lambda h, mh, a, c: a >= 10000,
     "facts": {"capacity": 17000}, "source": "https://en.wikipedia.org/wiki/Coca-Cola_Arena"},
]
# On the Sentinel-2 overview (39 m a pixel) the island lies about 110 m seaward of these coordinates; `nudge` (scene
# metres: x along the coast, z towards the sea) moves the model onto it.
BURJ_AL_ARAB = {"model": "burj_al_arab", "name": "Burj Al Arab", "lat": 25.1412, "lon": 55.1853, "nudge": [-10.0, 108.0],
                "facts": {"height_m": 321, "island_offshore_m": 280}, "source": "https://en.wikipedia.org/wiki/Burj_Al_Arab"}


def project(f: dict, lat: float, lon: float) -> tuple[float, float]:
    e, n = (lon - f["lon0"]) * f["m_lon"], (lat - f["lat0"]) * f["m_lat"]
    return e * f["ux"] + n * f["uy"], e * f["uy"] - n * f["ux"]


def area(pts: list[float]) -> float:
    n = len(pts) // 2
    return abs(sum(pts[2 * i] * pts[(2 * i + 3) % len(pts)] - pts[(2 * i + 2) % len(pts)] * pts[2 * i + 1] for i in range(n))) / 2


def inside(px: float, pz: float, p: list[float]) -> bool:
    """Even-odd point-in-polygon on a flat [x0, z0, x1, z1, …] ring (the test the web app uses, models.tsx)."""
    c, j = False, len(p) - 2
    for i in range(0, len(p), 2):
        if (p[i + 1] > pz) != (p[j + 1] > pz) and px < (p[j] - p[i]) * (pz - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]:
            c = not c
        j = i
    return c


def main() -> None:
    man = json.loads((V2 / "manifest.json").read_text(encoding="utf-8"))
    frame = man["frame"]
    full = {",".join(map(str, g[2:])): g[0] for g in man["ghosts"]}          # sea-side towers are baked cut to 42 m
    records = []
    for c in man["chunks"]:
        chunk = json.loads((V2 / c["buildings"]).read_text(encoding="utf-8"))
        for b, cls in zip(chunk["buildings"], chunk["cls"]):
            pts = b[2:]
            h = full.get(",".join(map(str, pts)), b[0]) if b[0] == man.get("camera_side_cut_m", 42) else b[0]
            n = len(pts) // 2
            records.append((h, b[1], pts, sum(pts[0::2]) / n, sum(pts[1::2]) / n, cls))
    out = []
    for s in SITES:
        x, z = project(frame, s["lat"], s["lon"])
        prisms = []
        for h, mh, pts, cx, cz, cls in records:
            if math.hypot(cx - x, cz - z) <= s["r"] and s["pick"](h, mh, area(pts), cls):
                prisms.append({"h": h, "min_h": mh, "area": round(area(pts)), "ring": [[pts[i], pts[i + 1]] for i in range(0, len(pts), 2)]})
        # anything else whose centre lies inside a picked footprint (a podium, a link at street level): the web app
        # leaves it out with the rest, so the model has to draw it
        rings = [[v for pt in q["ring"] for v in pt] for q in prisms]
        have = {str(q["ring"]) for q in prisms}
        for h, mh, pts, cx, cz, cls in records:
            ring = [[pts[i], pts[i + 1]] for i in range(0, len(pts), 2)]
            if math.hypot(cx - x, cz - z) <= s["r"] + 150 and str(ring) not in have and any(inside(cx, cz, r) for r in rings):
                prisms.append({"h": h, "min_h": mh, "area": round(area(pts)), "ring": ring, "under": True})
        prisms.sort(key=lambda p: (-p["h"], -p["area"]))
        out.append({"model": s["model"], "name": s["name"], "centre": [round(x, 1), round(z, 1)], "prisms": prisms, "facts": s["facts"], "source": s["source"]})
        print(f"{s['model']:18} {len(prisms):2d} mapped parts ({sum(1 for q in prisms if q.get('under'))} under a footprint), tallest {prisms[0]['h'] if prisms else '—'} m")
    x, z = project(frame, BURJ_AL_ARAB["lat"], BURJ_AL_ARAB["lon"])
    x, z = x + BURJ_AL_ARAB["nudge"][0], z + BURJ_AL_ARAB["nudge"][1]
    out.append({"model": "burj_al_arab", "name": "Burj Al Arab", "centre": [round(x, 1), round(z, 1)], "prisms": [], "facts": BURJ_AL_ARAB["facts"],
                "source": BURJ_AL_ARAB["source"], "note": "outside the detailed ring: placed by coordinates on the island seen in the satellite overview, no mapped footprint"})
    print(f"burj_al_arab       placed at ({x:.0f}, {z:.0f}), outside the detailed ring")
    OUT.write_text(json.dumps({"note": __doc__.split("\n\n")[0], "sites": out}, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
