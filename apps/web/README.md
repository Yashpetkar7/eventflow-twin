# apps/web — EventFlow Twin exhibit UI (Next.js 16 + react-three-fiber)

One workspace, built to `reference/eventflow-twin-mockup.html` (layout, palette, copy, flows) with a higher-quality
3D twin on the **real** Sheikh Zayed Road corridor. Decisions: `docs/09_DECISIONS.md` #41–#53. Metrics: `docs/metrics.md`.

## Run
```bash
# repo root, terminal 1                      # terminal 2
python tasks.py api                           cd apps/web && npm install && npm run dev     # http://localhost:3000
```
One command for the booth (offline cache → API → production build → kiosk URL): `python tasks.py demo`.

| URL | What |
|---|---|
| `/` | Workspace |
| `/?lang=ar` | Arabic, full right-to-left (the 3D scene is not mirrored) |
| Recentre (target button on the right edge, red once the view has moved) / `Home` | Back to the last chosen camera view |
| Landmarks menu, or tap a landmark label | Flies to the landmark and frames it with its area; selects the station that serves it |
| Zoom + / − and Full-width map (right edge; `Esc` to leave) | Touch-friendly zoom; folds the side panels away so the twin fills the screen |
| `/?kiosk=1` | Touch kiosk: targets ≥ 48 px, no selection / context menu, 60 s idle → guided demo (`&idle=10` for rehearsals) |

`NEXT_PUBLIC_API_URL` overrides the API address (default `http://localhost:8000`).

## The 3D scene is baked, not fetched
```bash
python tasks.py osm      # once, needs internet: OpenStreetMap → data/raw/osm (git-ignored)
python tasks.py scene    # → public/geo/corridor_scene.json + ground.png (committed; the exhibit never goes online)
```
**Realism ring (`/?scene=v2`, docs/13 R1 — off by default until R6):**
```bash
pip install -r requirements-realism.txt
python tasks.py realism-data                 # once, needs internet: Overture, Sentinel-2, WorldCover, DEM, 3D-GloBFP → data/raw/realism
python scripts/build_scene.py --only v2      # → public/geo/v2/ (manifest + 16 chunks; committed)
```
`twin/Ring.tsx` streams the chunks (satellite ground × baked AO, Overture buildings with satellite-sampled roofs) over a
40 km overview; the credits link under the 3D view lists every dataset from the manifest. Counts: `docs/metrics.md`.

Real metres, rotated so Max → Business Bay runs left → right with the camera on the sea side (`scripts/scene_frame.py`).
Stations are placed from `GET /stations` lat/lon, snapped onto the OSM Red Line track.

## Structure
| File | Role |
|---|---|
| `src/lib/api-types.ts` | **Generated** from the contract (`python tasks.py contract`). Never edit by hand. |
| `src/lib/api.ts`, `requests.ts` | Typed client; request builders shared with `scripts/snapshot.mjs`; API-down fallback (memory, localStorage, `public/cache/`) |
| `src/lib/store.ts` | All state (zustand): scenario → `/forecast` → `/simulate` (no plans / approved plans) → `/agent/plan` → `/decisions`. The only arithmetic is interpolation between 15-minute bins |
| `src/lib/tour.ts` | Guided demo, kiosk idle timer, API reconnect |
| `src/lib/i18n.tsx`, `src/messages/{en,ar}.json` | next-intl (client state, no locale routes). **Arabic is a draft for native-speaker review.** Numbers sit in `<bdi>` |
| `src/components/{Header,Rail,Stage,Panel,PlanTabs,ReportTab}.tsx` | The 2D workspace |
| `src/components/twin/TwinCanvas.tsx` | Canvas (lazy chunk behind `public/poster.jpg`), N8AO + SMAA + ACES, automatic quality tier |
| `…/twin/City.tsx` | Ground map, water, extruded buildings with a procedural façade (lit windows at night), roads, lane-marked SZR, flyovers, palms |
| `…/twin/Metro.tsx` | Viaduct + piers, six stations (oyster-shell roofs, glass footbridges), instanced trains paced by `trains_per_hour` |
| `…/twin/Landmarks.tsx` | Burj Khalifa, Emirates Towers, Museum of the Future, DWTC tower, Dubai Frame at their OSM positions |
| `…/twin/Live.tsx` | Crowd columns (capacity glass, threshold ring, demand bar, pulse), venue beacon, crowd particles, illustrative traffic |
| `…/twin/Sky.tsx`, `CameraRig.tsx`, `Labels.tsx` | Time of day (sun path, golden hour, night), camera presets + touch controls, HTML labels |
| `tests/ui.spec.ts` | Playwright: screenshots → `eval/results/ui/`, fps → `eval/results/ui/fps.json` (`make ui-test`) |
| `tests/soak.mjs` | Booth soak: guided demo in a loop for N minutes, heap / GPU-object / fps / network log → `eval/results/ui/soak.json` |
| `tests/polish.mjs` | Before/after captures for a visual pass: `node tests/polish.mjs before|after` → `eval/results/ui/polish/` |

## Rules
- Offline: no remote tiles, fonts or scripts. Map © OpenStreetMap contributors (shown on the canvas and in the footer).
- Every number comes from an API response with a `source` run id. SYNTHETIC badge whenever `is_synthetic`.
- Colour is never the only cue: ▲ markers, threshold rings, white bars in over-threshold heat cells.
- No RTA logo; "designed for / aligned with" only.

## Known limits (honest list)
- The planner is deterministic with template explanations; no live LLM path yet (the response says so).
- `?scene=v2`: 32 % of the ring's building heights are still estimated; 3D-GloBFP heights are calibrated against OSM tags (decision #77); the
  ground is 10 m satellite data, soft in close-ups and dark at night until R2; façades are still the simple window grid (R3).
- Building heights are estimated where OSM has no tag; sea-side towers are cut to podium height so stations stay visible.
- Road traffic and crowd particles are illustrative. Interchanges are flat except simple flyover ramps.
- Dark theme of the mockup is not implemented. Not yet tested on the real touch monitor; no 2-hour soak test.
- Sun timing is stylised (golden hour 16:30–18:30) rather than the real mid-November sunset.
- Landmarks are stylised low-poly models, not surveyed geometry. Hand-modelled glTF assets (e.g. via Blender) could replace
  two or three of them later without touching the rest of the scene.
