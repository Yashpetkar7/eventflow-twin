# Team plan — EventFlow Twin (Krishna · Atharva · Yash)

> **12 Nov evening:** the status and task split below are out of date. Current tasks per person, with due dates and
> "done when" checks: **`docs/12_TEAM_TASKS.md`**. The working rules in §2 still apply.

Status at 11 Nov 2026 evening. Target: demo-ready **17 Nov** (works for both exhibit periods). Owners for streams
A/B/C are **to be agreed on the team call**; the proposal is at the bottom.

## 0. Update 11 Nov evening — real timetable changes the demo story (read first)
The official RTA GTFS (Sep–Dec 2021) is now the capacity source (`config/capacity_gtfs.yaml`, DECISIONS #18–21).
Real headways at Emirates Towers on a weekday evening are ~2.6–3.5 min, not the 4-min placeholder. Result:
**DFW Day 1 at the assumed 15,000 visitors no longer overloads any station** (EMT peak LF 0.61). Crowding starts
≈ 25k and is clear at 40k (LF 1.31, 10-min waits). We did not tune assumptions to bring the hotspot back.
**Added (DECISIONS #22–24): GITEX Global 2025 Day 1** at Dubai World Trade Centre (13 Oct 2025, 10:00–17:00; sourced),
40,000 visitors/day derived from the official "upwards of 200,000" over 5 days. At kit defaults WTC peaks at LF 0.78 —
so we publish *when* it breaks instead of tuning (`python scripts/sensitivity.py`):

| first over-capacity at … visitors | free space on arriving trains 15% | 20% | 25% | 30% | 35% (default) |
|---|---|---|---|---|---|
| GITEX 2025 (metro share 45%) | 15,000 | 22,500 | 30,000 | 37,500 | 45,000 |
| DFW 2026 (metro share 45%) | 7,500 | 10,000 | 15,000 | 20,000 | 22,500 |

Story for the booth: *"With the sourced 40,000 GITEX visitors a day, World Trade Centre crosses the comfort line if
trains arrive with less than ~30% free space — exactly the number ridership data will pin down."*

Decide together:
1. ~~**Demo scenario.**~~ **Decided 11 Nov: GITEX 2025 is the headline** (DECISIONS #25); nomination, poster, demo script, jury Q&A and PRD updated; PDF + concept images still need regenerating. Original options were: Options: a sourced attendance figure for DFW; a bigger verified event (GITEX at DWTC, New
   Year's Eve at Burj Khalifa/Dubai Mall — both real, both in historical ridership); or keep DFW and make the
   attendance slider the story ("at what crowd size does EMT break?").
2. **Through-load.** `boardable_share` 0.35 is the softest assumption: trains reach EMT already loaded. Ridership
   origin–destination data lets Stream A compute on-board load per segment and replace it.
3. The ranking flaw (§3 A6) still applies: with the new capacity the walking redirect ranks #1 on Δexcess − λ·cost.

## 0b. Update 12 Nov — whole network, real Dubai map, product shell
- **Whole Dubai Metro**: 53 stations (Red, Green, Jabal Ali branch) from the official RTA GTFS, capacity per line and direction (DECISIONS #32–36).
- **Real offline map of Dubai** (OpenStreetMap, 3D buildings) — run `python tasks.py basemap` once per laptop (DECISIONS #37–38).
- **Tabbed app** (Overview · Live twin · Events · Stations · Planner · Evidence · Decisions), EN/AR, kiosk on top (DECISIONS #39). See `apps/web/README.md`.
- Demand everywhere is still labelled synthetic: **ridership data is now the main gap**.

## 1. What already exists (commit `2866ae4`+)
| Area | State |
|---|---|
| Simulator | 15-min bins, fluid queue (`max_wait_min`, `delay_pax_min`), 5 typed + bounded interventions, order-independent bundles, 93-check property suite, gate proven to fail when conservation is broken (`eval/proofs/`) |
| Forecast | v1 service: empirical weekday p10/p50/p90 + event overlay; what-if `attendance` / `end_time`; deterministic run ids |
| Backtest | Leakage removed (only lags ≥ 168 h). Synthetic: LightGBM MASE 0.836 vs naive 0.990, coverage80 0.738 (`eval/results/forecast_*.json`, SYNTHETIC) |
| API | Contract v1 frozen: `/healthz /stations /events /forecast /simulate /decisions /evidence`, `/agent/plan` = 501 stub |
| Contract | `contract/openapi.json`, `contract/api-types.ts`, 9 fixtures from real code paths, drift test |
| Tooling | `python tasks.py <task>` on every OS; pinned `requirements.txt`; CI gate workflow; 57 tests |
| Data | Official RTA GTFS 2021 ingested for capacity + station coords (`data/raw/MANIFEST.md`); ridership still missing |
| Not started | ridership ingest, LightGBM serving + conformal, exhaustive search, agents, offline cache, web app, Arabic, kiosk, `demo` task |

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
2. ~~Station names/coords + GTFS headways~~ done (DECISIONS #18–20). Still: verify venue coords; replace `boardable_share` with through-load from OD ridership.
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

**C — Web, kiosk, visuals** — *started 11 Nov: workspace works end to end against the live API (scenario rail with attendance/end-time what-ifs, offline 3D map, heat strip, forecast band chart, preview planner → Approve/Reject → logged → re-simulated before/after scoreboard, evidence drawer, table view). See `apps/web/README.md`. Arabic/RTL and kiosk mode (`?kiosk=1`) done the same day. Remaining: export brief, Playwright EN/AR screenshots, test on the real touch monitor, **native-speaker review of `apps/web/src/messages/ar.json`**, real screenshots for the nomination.*
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
