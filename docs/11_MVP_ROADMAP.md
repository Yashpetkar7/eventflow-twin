# 11 — Roadmap: from exhibit demo to a deployed MVP

Written 12 Nov 2026. Supersedes the phase list in `MASTER_BUILD_PROMPT.md` for everything after the exhibit UI.
Effort figures are estimates in focused working sessions (one session ≈ half a day with Claude Code), not promises.

## Where we are (Phase 0 — done)
An exhibit-ready twin that runs offline on a laptop: real 3D corridor from OpenStreetMap, six corridor stations,
scenario what-ifs, a deterministic planner with number verification, human approval with an audit log, English /
Arabic, kiosk mode, guided demo, 16 UI tests, 74 API tests. Measured results: `docs/metrics.md`.

**What it is not yet** (and what the nomination PDF currently claims — fix the build or the wording):

| Nomination says | Today |
|---|---|
| RTA metro ridership via Dubai Pulse | Timetable (GTFS) is real; demand is synthetic |
| LightGBM quantile forecasting | Served forecast = weekday quantiles + event model; LightGBM only in the backtest |
| Event model calibrated on historical events | Not calibrated |
| LangGraph multi-agent workflow with a Claude LLM | Deterministic planner, template text |
| Evaluation gate incl. number faithfulness, prompt injection | Forecast + simulator suites only |
| Supporting pictures | Old concept renders, not the current twin |
| Helps People of Determination | Nothing in the product addresses it |

## What research says RTA will recognise
Sources at the end. Each finding maps to a feature in the phases below.

| Finding | What it means for us |
|---|---|
| RTA's updated AI Strategy (1 Nov 2026): 41 areas, ~200 AI products, AED 300m+ a year, **50 % of operations and services on an agentic-AI ecosystem**, 3–5 % less congestion; the bus **Network Planner runs ~20 agents** that analyse KPIs, find gaps, simulate and recommend | Our pitch is the same loop for event crowding. Make the agents real, named and visible (Phase 2), and keep "the simulator computes every number" as the difference |
| How RTA actually handles New Year's Eve at Burj Khalifa: staged road closures, metro running ~43 hours, **Burj Khalifa/Dubai Mall station closed at a set time or when it reaches capacity**, visitors steered to neighbouring stations, **free shuttle buses** to stations, taxis and parking | Our menu lacks the two measures RTA uses most: **station closure / entry metering** and **extended service hours**. Add them (Phase 3) so a planner can rebuild the real NYE plan in the twin |
| RTA trialled AI + simulators on nol data in 2021 to spread metro peaks | The idea is familiar to RTA; ours is event-specific, multimodal and auditable |
| RTA's smart bus station uses AI cameras for live crowd movement; Taipei Metro shows AI gate crowd levels; TfL Go and WMATA show station busyness; Singapore's LTA publishes **30-minute crowd-level forecasts** as open data | Two features: a **live-count adapter** (nowcast when a feed exists, simulated and labelled until then) and a **public crowd-level forecast feed + passenger widget** (Phase 3) |
| Dubai Pulse metro ridership: ~3,100 daily files, last updated 9 Dec 2025, access by accepting terms / requesting permission (credentials by email) | The data exists and covers GITEX 2025 (13–17 Oct 2025). Getting it is a team action, not a build task (Phase 4) |
| Vercel (Aug 2026 docs): Python 3.12–3.14, FastAPI detected automatically, **500 MB** Python bundle, 300 s max duration on Hobby, **Services (beta, all plans)** run a Next.js frontend and a FastAPI backend in one project on one domain. Instances do not share memory; the filesystem is not a database | The API fits as it is, but it must stop keeping forecast runs in process memory and writing logs to disk (Phase 1) |

## Phases
Every phase ends with something that works end to end and a check that proves it. Phases 1–3 are useful before the
exhibit (18 Nov); 4–6 turn the demo into a product.

### Phase 1 — Live demo on one URL (Vercel) · ~2 sessions
*What RTA and the professor see:* a link that opens the twin on any laptop or phone, no install.
- Stateless API: `/simulate` and `/agent/plan` can rebuild a forecast run from its parameters (no shared memory needed).
- Writable state moves behind one setting (laptop: files as today; Vercel: per-instance temp, labelled in the UI).
- One Vercel project: Next.js at `/`, FastAPI at `/api`, preview deploy per pull request.
- Public-demo guardrails: "research prototype · synthetic baseline · not an RTA system" banner, request rate limit, no indexing.
- **Check:** `scripts/smoke_live.py <url>` passes (forecast → simulate on a cold instance → plan → decision), and the
  Playwright demo-flow test passes against the preview URL.
