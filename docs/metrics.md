# Metrics — exhibit UI (F1)

Every number below is copied from a file in `eval/results/` or from the baked scene; nothing is typed by hand.
Regenerate with `make ui-test` (API + web app must be able to start) and `python tasks.py scene`.

## 3D twin performance
Source: `eval/results/ui/fps.json` (2026-11-12T07:11:12.273Z), Playwright → Chrome, `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)`.

| Measure | Value |
|---|---|
| Viewport | 1920x1080 (3D canvas 1230×771, device pixel ratio 1) |
| Layers | all on, clock playing |
| Build | next dev |
| Average fps (5 camera presets × 5 s) | **59.8** |
| Minimum 1-second sample | 57.2 |
| Per camera | overview 59.9, close 59.1, top 60, fly 60, orbit 60 |

Budget: ≥ 50 fps → **met** on this machine. The browser caps at the display refresh rate (60 Hz), so 60 is "at the cap",
not the scene's ceiling. Not yet measured: the exhibit's touch monitor at its native resolution, a 2-hour soak.

## Offline
Source: `eval/results/ui/network.json` (2026-11-12T07:05:24.282Z).
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
`apps/web/tests/ui.spec.ts` — 11 Playwright tests (EN/AR, day/night, kiosk hit targets, demo flow, guided demo,
My plan, table + WebGL fallback, offline, API down, fps). Screenshots: `eval/results/ui/*.png`.
