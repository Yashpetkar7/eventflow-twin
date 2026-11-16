"""R8b sites (docs/13 → "R8–R10 — status"): footprints, heights and positions of the new landmarks, for the Blender
build (scripts/blender/build_models.py) and the scene. Reads the R1 Overture download (data/raw/realism/overture);
writes two small committed files so the Blender build and the web app need no raw data:

    scripts/blender/r8b_sites.json     every prism to model (footprint in the scene frame, base and top height, role)
    apps/web/public/models/sites.json  where each ring building the models replace stands (x, z, radius triples)

Sites: the Dubai Mall (its Overture building parts), the Dubai Fountain (an arc in the Burj Khalifa lake, placed along
the lake's long axis), the DIFC Gate building, and the 10 tallest towers that face Sheikh Zayed Road between the World
Trade Centre and Business Bay stations (not counting Emirates Towers and Burj Khalifa, which are modelled already).
Tower silhouettes come from data: each tower's Overture building parts where it has them (setbacks, crowns), else its
footprint; the architectural height from config/landmark_heights.yaml, and the difference to the roof height in the
map becomes a spire. Approximations, not survey models.
    python scripts/r8b_sites.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build_scene import area, centroid, simplify  # noqa: E402
from scene_frame import frame, project  # noqa: E402

RAW = ROOT / "data/raw/realism/overture"
F = frame()
STATIONS = {s["id"]: s for s in json.loads((ROOT / "apps/web/public/geo/corridor_scene.json").read_text(encoding="utf-8"))["stations_osm"]}
X0, X1 = STATIONS["WTC"]["x"], STATIONS["BBY"]["x"]        # between the World Trade Centre and Business Bay stations
FRONT = 300.0                                              # metres either side of Sheikh Zayed Road (z = 0)
MODELLED = ("emirates office tower", "jumeirah emirates office tower", "emirates towers hotel", "burj khalifa")
JETS = 24


def rings(con, sql: str) -> list[dict]:
    out = []
    for oid, name, h, mh, gj in con.execute(sql).fetchall():
        g = json.loads(gj)
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            ring = [project(lat, lon, F) for lon, lat in poly[0]]
            ring = simplify(ring if ring[0] == ring[-1] else ring + [ring[0]], 0.8)[:-1]
            if len(ring) >= 3 and abs(area(ring)) > 20:
                if area(ring) < 0:
                    ring = ring[::-1]
                out.append({"id": oid, "name": name, "h": float(h or 0), "min_h": float(mh or 0), "ring": [[round(x, 2), round(z, 2)] for x, z in ring]})
    return out


def main() -> None:
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial; SET geometry_always_xy=true;")
    b, p, w = ((RAW / f).as_posix() for f in ("buildings.parquet", "building_parts.parquet", "water.parquet"))
    y = yaml.safe_load((ROOT / "config/landmark_heights.yaml").read_text(encoding="utf-8"))
    heights = y["towers"] + y["sites"]
    by_name = {n.lower(): t for t in heights for n in [t["name"], *t.get("aliases", [])]}

    def parts_or_self(oid: str, has_parts: bool) -> list[dict]:
        if has_parts:
            got = rings(con, f"SELECT id, name, height, min_height, ST_AsGeoJSON(geometry) FROM read_parquet('{p}') WHERE building_id = '{oid}' AND height IS NOT NULL")
            if got:
                return got
        return rings(con, f"SELECT id, name, height, min_height, ST_AsGeoJSON(geometry) FROM read_parquet('{b}') WHERE id = '{oid}'")

    def drawn(oid: str, has_parts: bool) -> list[dict]:
        """The ring records the bake drew for this building: its parts if it has any (whatever their height), else itself."""
        if has_parts:
            got = rings(con, f"SELECT id, name, height, min_height, ST_AsGeoJSON(geometry) FROM read_parquet('{p}') WHERE building_id = '{oid}'")
            if got:
                return got
        return rings(con, f"SELECT id, name, height, min_height, ST_AsGeoJSON(geometry) FROM read_parquet('{b}') WHERE id = '{oid}'")

    sites, replaced = [], []
    # towers: Overture buildings with a mapped height, facing Sheikh Zayed Road between the two stations
    cands = []
    for oid, name, h, has_parts, lat, lon in con.execute(
            f"SELECT id, name, height, has_parts, ST_Y(ST_Centroid(geometry)), ST_X(ST_Centroid(geometry)) FROM read_parquet('{b}') "
            "WHERE height >= 150 AND name IS NOT NULL").fetchall():
        x, z = project(lat, lon, F)
        if X0 < x < X1 and abs(z) < FRONT and name.lower() not in MODELLED:
            cands.append((float(h), oid, name, has_parts))
    cands.sort(reverse=True)
    for i, (h, oid, name, has_parts) in enumerate(cands[:10]):
        prisms = parts_or_self(oid, has_parts)
        replaced += drawn(oid, has_parts)
        roof = max(q["h"] for q in prisms)
        ref = by_name.get(name.lower())
        assert ref, f"{name}: add its height and source to config/landmark_heights.yaml"
        arch = float(ref["height_m"])
        sites.append({"model": f"tower_{i + 1:02d}", "name": name, "role": "tower", "prisms": prisms,
                      "roof_m": roof, "height_m": arch, "spire_m": round(max(0.0, arch - roof), 1), "height_source": ref["source"]})

    # the Dubai Mall: its building parts (the bake drew the parts, not the outline)
    # (its one mapped part has no height, so the model is the mapped outline at the outline's own height tag)
    oid, has_parts = con.execute(f"SELECT id, has_parts FROM read_parquet('{b}') WHERE name = 'دبي مول'").fetchone()
    replaced += drawn(oid, has_parts)
    sites.append({"model": "dubai_mall", "name": "The Dubai Mall", "role": "mall", "prisms": parts_or_self(oid, False),
                  "height_source": by_name["the dubai mall"]["source"]})

    # the DIFC Gate building ("مركز دبي المالي العالمي" in the map, 60 m, 15 storeys)
    oid, has_parts = con.execute(f"SELECT id, has_parts FROM read_parquet('{b}') WHERE name = 'مركز دبي المالي العالمي'").fetchone()
    replaced += drawn(oid, has_parts)
    sites.append({"model": "difc_gate", "name": "The Gate, DIFC", "role": "gate", "prisms": parts_or_self(oid, has_parts),
                  "height_source": by_name["the gate, difc"]["source"]})

    # the Dubai Fountain: an arc along the long axis of the Burj Khalifa lake, centred on the lake's main basin
    (gj,) = con.execute(f"SELECT ST_AsGeoJSON(geometry) FROM read_parquet('{w}') WHERE name = 'بحيرة برج خليفة'").fetchone()
    g = json.loads(gj)
    poly = g["coordinates"] if g["type"] == "Polygon" else max(g["coordinates"], key=lambda q: len(q[0]))
    lake = [project(lat, lon, F) for lon, lat in poly[0]]
    cx, cz = centroid(lake)
    sxx = sum((x - cx) ** 2 for x, _ in lake); szz = sum((z - cz) ** 2 for _, z in lake); sxz = sum((x - cx) * (z - cz) for x, z in lake)
    ang = 0.5 * math.atan2(2 * sxz, sxx - szz)
    sites.append({"model": "dubai_fountain", "name": "The Dubai Fountain", "role": "fountain", "prisms": [],
                  "centre": [round(cx, 1), round(cz, 1)], "axis_rad": round(ang, 4), "length_m": by_name["the dubai fountain"]["length_m"], "jets": JETS,
                  "height_source": by_name["the dubai fountain"]["source"]})

    skip = []
    for q in replaced:                                        # every ring building the models replace, by its centroid
        x, z = centroid([tuple(v) for v in q["ring"]])
        skip += [round(x, 1), round(z, 1), 8.0]
    (ROOT / "scripts/blender/r8b_sites.json").write_text(json.dumps({"note": __doc__.split("\n\n")[0], "sites": sites}, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    (ROOT / "apps/web/public/models/sites.json").write_text(json.dumps({"skip": skip, "models": [s["model"] for s in sites]}), encoding="utf-8", newline="\n")
    for s in sites:
        print(s["model"], s["name"], "prisms", len(s["prisms"]), "roof", s.get("roof_m"), "height", s.get("height_m"), "spire", s.get("spire_m"), "|", s["height_source"][:60])
    import r8b_polys                                          # footprint polygons for the web app (scripts/r8b_polys.py)
    r8b_polys.main()


if __name__ == "__main__":
    main()
