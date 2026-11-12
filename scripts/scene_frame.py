"""Local frame of the 3D twin: real metres, rotated so the corridor (Max → Business Bay) runs along +x.

    x = along the corridor, towards the south-west (Max at −x, Business Bay at +x)
    z = towards the north-west (the sea side — where the camera stands); the inland side is −z
    y = up

The same numbers are written into corridor_scene.json so the web app projects the API's station and event
coordinates with exactly this transform.
"""
from __future__ import annotations

import math
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]

# Extent of the baked scene in local metres (x_min, x_max, z_min, z_max)
EXTENT = (-3800.0, 4100.0, -2000.0, 1350.0)


def frame() -> dict:
    cfg = yaml.safe_load((ROOT / "config/corridor.yaml").read_text(encoding="utf-8"))
    st = {s["id"]: s for s in cfg["stations"]}
    a, b = st["MAX"], st["BBY"]
    lat0, lon0 = (a["lat"] + b["lat"]) / 2, (a["lon"] + b["lon"]) / 2
    m_lat = 110574.0
    m_lon = 111320.0 * math.cos(math.radians(lat0))
    de, dn = (b["lon"] - a["lon"]) * m_lon, (b["lat"] - a["lat"]) * m_lat
    ln = math.hypot(de, dn)
    return {"lat0": lat0, "lon0": lon0, "m_lat": m_lat, "m_lon": m_lon, "ux": de / ln, "uy": dn / ln}


def project(lat: float, lon: float, f: dict | None = None) -> tuple[float, float]:
    f = f or frame()
    e, n = (lon - f["lon0"]) * f["m_lon"], (lat - f["lat0"]) * f["m_lat"]
    return e * f["ux"] + n * f["uy"], e * f["uy"] - n * f["ux"]


def unproject(x: float, z: float, f: dict | None = None) -> tuple[float, float]:
    f = f or frame()
    e = x * f["ux"] + z * f["uy"]
    n = x * f["uy"] - z * f["ux"]
    return f["lat0"] + n / f["m_lat"], f["lon0"] + e / f["m_lon"]


def corridor_bbox() -> tuple[float, float, float, float]:
    """(south, west, north, east) covering EXTENT."""
    f = frame()
    x0, x1, z0, z1 = EXTENT
    pts = [unproject(x, z, f) for x in (x0, x1) for z in (z0, z1)]
    lats, lons = [p[0] for p in pts], [p[1] for p in pts]
    return min(lats), min(lons), max(lats), max(lons)


if __name__ == "__main__":
    print(frame())
    print(corridor_bbox())
