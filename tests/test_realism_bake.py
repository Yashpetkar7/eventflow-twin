"""Realism bake (docs/13, R1): the height priority, the type classes, the 3D-GloBFP calibration and the committed
v2 files (apps/web/public/geo/v2). Needs none of the bake-only packages (duckdb, rasterio, Pillow)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import realism_bake as rb  # noqa: E402
from scene_frame import RING  # noqa: E402

GEO = ROOT / "apps/web/public/geo"
V2 = GEO / "v2"


def test_height_priority():
    est = 7.0
    assert rb.pick_height("OpenStreetMap", 120.0, 30, 50.0, 300.0, est) == (120.0, "osm_height")
    assert rb.pick_height("OpenStreetMap", None, 10, 50.0, 300.0, est) == (33.0, "osm_levels")
    assert rb.pick_height("Microsoft ML Buildings", 40.0, None, 50.0, None, est) == (40.0, "overture_height")
    assert rb.pick_height("Microsoft ML Buildings", None, 4, 50.0, None, est) == (4 * rb.LEVEL_M, "overture_floors")
    assert rb.pick_height("OpenStreetMap", None, None, 50.0, 300.0, est) == (50.0, "globfp_calibrated")
    assert rb.pick_height("OpenStreetMap", None, None, None, 300.0, est) == (300.0, "landmark_list")
    assert rb.pick_height(None, None, None, None, None, est) == (est, "estimated")
    assert rb.pick_height("OpenStreetMap", 0.0, 0, 1.0, None, est) == (est, "estimated")        # junk values are not heights


def test_classes():
    assert rb.classify("religious", "mosque", 15, 900) == "mosque"
    assert rb.classify(None, "stadium", 30, 20000) == "stadium"
    assert rb.classify("industrial", None, 9, 3000) == "industrial"
    assert rb.classify(None, None, 180, 1500) == "tower"
    assert rb.classify("residential", "house", 7, 250) == "villa"
    assert rb.classify(None, None, 6.6, 300) == "villa"
    assert rb.classify("residential", "apartments", 30, 800) == "midrise"
    assert rb.classify("commercial", "retail", 12, 30000) == "lowrise"
    assert set(rb.CLASSES) >= {rb.classify(None, None, h, a) for h in (5, 20, 100) for a in (100, 2000, 9000)}


def test_globfp_calibration_is_monotone_and_follows_the_tags():
    # raw value says nothing below 30 m (two-storey houses), then rises: as measured in Dubai
    pairs = [(g, 6.6) for g in range(2, 30)] * 10 + [(35.0, 25.0)] * 30 + [(60.0, 80.0)] * 30
    table = rb.calibration(pairs, bins=8)
    assert all(a[1] <= b[1] for a, b in zip(table, table[1:]))
    assert rb.calibrated(12.0, table) == 6.6
    assert rb.calibrated(60.0, table) == 80.0
    assert rb.calibrated(120.0, table) == 160.0                    # above the last bin the ratio is kept


def test_chunks_tile_the_ring():
    assert rb.chunk_of(RING[0], RING[2]) == (0, 0)
    assert rb.chunk_of(0.0, 0.0) == (2, 2)
    assert rb.chunk_of(RING[1], 0.0) is None
    assert rb.chunk_extent(3, 0) == [5000.0, 10000.0, -10000.0, -5000.0]


def test_committed_bake_matches_its_manifest_and_the_size_rules():
    m = json.loads((V2 / "manifest.json").read_text(encoding="utf-8"))
    assert len(m["chunks"]) == 16
    n = 0
    for c in m["chunks"]:
        for key in ("buildings", "ground", "ao", "mask"):
            assert (V2 / c[key]).exists(), c[key]
        b = json.loads((V2 / c["buildings"]).read_text(encoding="utf-8"))
        assert len(b["buildings"]) == len(b["roof"]) == len(b["cls"]) == len(b["src"]) == c["n"]
        n += c["n"]
    counts = m["counts"]
    assert n == counts["buildings"] == sum(counts["by_height_source"].values()) == sum(counts["by_class"].values())
    assert counts["estimated"] == counts["by_height_source"]["estimated"]          # estimates stay counted and labelled
    assert set(counts["by_height_source"]) == set(rb.SOURCES)
    for p in m["provenance"]:
        assert all(p[k] for k in ("dataset", "source", "licence", "date", "count")), p
    assert any("ESTIMATED" in p["dataset"] for p in m["provenance"])
    # common rules: no file over 15 MB in apps/web/public, public/geo at most 60 MB
    files = [f for f in (ROOT / "apps/web/public").rglob("*") if f.is_file()]
    assert max(f.stat().st_size for f in files) <= 15e6
    assert sum(f.stat().st_size for f in GEO.rglob("*") if f.is_file()) <= 60e6


def test_landmark_heights_have_a_source_each():
    import yaml
    towers = yaml.safe_load((ROOT / "config/landmark_heights.yaml").read_text(encoding="utf-8"))["towers"]
    assert len(towers) >= 50
    assert all(t["height_m"] > 100 and t["source"].startswith("https://") for t in towers)
