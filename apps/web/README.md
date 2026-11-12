# apps/web — EventFlow Twin UI (Next.js 16)

Spec: `docs/07_UI_SPEC.md`. Design tokens: `src/app/tokens.css` (accent #1D4ED8), mapped to Tailwind in `globals.css`.

## Run
```bash
# once (repo root): offline Dubai basemap (~32 MB, OpenStreetMap via Protomaps) + map fonts
python tasks.py basemap
# terminal 1 (repo root): the API
python tasks.py api                           # http://localhost:8000
# terminal 2
cd apps/web && npm install && npm run dev     # http://localhost:3000  (predev copies MapLibre's worker)
```
`NEXT_PUBLIC_API_URL` overrides the API address (default `http://localhost:8000`).

### URLs
| URL | What |
|---|---|
| `/?tab=overview` (default) | Network KPIs, day curve, busiest station-hours, load by line, scenario + assumptions |
| `/?tab=twin` | Live twin: real 3D Dubai map, all 53 metro stations, heat strip, station panel, planner |
| `/?tab=events` · `stations` · `planner` · `evidence` · `decisions` | One page per job (sidebar) |
| `?lang=ar` | Arabic, full right-to-left |
| `/?kiosk=1` | **Booth kiosk**: attract screen + autoplay → touch → 3-step tour → live twin; resets after 60 s idle (`&idle=10` for rehearsals) |

## Structure
| File | Role |
|---|---|
| `src/lib/api-types.ts` | **Generated** from the API contract — `python tasks.py contract`. Never edit by hand. |
| `src/lib/api.ts` | Typed client for every endpoint |
| `src/lib/useTwin.ts` / `twinContext.tsx` | All twin state, shared by every tab (scenario → forecast → baseline → plan → decisions → after; hour/station/view) |
| `src/lib/stats.ts` | Per-station day views (peak, peak hour, boardings) — re-arrangements of API numbers only |
| `src/lib/previewPlanner.ts` | **Temporary** while `/agent/plan` returns 501: fixed candidate menu, numbers from `/simulate`, labelled "Preview planner (no AI)" |
| `src/lib/i18n.tsx`, `src/messages/{en,ar}.json` | next-intl, typed messages (key parity checked). **Arabic needs a native-speaker review.** |
| `src/components/Shell.tsx` | Sidebar navigation + header + tabs (URL-synced, back button works) |
| `src/components/DubaiMap.tsx` | MapLibre + local PMTiles (OSM) in our palette, 3D buildings from OSM heights, deck.gl columns/rings overlay, native MapLibre labels (Arabic shaped) |
| `src/components/pages/*` | Overview, Twin, Events, Stations, Planner, Evidence, Decisions |
| `src/components/Inspector.tsx` | Reusable station summary, forecast chart, plan panel, scoreboard |
| `src/components/KioskLayer.tsx`, `src/lib/kiosk.ts` | Attract/tour/idle, lockdown, full screen |
| `public/map/` | `dubai.pmtiles` (git-ignored, `python tasks.py basemap`), fonts, sprites, copied MapLibre worker (git-ignored) |
| `public/geo/metro.geojson` | Metro line geometry from RTA GTFS — `python tasks.py network` |

## Rules
- Offline: no remote tiles, fonts, or scripts at run time. Map © OpenStreetMap contributors (shown on the map).
- Every number on screen comes from an API response with a `source` run id; the UI never computes metrics.
- Colour is never the only cue (rings, outlines, % labels).
- Known limits: deck.gl draws on a camera-synced overlay (9.4's interleaved mode does not support MapLibre 6 yet),
  so columns are not hidden behind buildings. Not done yet: export brief, Playwright screenshots, touch-monitor test.
