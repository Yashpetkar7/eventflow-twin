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

### URLs
| URL | What |
|---|---|
| `/` | Planner workspace (English; remembers the last language) |
| `/?lang=ar` | Arabic, full right-to-left |
| `/?kiosk=1` | **Booth kiosk**: attract screen + autoplay → touch → 3-step tour → live; resets after 60 s idle |
| `/?kiosk=1&lang=ar` | Kiosk in Arabic |
| `/?kiosk=1&idle=10` | Kiosk with a 10 s idle reset (rehearsals/tests; 5–600 s) |

## What's here
| File | Role |
|---|---|
| `src/lib/api-types.ts` | **Generated** from the API contract — `python tasks.py contract`. Never edit by hand. |
| `src/lib/api.ts` | Typed client for every endpoint |
| `src/lib/useTwin.ts` | All state: scenario → forecast → baseline → plan → decisions → after |
| `src/lib/i18n.tsx` | Locale state + next-intl provider, `dir`/`lang` on `<html>`, locale-aware numbers (Arabic uses Western digits), Arabic names |
| `src/messages/{en,ar}.json` | All UI text (typed: a missing key fails `tsc`). **Arabic needs a native-speaker check before the exhibit.** |
| `src/lib/kiosk.ts`, `src/components/KioskLayer.tsx` | Kiosk lockdown (no selection/context menu/page pinch), full screen on first touch, attract/tour/idle |
| `src/components/App.tsx`, `Root.tsx` | Client-only shell (locale and kiosk come from the URL; no SSR needed offline) |
| `src/lib/previewPlanner.ts` | **Temporary**: used only while `/agent/plan` returns 501. Fixed candidate menu, every number from `/simulate`, labelled "Preview planner (no AI)". Delete when Stream B lands. |
| `src/components/CorridorMap.tsx` | deck.gl 3D corridor (columns = boardings, colour + ring = load), offline GeoJSON; labels are HTML overlays so Arabic is shaped correctly; slow orbit in attract mode (off for reduced motion) |
| `src/components/HeatStrip.tsx` | Stations × hours, synced hour scrubber |
| `src/components/Inspector.tsx` | Station load, forecast band vs comfort capacity, plan options, Approve/Reject, before/after scoreboard |
| `src/components/EvidenceDrawer.tsx` | Eval metrics with result files, break points, provenance, decision log, limitations |
| `src/components/TableView.tsx` | Accessible table version |
| `public/geo/metro.geojson` | Built from RTA GTFS — `python tasks.py geo` |

## Rules
- Offline: no remote tiles, fonts are self-hosted by `next/font` at build time.
- Every number on screen comes from an API response with a `source` run id; never compute metrics in the UI.
- Colour is never the only cue (rings / outlines / % labels).
- Kiosk: every interactive target ≥ 48 px (measured at 1920×1080: heat-strip cells 49×54); panels scaled 1.35× via CSS `zoom`, the map is not scaled so touch picking stays exact.
- Not done yet: export brief (PNG/PDF), Playwright EN/AR screenshot tests, testing on the real touch monitor.
