"""Footprint polygons of the R8b site models, for the web app to clear the city buildings they replace.

`sites.json` used to list only (x, z, 8 m) circles, one per replaced map record. A footprint holds more than one
baked building (the DIFC Gate's 69 × 69 m footprint holds three more, which then poked through the arch), so the web
app also drops every ring building whose centre lies inside one of these polygons (`Ring.tsx`).

Reads scripts/blender/r8b_sites.json (already in scene coordinates, committed) and adds `polys` to
apps/web/public/models/sites.json. Needs no raw map data. Run after scripts/r8b_sites.py:

    python scripts/r8b_polys.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITES = ROOT / "scripts/blender/r8b_sites.json"
OUT = ROOT / "apps/web/public/models/sites.json"


def polygons(sites: list[dict]) -> list[list[float]]:
    """One flat [x0, z0, x1, z1, …] ring per mapped part of every site that has a footprint (rounded to 0.1 m)."""
    out = []
    for s in sites:
        for q in s.get("prisms", []):
            ring = q["ring"]
            if len(ring) >= 3:
                out.append([round(v, 1) for x, z in ring for v in (x, z)])
    return out


def main() -> None:
    sites = json.loads(SITES.read_text(encoding="utf-8"))["sites"]
    data = json.loads(OUT.read_text(encoding="utf-8"))
    data["polys"] = polygons(sites)
    OUT.write_text(json.dumps(data), encoding="utf-8", newline="\n")
    print(f"{len(data['polys'])} footprint polygons → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
