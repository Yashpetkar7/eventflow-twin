# apps/web — EventFlow Twin UI (Next.js 16)

Spec: `docs/07_UI_SPEC.md`. Design tokens: `src/app/tokens.css` (accent #1D4ED8), mapped to Tailwind in `globals.css`.

## Run
```bash
# terminal 1 (repo root): the API
python tasks.py api                 # http://localhost:8000
# terminal 2
cd apps/web && npm install && npm run dev    # http://localhost:3000
```
`NEXT_PUBLIC_API_URL` overrides the API address (default `http://localhost:8000`).

## What's here
| File | Role |
|---|---|
| `src/lib/api-types.ts` | **Generated** from the API contract — `python tasks.py contract`. Never edit by hand. |
| `src/lib/api.ts` | Typed client for every endpoint |
| `src/lib/useTwin.ts` | All state: scenario → forecast → baseline → plan → decisions → after |
| `src/lib/previewPlanner.ts` | **Temporary**: used only while `/agent/plan` returns 501. Fixed candidate menu, every number from `/simulate`, labelled "Preview planner (no AI)". Delete when Stream B lands. |
| `src/components/CorridorMap.tsx` | deck.gl 3D corridor (columns = boardings, colour + ring = load), offline GeoJSON |
| `src/components/HeatStrip.tsx` | Stations × hours, synced hour scrubber |
| `src/components/Inspector.tsx` | Station load, forecast band vs comfort capacity, plan options, Approve/Reject, before/after scoreboard |
| `src/components/EvidenceDrawer.tsx` | Eval metrics with result files, break points, provenance, decision log, limitations |
| `src/components/TableView.tsx` | Accessible table version |
| `public/geo/metro.geojson` | Built from RTA GTFS — `python tasks.py geo` |

## Rules
- Offline: no remote tiles, fonts are self-hosted by `next/font` at build time.
- Every number on screen comes from an API response with a `source` run id; never compute metrics in the UI.
- Colour is never the only cue (rings / outlines / % labels).
- Not done yet: Arabic/RTL (next-intl), kiosk mode (`?kiosk=1`), idle attract loop, export brief, Playwright tests.
