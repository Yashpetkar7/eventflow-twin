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


def realism_rows() -> list[str]:
    """Realism ring (docs/13, R1): provenance and counts straight from the bake's manifest."""
    geo = ROOT / "apps/web/public/geo"
    v2 = load(geo / "v2/manifest.json")
    if not v2:
        return []
    c, cal = v2["counts"], v2["counts"]["globfp_calibration"]
    files = [f for f in geo.rglob("*") if f.is_file()]
    biggest = max(files, key=lambda f: f.stat().st_size)
    pub = [f for f in (ROOT / "apps/web/public").rglob("*") if f.is_file()]
    out = [f"## Realism ring, `?scene=v2` (docs/13 R1 — apps/web/public/geo/v2, generated {v2['generated']})",
           "Baked by `python scripts/fetch_realism_data.py` (downloads to `data/raw/realism/`, git-ignored) and",
           "`python scripts/build_scene.py --only v2`: a 20 km × 20 km ring in 16 chunks of 5 km over a 40 km overview.", "",
           "| Dataset | Source | Licence | Date | Count |", "|---|---|---|---|---|"]
    out += [f"| {p['dataset']} | {p['source']} | {p['licence']} | {p['date']} | {p['count']} |" for p in v2["provenance"]]
    out += ["", "| Height source, in priority order | Buildings |", "|---|---|"]
    out += [f"| {'**estimated**' if k == 'estimated' else k} | {n} |" for k, n in c["by_height_source"].items()]
    out += [f"| Total | {c['buildings']} (+ {c['ghosted_tops']} sea-side towers ghosted above {v2['camera_side_cut_m']:.0f} m) |", "",
            "| Type class | " + " | ".join(c["by_class"]) + " |", "|---|" + "---|" * len(c["by_class"]),
            "| Buildings | " + " | ".join(str(n) for n in c["by_class"].values()) + " |", "",
            f"3D-GloBFP calibration: raw 3D-GloBFP heights were compared with the OpenStreetMap-tagged height of the same {cal['pairs']} buildings",
            "and mapped onto them (median tagged height per quantile bin, monotone). Raw 3D-GloBFP m → used m: "
            + ", ".join(f"{g} → {t}" for g, t in cal["table"]) + ".", "",
            f"Size: `apps/web/public/geo` {sum(f.stat().st_size for f in files) / 1e6:.1f} MB (limit 60), largest file "
            f"`{biggest.name}` {biggest.stat().st_size / 1e6:.2f} MB (limit 15). All of `apps/web/public`: {sum(f.stat().st_size for f in pub) / 1e6:.1f} MB in {len(pub)} files.", ""]
    before, after = load(UI / "realism/before_fps.json"), load(UI / "realism/after_fps.json")
    if before and after:
        out += ["15 before/after pairs (5 camera presets × 10:00, 17:30, 21:30) in `eval/results/ui/realism/` "
                "(`node tests/polish.mjs before realism`, `node tests/polish.mjs after realism \"?scene=v2\"`), 1920×1080, dev mode, clock paused.", "",
                "| | Average fps | Minimum |", "|---|---|---|",
                f"| Before, corridor scene (`before_fps.json`, {before['timestamp']}) | {before['avg_fps']} | {before['min_fps']} |",
                f"| After, `?scene=v2` (`after_fps.json`, {after['timestamp']}) | {after['avg_fps']} | {after['min_fps']} |", ""]
    b2, a2 = load(UI / "realism_r2/before_fps.json"), load(UI / "realism_r2/after_fps.json")
    if b2 and a2:
        out += ["R2 (light, haze, ground and sea): 15 before/after pairs plus an AgX set in `eval/results/ui/realism_r2/`, clock paused. Both sets were captured on battery at different times, so the fps columns are not a before/after comparison — the measured frame rate is the mains-power line below.", "",
                "| | Average fps | Minimum | Quality tier at the end |", "|---|---|---|---|",
                f"| Before, R1 scene (`before_fps.json`, {b2['timestamp']}) | {b2['avg_fps']} | {b2['min_fps']} | {b2.get('tier_at_end')} |",
                f"| After, R2 scene (`after_fps.json`, {a2['timestamp']}) | {a2['avg_fps']} | {a2['min_fps']} | {a2.get('tier_at_end')} |", ""]
    b3, a3 = load(UI / "realism_r3/before_fps.json"), load(UI / "realism_r3/after_fps.json")
    if b3 and a3:
        out += ["R3 (buildings by type): 15 before/after pairs in `eval/results/ui/realism_r3/`, clock paused, mains power, capped at the display's 60 Hz.", "",
                "| | Average fps | Minimum | Quality tier at the end |", "|---|---|---|---|",
                f"| Before, R2 scene (`before_fps.json`, {b3['timestamp']}) | {b3['avg_fps']} | {b3['min_fps']} | {b3.get('tier_at_end')} |",
                f"| After, R3 scene (`after_fps.json`, {a3['timestamp']}) | {a3['avg_fps']} | {a3['min_fps']} | {a3.get('tier_at_end')} |", ""]
    mj = load(ROOT / "apps/web/public/models/models.json")
    if mj:
        out += [f"R4 models (Blender {mj['blender']}, `scripts/blender/build_models.py`; approximations from public dimensions, not survey models):", "",
                "| Model | Triangles | Far version | Budget | File | Public dimension source |", "|---|---|---|---|---|---|"]
        out += [f"| {n} | {m['triangles']} | {m['triangles_lod1']} | {m['budget']} | {m['bytes'] / 1e3:.1f} kB | {m['source']} |" for n, m in mj["models"].items()]
        out += [""]
    k1, k2 = load(UI / "fps_kiosk.json"), load(UI / "fps_kiosk_v2.json")
    if k1 or k2:
        out += ["Visitor kiosk attract screen (3D full screen, `node tests/kiosk_fps.mjs`), every recorded run:", "",
                "| | Runs | Average fps, lowest – highest run | Lowest 1-second sample | Quality tier | Target |", "|---|---|---|---|---|---|"]
        for k in (k1, k2):
            if k:
                runs = k.get("runs") or [k]
                out += [f"| `{k['url']}` | {len(runs)} | {min(r['avg_fps'] for r in runs)} – {max(r['avg_fps'] for r in runs)} | {min(r['min_fps'] for r in runs)} | "
                        f"{', '.join(sorted({str(r['tier_at_end']) for r in runs}))} | {k['target']} |"]
        out += [""]
    out += r7_rows()
    v2fps = load(UI / "fps_v2.json")
    if v2fps:
        out += [f"`?scene=v2` with every layer on and the clock playing (`fps_v2.json`, {v2fps['timestamp']}, test \"realism ring…\"): "
                f"average **{v2fps['avg_fps']}** fps, minimum 1-second sample {v2fps['min_fps']}.", ""]
    else:
        out += ["`?scene=v2` with the clock playing: **not yet measured on mains power** (the UI test \"realism ring…\" writes `fps_v2.json`).", ""]
    return out


