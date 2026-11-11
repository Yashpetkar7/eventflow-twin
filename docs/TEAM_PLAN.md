# Team plan — EventFlow Twin (Krishna · Atharva · Yash)

Status at 11 Nov 2026 evening. Target: demo-ready **17 Nov** (works for both exhibit periods). Owners for streams
A/B/C are **to be agreed on the team call**; the proposal is at the bottom.

## 1. What already exists (commit `2866ae4`+)
| Area | State |
|---|---|
| Simulator | 15-min bins, fluid queue (`max_wait_min`, `delay_pax_min`), 5 typed + bounded interventions, order-independent bundles, 93-check property suite, gate proven to fail when conservation is broken (`eval/proofs/`) |
| Forecast | v1 service: empirical weekday p10/p50/p90 + event overlay; what-if `attendance` / `end_time`; deterministic run ids |
| Backtest | Leakage removed (only lags ≥ 168 h). Synthetic: LightGBM MASE 0.836 vs naive 0.990, coverage80 0.738 (`eval/results/forecast_*.json`, SYNTHETIC) |
| API | Contract v1 frozen: `/healthz /stations /events /forecast /simulate /decisions /evidence`, `/agent/plan` = 501 stub |
| Contract | `contract/openapi.json`, `contract/api-types.ts`, 9 fixtures from real code paths, drift test |
| Tooling | `python tasks.py <task>` on every OS; pinned `requirements.txt`; CI gate workflow; 57 tests |
| Not started | real-data ingest, LightGBM serving + conformal, exhaustive search, agents, offline cache, web app, Arabic, kiosk, `demo` task |

## 2. Rules that keep three people from colliding
- **Contract first.** Never change `apps/api/eventflow/schemas.py` silently. Change = bump `CONTRACT_VERSION`,
  `python tasks.py contract`, note in `docs/09_DECISIONS.md`, tell the other two. `tests/test_contract.py` fails on drift.
- **Folder ownership:** A → `scripts/ingest.py`, `scripts/baseline.py`, `forecast.py`, `simulate.py`, `rank.py`, `eval/suites/{forecast,simulator}.py`.
  B → `apps/api/eventflow/agents/`, `main.py` agent/decision routes, `scripts/build_demo_cache.py`, `eval/gold/`, `eval/suites/{agents,redteam,safety,latency}.py`.
  C → `apps/web/**`, `exhibit/`, `submission/images/`. Shared files (`config/*.yaml`, `schemas.py`) → PR + one reviewer.
- **Branches:** `main` is always demo-able. Work on `a/<topic>`, `b/<topic>`, `c/<topic>`; PR into `main`; CI gate must be green.
- **Numbers:** every number in UI / poster / nomination comes from `eval/results/*.json` or a tool response with a `source`.
- **Before every push:** `python tasks.py test` and `python tasks.py gate`.

## 3. Streams
**A — Data, forecast, simulator core**
1. Real data: ingest Dubai Pulse ridership → `data/processed/station_hour.parquet` (reindex to a gap-free hourly grid; the backtest refuses gaps). Station alias table + unmatched-name test. `data/raw/MANIFEST.md`.
2. Verify corridor station names/coords and venue coords; GTFS headways → `corridor.yaml` (record which feed in DECISIONS #5).
3. LightGBM quantile model as the forecast background (same output shape) + **split-conformal** calibration of p10/p90.
4. Calibrate `metro_share` on a verified historical event day; report calibration error honestly.
5. `rank.py`: deterministic ranking + **exhaustive bundle search** (menu × param grid) → Pareto set; yardstick metric for B.
6. **Open modelling issue:** the spec score (Δexcess − λ·cost) ranks "redirect 30% EMT→FIC" #2 although it *raises*
   over-capacity station-hours 1.25 → 2.0 (FIC becomes the new hotspot). Propose: reject or penalise options that
   create new over-capacity station-hours. Team decision needed (see `contract/fixtures/agent_plan.json`).

**B — Agents, API, evals**
1. LangGraph graph per docs/06: intake → forecast/diagnose tools → propose (JSON-schema, menu-only, bounds from
   `interventions.py`) → simulate ×N → rank → explain → verify_numbers (template fallback).
2. LLM client behind a provider interface; model ids from env (check current Claude ids/pricing before setting).
3. `/agent/plan` replacing the 501 stub; store plans in `_PLANS` so `/decisions` logs the approved option.
4. Offline cache keyed by deterministic ids: 3 scenarios × EN/AR, served < 0.5 s with `DEMO_MODE=offline`.
5. Gold sets + suites: agents (faithfulness = 1.0, schema ≥ 0.95, **plan quality vs exhaustive optimum**), redteam (15, EN/AR/code-switched), safety, latency. Add each to `required_suites`.

**C — Web, kiosk, visuals**
1. Next.js App Router + Tailwind + `apps/web/tokens.css`; build against `contract/fixtures/` first, then live API (types from `contract/api-types.ts`).
2. deck.gl + MapLibre with **local GeoJSON** only (one-time OSM extract committed); extruded stations, ring pattern for LF > 0.85.
3. Heat strip (stations × hours, from `/simulate.hourly`), inspector band (p10–p90 vs capacity), option cards + Approve/Reject → `/decisions`, before/after scoreboard (`baseline_summary` vs `summary`), evidence drawer (`/evidence`), table views, export brief.
4. **Live what-if sliders** (attendance, exit time) → `/forecast` + `/simulate`, no LLM needed.
5. next-intl EN/AR + full RTL; kiosk `?kiosk=1` (≥ 48 px targets, idle loop, 3-step tour); Playwright EN/AR screenshots.
6. Real screenshots for the nomination (by Fri 13 Nov) and poster.

**Shared (lead: Krishna)** — nomination content to Dr. Rachit by **Fri 13 Nov**, poster, demo script, booth runbook, rehearsals 17 Nov.

## 4. Checkpoints
| Day | Checkpoint (all three, 15 min) |
|---|---|
| Thu 12 | Owners agreed; real-data status; web shell renders fixtures; agent graph skeleton |
| Fri 13 | Nomination sent with real screenshots; `/agent/plan` live; LightGBM forecast served |
| Sat 14 | Web ↔ live API end-to-end; offline cache; exhaustive search |
| Sun 15 | AR/RTL, kiosk, evidence drawer; all suites in the gate |
| Mon 16 | One-command offline demo on two laptops; metrics filled into nomination/poster/script |
| Tue 17 | Polish, backup MP4, 3 rehearsals, pack |

## 5. Risks right now
- **Real ridership access:** `dubaipulse.gov.ae` now redirects to `data.dubai` (marked "under development"); the ridership dataset wasn't visible there on 11 Nov. Someone signs in with their own account and checks, or uses Data.Dubai "Request Data". Fallback: GTFS (no login) + labelled synthetic.
- **Krishna's CatchUp AI freeze (13 Nov 18:00)** overlaps D1–D2.
- **Nomination wording must match what we actually ship** (e.g. "calibrated on historical events", "GTFS-based capacity", "LangGraph"). Re-check before Friday.

## 6. Proposed owners (to confirm)
A — Krishna · B — Atharva · C — Yash (plays to past ownership: Yash front end/design system, Atharva agentic backend, Krishna data + lead).

## Commands
```
python -m venv .venv && .venv\Scripts\activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python tasks.py synth && python tasks.py eval && python tasks.py gate
python tasks.py api            # http://localhost:8000/docs
python tasks.py contract       # after any schema change
```
