# Metrics — exhibit UI

Every number below is copied from a file in `eval/results/` or from the baked scene by `scripts/ui_metrics.py`;
nothing is typed by hand. Regenerate: `make ui-test`, then `python scripts/ui_metrics.py`.

## 3D twin performance
Source: `eval/results/ui/fps.json` (2026-11-12T15:15:09.560Z), Playwright → Chrome, `ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)`.

| Measure | Value |
|---|---|
| Viewport | 1920x1080 (3D canvas 1230×771, device pixel ratio 1) |
| Layers | all on, clock playing |
| Build | next dev |
| Average fps (5 camera presets × 5 s) | **60** |
| Minimum 1-second sample | 59.9 |
| Per camera | overview 60, close 60, top 60, fly 60, orbit 60 |

Budget ≥ 50 fps: **met** on this machine. The browser caps at the display refresh rate (60 Hz), so 60 means
"at the cap". Not measured: the exhibit's touch monitor at its native resolution; a 2-hour soak.

## Visual polish pass (prompt F2)
15 before/after pairs (5 camera presets × 10:00, 17:30, 21:30) in `eval/results/ui/polish/`, measured in dev mode.

| | Average fps | Minimum |
|---|---|---|
| Before (`before_fps.json`, 2026-11-12T07:15:41.333Z) | 60 | 60 |
| After (`after_fps.json`, 2026-11-12T07:38:46.372Z) | 60 | 60 |

## Booth hardening (prompt F3)
Soak test `apps/web/tests/soak.mjs`: kiosk mode, production build, the guided demo in a loop with scenario,
landmark, language and camera changes between loops. Budget: heap growth ≤ 10 %.

| Measure | Value |
|---|---|
| Run | `soak.json` (2026-11-12T08:24:36.563Z, stopped early — partial), target http://localhost:3100 |
| Duration / guided-demo loops | 18.54 min of 120 planned / 37 loops |
| JS heap after forced GC: warm baseline → end | 41.71 MB → 41.86 MB (**0.4 %**), maximum 42.02 MB |
| Renderer geometries / textures / shader programs (start → end) | 53 → 53 / 30 → 30 / 45 → 46 |
| DOM nodes (start → end) | 396 → 396 |
| Lowest 1-second fps sample / quality tier at the end | 59.9 / 0 |
| Requests outside localhost / page errors | 0 / 0 |
| Run | `soak_short.json` (2026-11-12T08:05:44.330Z, finished), target http://localhost:3100 |
| Duration / guided-demo loops | 6.02 min of 6 planned / 12 loops |
| JS heap after forced GC: warm baseline → end | 41.67 MB → 41.53 MB (**-0.3 %**), maximum 42.01 MB |
| Renderer geometries / textures / shader programs (start → end) | 53 → 53 / 30 → 30 / 45 → 46 |
| DOM nodes (start → end) | 396 → 398 |
| Lowest 1-second fps sample / quality tier at the end | 59.9 / 0 |
| Requests outside localhost / page errors | 0 / 0 |

Automatic quality tier (test "quality tier steps down…"): under 40 fps for 3 s → tier 1 (no ambient occlusion,
pixel ratio 1, 2048 px shadow map, fewer cars and particles) → tier 2 (no shadows, no particles); 45 s at the
display cap → one step back up, at most twice. A throttled background page (≈ 1 fps) never changes the tier.
Crash recovery (test "crash recovery…"): with the API blocked the banner appears and saved results stay on screen;
the health check every 4 s clears the banner when the API returns.

## Offline
Source: `eval/results/ui/network.json` (2026-11-12T15:13:40.233Z).
Requests to any host other than localhost during load, an agent plan and a language switch: **0**.
Fonts (Readex Pro, OFL) are files in the repo; the map is baked into `apps/web/public/geo/`.
With the API blocked the app starts from the saved snapshot (`apps/web/public/cache/`) and says so (test "API down").

## Scene provenance (apps/web/public/geo/corridor_scene.json, generated 2026-11-12)
| Item | Count / source |
|---|---|
| Building footprints | 11196 from OpenStreetMap |
| Heights from OSM `height` | 1175 |
| Heights from OSM `building:levels` | 297 |
| Heights **estimated** (footprint + district, seeded) | 9724 |
| Sea-side towers drawn solid to 42 m, ghosted above | 136 |
| Major road ribbons / flyover chains / water bodies | 1697 / 54 / 19 |
| Red Line centreline | OpenStreetMap railway=subway (Red Line Metro) |

