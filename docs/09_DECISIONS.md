# 09 — Decision log

| # | Date | Decision | Why | Alternatives |
|---|---|---|---|---|
| 1 | 2026-11-11 | Hybrid forecast: ML background + parametric event overlay | Few labelled events in open data; overlay is explainable and calibratable | Pure ML (needs many events), pure simulation |
| 2 | 2026-11-11 | Deterministic simulator + ranker; LLM only plans/explains | Numbers must be auditable; prevents hallucinated metrics | LLM-computed estimates |
| 3 | 2026-11-11 | Offline-first demo with cached agent outputs | Venue Wi-Fi unreliable | Live-only |
| 4 | 2026-11-11 | deck.gl + MapLibre with local GeoJSON | No paid map keys, works offline | Mapbox, Google Maps |
| 5 | | Which GTFS feed used (official 2021 vs community newer) | | |
| 6 | | Ridership window chosen + events inside it | | |
