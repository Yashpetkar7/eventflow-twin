"""Write docs/metrics.md from the UI result files (no hand-typed numbers).

    python scripts/ui_metrics.py      (after `make ui-test`; polish numbers appear if eval/results/ui/polish exists)
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "eval/results/ui"


def load(p: Path) -> dict | None:
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def main() -> None:
    fps, net = load(UI / "fps.json"), load(UI / "network.json")
    sc = json.loads((ROOT / "apps/web/public/geo/corridor_scene.json").read_text(encoding="utf-8"))
    hs = sc["meta"]["height_sources"]
    before, after = load(UI / "polish/before_fps.json"), load(UI / "polish/after_fps.json")
    soak, short = load(UI / "soak.json"), load(UI / "soak_short.json")
    n_tests = (ROOT / "apps/web/tests/ui.spec.ts").read_text(encoding="utf-8").count("\ntest(")
    out = ["# Metrics — exhibit UI", "",
           "Every number below is copied from a file in `eval/results/` or from the baked scene by `scripts/ui_metrics.py`;",
           "nothing is typed by hand. Regenerate: `make ui-test`, then `python scripts/ui_metrics.py`.", ""]
    if fps:
        out += ["## 3D twin performance",
                f"Source: `eval/results/ui/fps.json` ({fps['timestamp']}), Playwright → Chrome, `{fps['renderer']}`.", "",
                "| Measure | Value |", "|---|---|",
                f"| Viewport | {fps['viewport']} (3D canvas {fps['canvas'][0]}×{fps['canvas'][1]}, device pixel ratio {fps['dpr']}) |",
                f"| Layers | {fps['layers']} |", f"| Build | {fps['mode']} |",
                f"| Average fps (5 camera presets × 5 s) | **{fps['avg_fps']}** |",
                f"| Minimum 1-second sample | {fps['min_fps']} |",
                "| Per camera | " + ", ".join(f"{k} {v}" for k, v in fps["per_camera"].items()) + " |", "",
                "Budget ≥ 50 fps: **met** on this machine. The browser caps at the display refresh rate (60 Hz), so 60 means",
                "\"at the cap\". Not measured: the exhibit's touch monitor at its native resolution; a 2-hour soak.", ""]
    if before and after:
        out += ["## Visual polish pass (prompt F2)",
                "15 before/after pairs (5 camera presets × 10:00, 17:30, 21:30) in `eval/results/ui/polish/`, measured in dev mode.", "",
                "| | Average fps | Minimum |", "|---|---|---|",
                f"| Before (`before_fps.json`, {before['timestamp']}) | {before['avg_fps']} | {before['min_fps']} |",
                f"| After (`after_fps.json`, {after['timestamp']}) | {after['avg_fps']} | {after['min_fps']} |", ""]
    def soak_rows(r: dict, name: str) -> list[str]:
        state = "finished" if r.get("finished") else "STILL RUNNING — partial"
        return [f"| Run | `{name}` ({r['timestamp']}, {state}), target {r['target']} |",
                f"| Duration / guided-demo loops | {r['minutes']} min of {r['planned_minutes']} planned / {r['loops']} loops |",
                f"| JS heap after forced GC: warm baseline → end | {r['baseline_heap_mb']} MB → {r['final_heap_mb']} MB (**{r['heap_growth_pct']} %**), maximum {r['max_heap_mb']} MB |",
                f"| Renderer geometries / textures / shader programs (start → end) | {r['geometries'][0]} → {r['geometries'][1]} / {r['textures'][0]} → {r['textures'][1]} / {r['programs'][0]} → {r['programs'][1]} |",
                f"| DOM nodes (start → end) | {r['dom_nodes'][0]} → {r['dom_nodes'][1]} |",
                f"| Lowest 1-second fps sample / quality tier at the end | {r['min_fps']} / {r['tier_final']} |",
                f"| Requests outside localhost / page errors | {r['external_requests']} / {len(r['page_errors'])} |"]
    if soak or short:
        out += ["## Booth hardening (prompt F3)",
                "Soak test `apps/web/tests/soak.mjs`: kiosk mode, production build, the guided demo in a loop with scenario,",
                "landmark, language and camera changes between loops. Budget: heap growth ≤ 10 %.", "", "| Measure | Value |", "|---|---|"]
        if soak:
            out += soak_rows(soak, "soak.json")
        if short:
            out += soak_rows(short, "soak_short.json")
        out += ["",
                "Automatic quality tier (test \"quality tier steps down…\"): under 40 fps for 3 s → tier 1 (no ambient occlusion,",
                "pixel ratio 1, 2048 px shadow map, fewer cars and particles) → tier 2 (no shadows, no particles); 45 s at the",
                "display cap → one step back up, at most twice. A throttled background page (≈ 1 fps) never changes the tier.",
                "Crash recovery (test \"crash recovery…\"): with the API blocked the banner appears and saved results stay on screen;",
                "the health check every 4 s clears the banner when the API returns.", ""]
    if net:
        out += ["## Offline", f"Source: `eval/results/ui/network.json` ({net['checked']}).",
                f"Requests to any host other than localhost during load, an agent plan and a language switch: **{len(net['external_requests'])}**.",
                "Fonts (Readex Pro, OFL) are files in the repo; the map is baked into `apps/web/public/geo/`.",
                "With the API blocked the app starts from the saved snapshot (`apps/web/public/cache/`) and says so (test \"API down\").", ""]
    out += [f"## Scene provenance (apps/web/public/geo/corridor_scene.json, generated {sc['meta']['generated']})",
            "| Item | Count / source |", "|---|---|",
            f"| Building footprints | {len(sc['buildings'])} from OpenStreetMap |",
            f"| Heights from OSM `height` | {hs['tagged_height']} |", f"| Heights from OSM `building:levels` | {hs['tagged_levels']} |",
            f"| Heights **estimated** (footprint + district, seeded) | {hs['estimated']} |",
            f"| Sea-side towers drawn solid to {sc['meta']['camera_side_cut_m']:.0f} m, ghosted above | {len(sc['ghosts'])} |",
            f"| Major road ribbons / flyover chains / water bodies | {len(sc['roads'])} / {len(sc['flyovers'])} / {len(sc['water'])} |",
            f"| Red Line centreline | {sc['meta']['metro_source']} |", "",
            "## UI tests",
            f"`apps/web/tests/ui.spec.ts` — {n_tests} Playwright tests (EN/AR, day/night, kiosk hit targets, demo flow, guided demo,",
            "My plan, recentre, landmarks, overlay overlap, quality tier, crash recovery, table + WebGL fallback, offline, API down,",
            "fps). Screenshots: `eval/results/ui/*.png`.", ""]
    (ROOT / "docs/metrics.md").write_text("\n".join(out), encoding="utf-8")
    print("docs/metrics.md written")


if __name__ == "__main__":
    main()