## Realism ring, `?scene=v2` (docs/13 R1 — apps/web/public/geo/v2, generated 2026-11-12)
Baked by `python scripts/fetch_realism_data.py` (downloads to `data/raw/realism/`, git-ignored) and
`python scripts/build_scene.py --only v2`: a 20 km × 20 km ring in 16 chunks of 5 km over a 40 km overview.

| Dataset | Source | Licence | Date | Count |
|---|---|---|---|---|
| Building footprints, classes, tagged heights | Overture Maps Foundation, buildings theme, release 2026-10-21.0 (includes OpenStreetMap) | ODbL 1.0 (© OpenStreetMap contributors, Overture Maps Foundation) | 2026-10-21 | 73193 buildings in the 20 km ring |
| Building heights where untagged (calibrated) | 3D-GloBFP (Che et al. 2024, ESSD 16, 5357–5374), Zenodo 15487006; mapped onto OpenStreetMap-tagged heights of 9143 buildings that have both | CC BY 4.0 | 2024 | 46052 buildings |
| Named tower heights | config/landmark_heights.yaml (source URL per tower) | Facts; Wikipedia text CC BY-SA 4.0 | 2026-11-12 | 0 buildings |
| Building heights, ESTIMATED | Seeded estimate from footprint area and type (scripts/build_scene.py) | n/a (not data) | 2026-11-12 | 23179 buildings (31.7 %) |
| Ground image | Copernicus Sentinel-2 L2A, median of 8 near-cloudless dates 2025-10-14 – 2025-11-28, via Microsoft Planetary Computer; colour-graded | Contains modified Copernicus Sentinel data 2025 (free and open) | 2025-10-13/2025-11-30 | 45 scenes, 10 m |
| Land-cover masks (vegetation, water, built-up, bare) | ESA WorldCover 10 m 2021 v200 | CC BY 4.0 (© ESA WorldCover project 2021) | 2021 | 16 chunk masks + 1 overview |
| Water outline | Overture Maps Foundation, base theme (water), release 2026-10-21.0 | ODbL 1.0 | 2026-10-21 | 2899 polygons |
| Terrain height | Copernicus DEM GLO-30 (AWS Open Data), resampled to 78 m | © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA; free licence | 2011–2015 | 1 texture, -16–82 m |
| Ground ambient occlusion | Baked from the footprints and heights above (scripts/realism_bake.py) | derived | 2026-11-12 | 16 chunk textures + corridor |

| Height source, in priority order | Buildings |
|---|---|
| osm_height | 2095 |
| osm_levels | 1867 |
| overture_height | 0 |
| overture_floors | 0 |
| globfp_calibrated | 46052 |
| landmark_list | 0 |
| **estimated** | 23179 |
| Total | 73193 (+ 113 sea-side towers ghosted above 42 m) |

| Type class | tower | midrise | villa | lowrise | industrial | mosque | stadium |
|---|---|---|---|---|---|---|---|
| Buildings | 853 | 6757 | 56474 | 8637 | 236 | 227 | 9 |

3D-GloBFP calibration: raw 3D-GloBFP heights were compared with the OpenStreetMap-tagged height of the same 9143 buildings
and mapped onto them (median tagged height per quantile bin, monotone). Raw 3D-GloBFP m → used m: 8.7 → 6.6, 12.4 → 6.6, 15.0 → 6.6, 17.3 → 6.6, 19.8 → 6.6, 22.5 → 6.6, 24.8 → 6.6, 27.4 → 6.6, 30.9 → 8.6, 36.0 → 25.0, 44.8 → 36.3, 64.6 → 55.0.

Size: `apps/web/public/geo` 15.0 MB (limit 60), largest file `ground.png` 3.13 MB (limit 15).

15 before/after pairs (5 camera presets × 10:00, 17:30, 21:30) in `eval/results/ui/realism/` (`node tests/polish.mjs before realism`, `node tests/polish.mjs after realism "?scene=v2"`), 1920×1080, dev mode, clock paused.

| | Average fps | Minimum |
|---|---|---|
| Before, corridor scene (`before_fps.json`, 2026-11-12T15:03:53.507Z) | 60 | 60 |
| After, `?scene=v2` (`after_fps.json`, 2026-11-12T15:05:22.412Z) | 60 | 60 |

`?scene=v2` with every layer on and the clock playing (`fps_v2.json`, 2026-11-12T15:14:27.218Z, test "realism ring…"): average **60** fps, minimum 1-second sample 59.9.

## UI tests
`apps/web/tests/ui.spec.ts` — 21 Playwright tests (EN/AR, day/night, kiosk hit targets, demo flow, guided demo,
My plan, recentre, landmarks, overlay overlap, quality tier, crash recovery, table + WebGL fallback, offline, API down,
fps). Screenshots: `eval/results/ui/*.png`.
