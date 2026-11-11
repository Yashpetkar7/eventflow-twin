# 09 — Decision log

| # | Date | Decision | Why | Alternatives |
|---|---|---|---|---|
| 1 | 2026-11-11 | Hybrid forecast: ML background + parametric event overlay | Few labelled events in open data; overlay is explainable and calibratable | Pure ML (needs many events), pure simulation |
| 2 | 2026-11-11 | Deterministic simulator + ranker; LLM only plans/explains | Numbers must be auditable; prevents hallucinated metrics | LLM-computed estimates |
| 3 | 2026-11-11 | Offline-first demo with cached agent outputs | Venue Wi-Fi unreliable | Live-only |
| 4 | 2026-11-11 | deck.gl + MapLibre with local GeoJSON | No paid map keys, works offline | Mapbox, Google Maps |
| 5 | | Which GTFS feed used (official 2021 vs community newer) | | |
| 6 | | Ridership window chosen + events inside it | | |
| 7 | 2026-11-11 | Backtest uses only lags ≥ 168 h (lag168, lag336, 4-week same-hour mean); t-24h and the old rolling feature removed | 7-day-ahead backtest must not see actuals inside the test week; old features leaked and flattered MASE | Day-ahead refit loop (more honest for 1-day horizon, slower) |
| 8 | 2026-11-11 | Simulator + event overlay at 15-min bins (`bins_per_hour: 4`); UI aggregates to hours | Exit surges (σ≈30 min) and staggered exits (15–90 min) cannot be represented in hourly bins; old hourly stagger rounded 30 min to zero | Hourly bins; 5-min bins (slower, no added realism) |
| 9 | 2026-11-11 | Load factor = demand / capacity (spec); unserved passengers carried in a deterministic fluid queue that only feeds wait metrics (`max_wait_min`, `delay_pax_min`) | Including the queue in LF compounds (LF 8.5 at 40k attendance) and is unreadable; queue still makes over-capacity visible as waiting | Queue-inclusive LF |
| 10 | 2026-11-11 | Interventions are typed + bounded (Pydantic discriminated union, bounds in corridor.yaml); invalid → HTTP 422, never clipped | A planner must see exactly what was simulated; bad ids used to crash with 500 | Silent clipping |
| 11 | 2026-11-11 | Fixed application order by type (stagger → trains → redirect → shuttle → robotaxi) | Bundle result must not depend on listing order (tested) | Apply in request order |
| 12 | 2026-11-11 | Shuttle and robotaxi act only on demand above the comfort threshold; shuttle never fills the destination past the threshold | Spec: move min(excess, capacity); old code moved demand even with no crowding and could create a new hotspot | Fixed transfer every hour |
| 13 | 2026-11-11 | Staggered exit = uniform release delay over [0, spread) computed per minute | Physically interpretable ("release rows in waves"), conserves passengers exactly, works for any spread | Gaussian σ widening |
| 14 | 2026-11-11 | Deterministic run ids (hash of request + dataset version + config hash) | API restarts, offline cache and evals refer to the same run for the same inputs | uuid per call |
| 15 | 2026-11-11 | Forecast v1 background = empirical same-weekday p10/p50/p90; event band = attendance × [0.75, 1.25] (assumption, labelled) | Gives the UI a real band today; Stream A swaps in LightGBM quantiles + conformal without changing the contract | Wait for LightGBM service |
| 16 | 2026-11-11 | Gate FAILS when a required suite's results are missing (`required_suites` in thresholds.yaml) | Missing evidence used to show as SKIP and pass | Warn only |
| 17 | 2026-11-11 | No assumption tuned to make the demo look dramatic: with kit defaults, DFW Day 1 (15k, assumption) peaks at EMT 18:00 (LF 1.38); only EMT 17:00 and 18:00 exceed 0.85 | Integrity rule; calibration happens on real event days in Phase 2 | Tune metro_share for a bigger hotspot |
