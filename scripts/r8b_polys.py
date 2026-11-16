"""What the web app needs to know about the hand-built site models: `apps/web/public/models/sites.json`.

`sites.json` used to list only (x, z, 8 m) circles, one per replaced map record. A footprint holds more than one
baked building (the DIFC Gate's 69 × 69 m footprint holds three more, which then poked through the arch), so the web
app also drops every ring building whose centre lies inside one of the `polys` written here (`Ring.tsx`).

Adds to the file written by scripts/r8b_sites.py, from committed data only (no raw map data needed):

    polys         footprints of every modelled site: scripts/blender/r8b_sites.json and landmark_sites.json (#127)
    models        the site models to load
    fountain      the Dubai Fountain's centre, axis and length: the web app animates its jets (Fountain.tsx)
    station_skip  x, z, radius per metro station: a mapped building standing on a station is left out, because the
                  station model stands there (the map has Financial Centre station's own outline as a 161 m tower)

    python scripts/landmark_sites.py && python scripts/r8b_polys.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
SITES = ROOT / "scripts/blender/r8b_sites.json"
SITES2 = ROOT / "scripts/blender/landmark_sites.json"
SCENE = ROOT / "apps/web/public/geo/corridor_scene.json"
CORRIDOR = ROOT / "config/corridor.yaml"
OUT = ROOT / "apps/web/public/models/sites.json"
STATION_R = 45.0            # a station shell is about 130 × 30 m: a building centred this close stands on it
# The fountain's bow, fitted by eye to open water on the baked water mask (apps/web/public/geo/v2/m_2_1.png, 9.8 m a
# pixel): r8b_sites.py took the centroid and long axis of the whole lake polygon, which put both ends of the bow on
# land (Burj Park island at one end). Scene metres and radians; the length stays the published 275 m.
FOUNTAIN_FIT = {"x": 1592.0, "z": -998.0, "axis_rad": 0.124}


def polygons(sites: list[dict]) -> list[list[float]]:
    """One flat [x0, z0, x1, z1, …] ring per mapped part of every site that has a footprint (rounded to 0.1 m).
    Parts marked `under` are already inside another part's ring, so they need no ring of their own."""
    out = []
    for s in sites:
        for q in s.get("prisms", []):
            ring = q["ring"]
            if len(ring) >= 3 and not q.get("under"):
                out.append([round(v, 1) for x, z in ring for v in (x, z)])
    return out


def station_circles(scene: dict, stations: list[dict]) -> list[float]:
    """Each station snapped onto the viaduct centreline, as the web app places it (Metro.tsx placeStations)."""
    f, m = scene["meta"]["frame"], scene["metro"]
    line = [(m[i], m[i + 1]) for i in range(0, len(m), 2)]
    out: list[float] = []
    for st in stations:
        e, n = (st["lon"] - f["lon0"]) * f["m_lon"], (st["lat"] - f["lat0"]) * f["m_lat"]
        x, z = e * f["ux"] + n * f["uy"], e * f["uy"] - n * f["ux"]
        best = (math.inf, x, z)
        for (x0, z0), (x1, z1) in zip(line, line[1:]):
            dx, dz = x1 - x0, z1 - z0
            t = max(0.0, min(1.0, ((x - x0) * dx + (z - z0) * dz) / max(1e-9, dx * dx + dz * dz)))
            px, pz = x0 + dx * t, z0 + dz * t
            best = min(best, (math.hypot(px - x, pz - z), px, pz))
        out += [round(best[1], 1), round(best[2], 1), STATION_R]
    return out


def main() -> None:
    sites = json.loads(SITES.read_text(encoding="utf-8"))["sites"]
    more = json.loads(SITES2.read_text(encoding="utf-8"))["sites"] if SITES2.exists() else []
    data = json.loads(OUT.read_text(encoding="utf-8"))
    data["polys"] = polygons(sites + more)
    fountain = next((s for s in sites if s.get("role") == "fountain"), None)
    data["models"] = [s["model"] for s in sites + more if s.get("role") != "fountain"]
    if fountain:
        data["fountain"] = {**FOUNTAIN_FIT, "length_m": fountain["length_m"],
                            "source": "https://en.wikipedia.org/wiki/Dubai_Fountain (length); placed on the mapped lake; the jets are a pattern, not a show"}
    data["station_skip"] = station_circles(json.loads(SCENE.read_text(encoding="utf-8")), yaml.safe_load(CORRIDOR.read_text(encoding="utf-8"))["stations"])
    OUT.write_text(json.dumps(data), encoding="utf-8", newline="\n")
    print(f"{len(data['polys'])} footprint polygons, {len(data['models'])} site models, {len(data['station_skip']) // 3} station circles → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
