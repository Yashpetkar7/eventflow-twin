# MASTER BUILD PROMPT — paste into Claude Code one phase at a time

**How to use:** open a terminal in the repo root, run `claude`, paste the **Phase 0** block. When Claude Code finishes and the acceptance checks pass, commit (`git commit -am "phase N"`), then paste the next phase. If a phase overruns its time box, ask Claude Code to "cut to MUST scope and finish the phase".

---

## Phase 0 — Orient & verify the scaffold (30 min)
```
Read CLAUDE.md and every file in docs/ (00 to 10). Then:
1. Summarise the product, MUST scope and hard rules back to me in 10 bullet points.
2. Run: make synth && make baseline && make test. Fix anything broken.
3. Check that eval/results has a forecast_*.json with the required fields.
4. Propose any change to the plan as a short list (do not implement yet).
Acceptance: all three make targets succeed; you list the files you read.
```

## Phase 1 — Real data ingest (2–3 h) — needs files in data/raw/
```
Follow docs/04_DATA_SOURCES.md.
1. Inspect every file in data/raw/ (print columns, dtypes, 5 rows, date coverage). Write data/raw/MANIFEST.md.
2. Implement scripts/ingest.py (Polars/DuckDB): transactions → station_hour parquet (entries, exits) in Asia/Dubai time.
   Canonical station names from the metro stations dataset; create config/station_aliases.yaml; add a test that fails if any ridership station name is unmatched.
3. Mark corridor stations in config/corridor.yaml (verify names against the stations dataset — do not trust my placeholders).
4. If GTFS present: derive scheduled trains per hour per station per direction; else keep headway assumptions.
5. Update `make ingest` and `make features`.
Acceptance: data/processed/station_hour.parquet exists, row counts reported, 0 unmatched stations, tests green.
```

## Phase 2 — Forecasting + backtest (3 h)
```
Implement docs/05 §5.2–5.3 in apps/api/eventflow/forecast.py:
seasonal-naive baseline, LightGBM quantile models (0.1/0.5/0.9) with the listed features (UAE weekend regime change on 2022-01-01),
event overlay with params from config/corridor.yaml, calibration on any historical event in config/events.yaml (verify each event date from a source URL first; never invent dates).
Rolling-origin backtest (4 folds × 7 days, last fold = test). Write eval/results/forecast_<ts>.json with MASE, sMAPE, coverage overall/per-station/event-days, n, split, dataset_version.
Acceptance: results file written; print a short table; MASE_test reported honestly.
```

## Phase 3 — Simulator + ranking + API (3 h)
```
Implement docs/05 §5.4–5.5 in apps/api/eventflow/simulate.py and rank.py, pure functions, fully typed.
Property tests in tests/test_simulator.py (conservation, no-op equality, monotonicity, bounds).
FastAPI endpoints per docs/03 API contract: /healthz /stations /events /forecast /simulate /decisions /evidence. Each response includes run_id and is_synthetic.
Write eval/suites/simulator.py producing eval/results/simulator_<ts>.json.
Acceptance: pytest green; curl examples in docs/API_EXAMPLES.md work.
```

## Phase 4 — Agents (3 h)
```
Implement docs/06 with LangGraph in apps/api/eventflow/agents/: intake, propose (JSON-schema constrained), simulate/rank via tools, explain, verify_numbers.
LLM client reads ANTHROPIC_API_KEY and LLM_MODEL from env; provider interface for future swap.
POST /agent/plan and POST /decisions (append to data/processed/decisions_log.jsonl).
scripts/build_demo_cache.py → data/demo_cache/ for 3 scenarios × EN/AR; DEMO_MODE=offline serves only from cache.
Eval suites: agents (faithfulness, schema), redteam (15 cases incl. Arabic), safety, latency → eval/results. Update eval/thresholds.yaml per docs/08 and extend eval/gate.py RULES for forecast/simulator/agents.
Acceptance: number-faithfulness = 1.0, redteam attack success = 0.0, gate passes; deliberately break simulator once and show gate fails, then revert.
```

## Phase 5 — Web UI (5–6 h)
```
Build apps/web (Next.js App Router, TypeScript, Tailwind using apps/web/tokens.css; set --accent to #1D4ED8).
Implement docs/07: landing/attract screen, workspace (left rail, deck.gl+MapLibre 3D corridor using LOCAL GeoJSON — no remote tiles, bottom heat-strip timeline synced to map, right inspector with p10–p90 band vs capacity, option cards with Approve/Reject, before/after scoreboard), evidence drawer, table views, export brief PNG.
next-intl with en/ar and full RTL; IBM Plex Sans Arabic. SYNTHETIC badge when data is synthetic.
Touch-first kiosk mode (?kiosk=1) per docs/07 (≥48 px targets, no hover-only info, guided 3-step tour, idle auto-play). Test on a touch monitor. Reduced-motion support.
Acceptance: the demo flow in docs/02 works end-to-end with Wi-Fi OFF and DEMO_MODE=offline; Playwright screenshot test for EN and AR workspace.
```

## Phase 6 — Proof, packaging, booth (2–3 h)
```
1. Run make eval; then python scripts/report_metrics.py --repo . --out docs/metrics.md --json docs/metrics.json.
2. Fill every [METRIC] placeholder in submission/NOMINATION_CONTENT.md, exhibit/POSTER_CONTENT.md and exhibit/DEMO_SCRIPT_90S.md using ONLY docs/metrics.json; list any metric still missing.
3. Write README.md project section (pitch, architecture mermaid, results table with n and split, how to run, limitations, data credits).
4. `make demo` starts API + web in kiosk + offline mode with one command; write docs/BOOTH_RUNBOOK.md (start, recover, shutdown).
5. Record a 60–90 s screen capture of the demo as backup (tell me the steps; I will record).
Acceptance: make demo works from a fresh clone on my laptop; no number anywhere lacks a source file.
```

## Phase 7 (optional) — Deploy
```
Deploy web to Vercel and API to Azure Container Apps (scale-to-zero, Key Vault for the API key, budget alert first). Keep offline booth build as the primary demo. Document what's actually deployed.
```
