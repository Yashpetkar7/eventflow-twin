# 07 — UI spec

## Look & feel
Light, calm, "analyst-grade" (see `apps/web/tokens.css`): pearl background `#FAF8F5`, white glass panels, one accent (deep transit blue `#1D4ED8`) + sand highlight, desaturated ok/warn/risk. Depth from soft shadows, not neon. Do **not** use RTA logos or imply RTA branding.
Fonts: Inter/Geist (Latin), IBM Plex Sans Arabic (Arabic, line-height 1.6–1.7). Logical CSS properties only (padding-inline etc.).

## Layout (workspace)
- **Left rail (280 px):** scenario picker (event, date, attendance slider), layers toggle (stations, roads, venues), locale EN/AR, SYNTHETIC badge when relevant.
- **Centre:** deck.gl + MapLibre 3D map of the corridor. Stations = extruded columns, height = demand, colour = load factor (ok → warn → risk) **plus** a ring pattern for >0.85 (colour is never the only cue). Venue pins. Optional road segments coloured by pressure proxy.
- **Bottom:** 24-hour heat-strip timeline (stations × hours), scrubber synced to map.
- **Right inspector (360 px, glass):** selected station chart (p10/p50/p90 band vs capacity line), "Plan interventions" button, 3 option cards (title, Δ metrics, cost proxy, rationale, sources, Approve/Reject), before/after scoreboard.
- **Evidence drawer:** eval metrics (with file + date on hover), data provenance, decision log, limitations.

## Screens
1. Landing / attract (booth): headline EN + AR ("Predict the crowd before it arrives." / "توقّع الزحام قبل وصوله"), live 3D corridor slowly orbiting, one CTA "Start demo". Have a native Arabic speaker check the Arabic.
2. Workspace (above).
3. Table view toggle for every visual (accessibility).
4. Export: 1-page "Event Mobility Brief" (PNG/PDF).

## Booth mode (touch-screen kiosk — the exhibit is an *interactive digital twin demonstrator*)
`?kiosk=1`: full-screen, larger type (≥ 20 px body), **touch-first**: hit targets ≥ 48 px, no hover-only info, pinch/drag on the map, big scenario buttons (3 preset events), a single "Plan with AI" button and large Approve/Reject. No keyboard needed. Idle 60 s → auto-play scenario loop; any touch exits loop and starts a 3-step guided tour. Disable text selection, context menu and browser gestures. Works with Wi-Fi off (local tiles/GeoJSON, cached agent).

## Performance & a11y
60 fps on M-series laptop; lazy-load the map; reduced-motion disables orbit. Keyboard reachable controls; WCAG AA contrast.
