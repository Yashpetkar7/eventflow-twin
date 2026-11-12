# Metrics — exhibit UI

Every number below is copied from a file in `eval/results/` or from the baked scene by `scripts/ui_metrics.py`;
nothing is typed by hand. Regenerate: `make ui-test`, then `python scripts/ui_metrics.py`.

## 3D twin performance
Source: `eval/results/ui/fps.json` (2026-11-12T12:47:10.735Z), Playwright → Chrome, `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)`.

| Measure | Value |
|---|---|
| Viewport | 1920x1080 (3D canvas 1230×771, device pixel ratio 1) |
| Layers | all on, clock playing |
| Build | next dev |
| Average fps (5 camera presets × 5 s) | **60** |
| Minimum 1-second sample | 59 |
| Per camera | overview 60, close 59.8, top 60, fly 60, orbit 60 |

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
Source: `eval/results/ui/network.json` (2026-11-12T12:46:28.170Z).
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

## UI tests
`apps/web/tests/ui.spec.ts` — 18 Playwright tests (EN/AR, day/night, kiosk hit targets, demo flow, guided demo,
My plan, recentre, landmarks, overlay overlap, quality tier, crash recovery, table + WebGL fallback, offline, API down,
fps). Screenshots: `eval/results/ui/*.png`.