- **Detailed plan:** `docs/superpowers/plans/2026-11-12-vercel-live-demo.md`.
- **Needs from the team:** a Vercel account linked to the GitHub repo; a decision that a public URL is acceptable
  (the README still says "keep this repo private" while the repo is public).

### Phase 2 — Real agents, measured · ~3 sessions
*What RTA sees:* named agents working in sequence, like their Network Planner, with a critic that can say no.
- Agents: **Diagnoser** (tool) → **Proposer** (LLM, menu-only JSON, bounds enforced) → **Simulator runner** (tool, every
  candidate) → **Ranker** (tool) → **Critic** (LLM: rejects options that move the hotspot, with the simulator's numbers)
  → **Explainer** (LLM, EN/AR) → **Verifier** (code: every number must match a tool value, else template fallback).
- The deterministic planner stays as the offline path and as the yardstick ("how often does the LLM plan match or beat
  the exhaustive search?").
- Eval suites promised in the nomination: `agents` (faithfulness = 1.0, schema ≥ 0.95), `redteam` (injection in event
  names / notes, EN/AR/code-switched, success = 0), `safety`, `latency`; all in the CI gate.
- Agent trace panel in the UI: who did what, which tool run each number came from.
- **Check:** `python tasks.py eval && python -m eval.gate` green with the four new suites required; UI shows
  `planner: <model id>` and still passes the "numbers come from the simulator" test.
- **Needs:** `ANTHROPIC_API_KEY` and `LLM_MODEL` in `.env` and as CI/Vercel secrets (never in the repo); a monthly spend cap.

### Phase 3 — Features a planner would use · ~4 sessions
Ordered by value per effort; each is independently shippable.
1. **Break-point view** — "at what crowd size does this station tip over?" from `scripts/sensitivity.py` (already
   computed; in the PRD demo flow; not in the UI).
2. **Station closure / entry metering** and **extended service hours** as interventions, so the real NYE plan can be
   rebuilt and compared in the twin. Closure redirects demand to walkable neighbours; metering holds entries at the
   threshold and reports the queue outside the gate instead of on the platform.
3. **Duty-manager view** ("next 3 hours") with a **Watcher agent**: re-runs the forecast on a schedule, raises an alert
   when a station is forecast to cross the threshold, drafts a plan, waits for approval.
4. **Messenger agent**: drafts the bilingual passenger message and signage text for an approved plan; a human edits and
   approves; nothing is sent anywhere.
5. **Crowd-level forecast feed**: `GET /public/crowd-forecast` (station × 30 min, three levels, with `is_synthetic`),
   plus a small passenger widget "quietest time to leave" — the LTA / TfL pattern.
6. **Live-count adapter**: an interface for gate or camera counts that nudges the forecast for the next hours
   (nowcast). Ships with a simulated feed, labelled SIMULATED, so the mechanism can be shown honestly.
7. **Whole network**: the API already covers 53 stations; add a network view and let any station be the focus.
8. **Event brief as PDF** and a shareable read-only link to a scenario.
9. **"Ask the twin"**: questions answered only from tool outputs and the docs (after Phase 2).
- **Check per feature:** a pytest for the simulator behaviour (conservation still holds), a Playwright flow, an entry in
  `docs/09_DECISIONS.md`.
- **Not planned without data:** step-free routing for People of Determination. We have no lift or accessibility data;
  either find it or remove the claim from the nomination.

### Phase 4 — Real data and calibration · ~3 sessions after the files exist
*What RTA sees:* "validated on GITEX 2025 and New Year's Eve ridership", with the error stated.
- Ingest Dubai Pulse ridership → `data/processed/station_hour.parquet` (station alias table, gap-free hourly grid).
- Serve LightGBM quantiles with split-conformal intervals behind the existing response shape.
- Calibrate `metro_share`, walking decay and exit timing on GITEX 2025 day 1–5 and NYE; replace `boardable_share`
  with through-load from origin–destination ridership; report event-day error separately, even if it is worse.
- SYNTHETIC badge disappears only where the numbers are real.
- **Check:** forecast suite on real data in the gate; calibration error table in `docs/metrics.md`.
- **Needs:** one team member requests the dataset on Dubai Pulse / Data.Dubai and downloads Oct–Dec 2025 into `data/raw/`.

### Phase 5 — SaaS foundation · ~4 sessions
*What a customer gets:* accounts, saved work, an audit trail that survives a redeploy.
- Postgres for scenarios, plans, decisions and agent traces (replaces the JSONL file and the temp cache).
- Sign-in with organisations and three roles: planner (approve), duty manager (alerts, approve), viewer (read-only).
- Saved scenarios, comparison of two scenarios, export of the audit log (CSV / PDF).
- Corridor packs: a corridor is configuration + a baked scene, so a second corridor (e.g. Expo City for GITEX 2026)
  can be added without code.
- API keys and usage metering for the public feed.
- **Check:** two users in two organisations cannot see each other's scenarios (test); a decision made before a redeploy
  is still listed after it.
- **To decide before building (not researched yet):** auth provider, Postgres host, pricing model.

### Phase 6 — Production readiness · ~2 sessions
- CI: eval gate + Playwright on every pull request against the preview deployment; nightly full evals.
- Observability: request logs, error tracking, agent cost per plan, alert when the gate fails on `main`.
- Security pass: rate limits, input bounds (already typed), secrets only in the platform, dependency audit.
- Privacy statement: station-hour aggregates only, no personal data (PDPL), OpenStreetMap and RTA open-data credits.
- Custom domain, status page, runbook for the hosted service, handover notes.
- **Check:** a tagged release that a new team member can deploy from the README alone.

## Before 18 November, in this order
1. Phase 1 (the link). 2. Break-point view (Phase 3.1). 3. Phase 2 if the API key arrives, else keep the honest
   "offline planner" label. 4. Refresh the nomination: real screenshots from `eval/results/ui/`, corrected wording.
5. Test on the real touch monitor (`docs/BOOTH_RUNBOOK.md`).

## Rules that do not change
Numbers only from deterministic code · nothing applied without a human approval · synthetic and assumed values
labelled · "designed for / aligned with" RTA, never "used by" · no RTA logo · the booth build keeps working offline.

## Sources (checked 12 Nov 2026)
- RTA updated AI Strategy: https://wam.ae/en/article/c31bwf9-rta-launches-updated-artificial-intelligence ·
  https://www.khaleejtimes.com/uae/dubai-rta-targets-traffic-congestion-cut-ai-strategy ·
  https://gulfnews.com/uae/dubai-motorists-to-face-less-traffic-and-get-faster-rta-services-heres-how-1.500731525
- New Year's Eve crowd and transport plan: https://gulfnews.com/uae/transport/nye-in-dubai-rta-announces-road-closures-metro-goes-43-hours-non-stop-1.500390918 ·
  https://www.khaleejtimes.com/uae/transport/nye-2026-in-dubai-sheikh-zayed-road-burj-khalifa-metro-station-to-close-timings-revealed ·
  https://www.khaleejtimes.com/uae/dubai-new-year-celebration-alternative-parking-spots-metro-closure-announced
- RTA AI crowd-management trial (2021): https://www.rta.ae/wps/portal/rta/ae/home/news-and-media/all-news/NewsDetails/rta-to-tap-into-artificial-intelligence-for-better-crowd-management-at-metro-stations
- Smart bus station with AI cameras: https://gulfnews.com/uae/transport/dubai-launches-worlds-first-ai-powered-smart-bus-station-1.500535433
- Crowding information elsewhere: https://www.intelligenttransport.com/?p=126299 (TfL Go) ·
  https://wmata.com/about/news/Real-Time-Crowding.cfm ·
  https://www.uitp.org/award-projects/ai-driven-passenger-flow-management-system-at-sun-yat-sen-memorial-hall-station/ ·
  https://glama.ai/mcp/servers/@arjunkmrm/mcp-sg-lta/tools/station_crowd_forecast (third-party wrapper of LTA's forecast; check LTA DataMall directly)
- Ridership dataset: https://www.dubaipulse.gov.ae/data/rta-rail/rta_metro_ridership-open
- Vercel: https://vercel.com/docs/functions/runtimes/python · https://vercel.com/docs/functions/limitations · https://vercel.com/docs/services

Figures quoted from news reports (bus counts, hours, percentages) vary between outlets; re-check the RTA or Dubai
Media Office release before putting any of them on the poster.