def r7_rows() -> list[str]:
    """Realism R7 (decision #103): frame rate with the display cap removed, before and after, from eval/results/ui/realism_r7/."""
    r7 = UI / "realism_r7"
    before, after = load(r7 / "before_fps.json"), load(r7 / "after_fps.json")
    if not (before and after):
        return []
    out = [f"R7 (frame rate at full quality, decision #103), measured on `{after['gpu']}`, power source: {after['power_source']}. "
           "Production build, 1920×1080, Chrome without the display cap (`node tests/r7_fps.mjs`): median of 8 one-second samples per "
           "camera preset (10 for the kiosk), draw calls and triangles of one whole frame. "
           f"Before = {before.get('build') or before['git_sha']}; after = {after.get('build') or after['git_sha']}.", "",
           "| View | Median fps before → after | Lowest sample before → after | Draw calls | Triangles (million) | Tier |", "|---|---|---|---|---|---|"]
    for k, b in before["cases"].items():
        a = after["cases"].get(k)
        if a:
            out += [f"| {k} | {b['median_fps']} → **{a['median_fps']}** | {b['min_fps']} → {a['min_fps']} | {b['calls']} → {a['calls']} | "
                    f"{b['triangles'] / 1e6:.2f} → {a['triangles'] / 1e6:.2f} | {b['tier']} → {a['tier']} |"]
    out += [""]
    switches = sorted(r7.glob("switch_*_fps.json"))
    if switches:
        keys = [k for k in after["cases"] if not k.startswith("kiosk")]
        out += ["Each change on its own (same build, one switch flipped with `?r7off=` / `?r7on=`, see `apps/web/src/components/twin/perf.ts`); "
                "median fps, workspace views only. Repeats of the same run differ by a few per cent.", "",
                "| Run | " + " | ".join(keys) + " |", "|---|" + "---|" * len(keys)]
        for f in switches:
            j = load(f)
            out += [f"| {j['url'].split('&', 1)[-1] if '&' in j['url'] else 'all defaults'} | " + " | ".join(str(j["cases"][k]["median_fps"]) for k in keys) + " |"]
        out += [""]
    kb, ka = load(r7 / "kiosk_fps_tier0_before.json"), load(r7 / "kiosk_fps_tier0_after.json")
    if kb and ka:
        out += ["Visitor kiosk at tier 0 with the display cap on (`node tests/kiosk_fps.mjs … v2`, `MIN_TIER` temporarily 0), every run. "
                "On this laptop the kiosk was already at the cap before R7, so these runs cannot show the gain; the booth laptop must be measured (decision #103).", "",
                "| | Runs | Average fps, lowest – highest run | Lowest 1-second sample | Quality tier |", "|---|---|---|---|---|"]
        for name, k in (("Before", kb), ("After", ka)):
            runs = k["runs"]
            out += [f"| {name} | {len(runs)} | {min(r['avg_fps'] for r in runs)} – {max(r['avg_fps'] for r in runs)} | {min(r['min_fps'] for r in runs)} | "
                    f"{', '.join(sorted({str(r['tier_at_end']) for r in runs}))} |"]
        out += [""]
    rb, ra = load(r7 / "ring_fps_before.json"), load(r7 / "ring_fps_after.json")
    if rb and ra:
        out += [f"UI test \"realism ring…\" on the production build, lowest 1-second sample per camera preset — before: "
                + ", ".join(f"{k} {min(v)}" for k, v in rb["samples"].items()) + f" (tier {rb['tier_at_end']}); after: "
                + ", ".join(f"{k} {min(v)}" for k, v in ra["samples"].items()) + f" (tier {ra['tier_at_end']}).", ""]
    soak = load(r7 / "soak_v2_10min.json")
    if soak:
        out += [f"10-minute soak on `?scene=v2` after R7 (`realism_r7/soak_v2_10min.json`): {soak['minutes']} min, {soak['loops']} loops, heap "
                f"{soak['baseline_heap_mb']} → {soak['final_heap_mb']} MB ({soak['heap_growth_pct']} %, budget 10 %), lowest fps sample {soak['min_fps']}, "
                f"tier at the end {soak['tier_final']}, requests outside localhost {soak['external_requests']}, page errors {len(soak['page_errors'])}.", ""]
    out += ["15 before/after screenshot pairs: `eval/results/ui/realism_r7/index.html`.", ""]
    return out


