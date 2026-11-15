"""Blender-built models of the realism scene (docs/13, R4): every model and its 25 % version is committed, inside its
triangle budget, and small; the Draco decoder the web app needs is served from the repo (offline rule)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "apps/web/public/models"
SITES = [f"tower_{i:02d}" for i in range(1, 11)] + ["dubai_mall", "difc_gate", "dubai_fountain"]
BUDGET = {"burj_khalifa": 60000, "metro_station": 15000, "metro_car": 8000, "palm_a": 1500, "palm_b": 1500, "palm_c": 1500, "car": 1500, "bus": 1500}     # everything else: 25,000


def test_models_are_committed_and_within_budget():
    report = json.loads((MODELS / "models.json").read_text(encoding="utf-8"))["models"]
    assert set(report) == {"burj_khalifa", "emirates_office_tower", "emirates_hotel_tower", "museum_of_the_future", "trade_centre_tower",
                           "dubai_frame", "metro_station", "viaduct_segment", "metro_car", "palm_a", "palm_b", "palm_c", "car", "bus",
                           *SITES}
    for name, m in report.items():
        for suffix, key in (("", "bytes"), ("_lod1", "bytes_lod1")):
            f = MODELS / f"{name}{suffix}.glb"
            assert f.exists() and f.stat().st_size == m[key], f.name
            assert f.read_bytes()[:4] == b"glTF"
        assert m["triangles"] <= BUDGET.get(name, 25000), name
        assert m["triangles_lod1"] <= 0.3 * m["triangles"] or m["triangles"] < 100, name   # the far version is about a quarter (a 50-triangle box cannot lose 75 %)
        # where the public dimensions come from; the car and bus are generic shapes with no real model behind them
        # (R8b sites: their row in config/landmark_heights.yaml, a published table or the map's own height tag)
        assert m["source"].startswith(("https://", "OpenStreetMap")) or (name in ("car", "bus") and m["source"].startswith("generic"))
    assert report["burj_khalifa"]["height_m"] == 828 and abs(report["burj_khalifa"]["size_m"][2] - 828) < 1
    assert sum(f.stat().st_size for f in MODELS.iterdir()) < 2e6


def test_r8b_sites_have_a_height_source_and_a_skip():
    import yaml
    y = yaml.safe_load((ROOT / "config/landmark_heights.yaml").read_text(encoding="utf-8"))
    rows = {n: t for t in y["towers"] + y["sites"] for n in [t["name"], *t.get("aliases", [])]}
    report = json.loads((MODELS / "models.json").read_text(encoding="utf-8"))["models"]
    sites = json.loads((MODELS / "sites.json").read_text(encoding="utf-8"))
    assert sites["models"] == SITES and len(sites["skip"]) % 3 == 0 and len(sites["skip"]) >= 3 * 12
    for name in SITES:
        row = rows[report[name]["name"]]                                            # every site has its yaml row
        assert report[name]["source"] == row["source"]
        assert row.get("height_m", row.get("length_m")) == report[name].get("height_m", report[name].get("length_m"))
    web = (ROOT / "apps/web/src/components/twin/models.tsx").read_text(encoding="utf-8")
    assert all(f'"{n}"' in web for n in SITES)                                     # and is drawn by the scene


def test_draco_decoder_is_local():
    for f in ("draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"):
        assert (ROOT / "apps/web/public/draco" / f).stat().st_size > 10_000