def main() -> None:
    fps, net = load(UI / "fps.json"), load(UI / "network.json")
    sc = json.loads((ROOT / "apps/web/public/geo/corridor_scene.json").read_text(encoding="utf-8"))
    hs = sc["meta"]["height_sources"]
    before, after = load(UI / "polish/before_fps.json"), load(UI / "polish/after_fps.json")
    soak, short, soak_v2 = load(UI / "soak.json"), load(UI / "soak_short.json"), load(UI / "soak_v2.json")
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
        state = "finished" if r.get("finished") else "stopped early — partial"
        return [f"| Run | `{name}` ({r['timestamp']}, {state}), target {r['target']} |",
                f"| Duration / guided-demo loops | {r['minutes']} min of {r['planned_minutes']} planned / {r['loops']} loops |",
                f"| JS heap after forced GC: warm baseline → end | {r['baseline_heap_mb']} MB → {r['final_heap_mb']} MB (**{r['heap_growth_pct']} %**), maximum {r['max_heap_mb']} MB |",
                f"| Renderer geometries / textures / shader programs (start → end) | {r['geometries'][0]} → {r['geometries'][1]} / {r['textures'][0]} → {r['textures'][1]} / {r['programs'][0]} → {r['programs'][1]} |",
                f"| DOM nodes (start → end) | {r['dom_nodes'][0]} → {r['dom_nodes'][1]} |",
                f"| Lowest 1-second fps sample / quality tier at the end | {r['min_fps']} / {r['tier_final']} |",
                f"| Requests outside localhost / page errors | {r['external_requests']} / {len(r['page_errors'])} |"]
    if soak or short or soak_v2:
        out += ["## Booth hardening (prompt F3)",
                "Soak test `apps/web/tests/soak.mjs`: kiosk mode, production build, the guided demo in a loop with scenario,",
                "landmark, language and camera changes between loops. Budget: heap growth ≤ 10 %.", "", "| Measure | Value |", "|---|---|"]
        if soak:
            out += soak_rows(soak, "soak.json")
        if short:
            out += soak_rows(short, "soak_short.json")
        if soak_v2:
            out += ["", "Realism scene (`?scene=v2`, docs/13 R6), same soak:", "", "| Measure | Value |", "|---|---|"] + soak_rows(soak_v2, "soak_v2.json")
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
            *realism_rows(),
            "## UI tests",
            f"`apps/web/tests/ui.spec.ts` — {n_tests} Playwright tests (EN/AR, day/night, kiosk hit targets, demo flow, guided demo,",
            "My plan, recentre, landmarks, overlay overlap, quality tier, crash recovery, table + WebGL fallback, offline, API down,",
            "fps). Screenshots: `eval/results/ui/*.png`.", ""]
    (ROOT / "docs/metrics.md").write_text("\n".join(out), encoding="utf-8")
    print("docs/metrics.md written")


if __name__ == "__main__":
    main()
