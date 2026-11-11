# 02 — Product Requirements (PRD)

## Problem
Large events (Dubai Future Week, GITEX, New Year's Eve, concerts, expos) create short, sharp demand spikes at a handful of metro stations and the roads around them. Planners need to know **where and when** crowding will exceed capacity and **which intervention** reduces it most, early enough to act.

## Users
- **P1 Event mobility planner (primary):** wants a forecast, a ranked list of interventions, and evidence to justify a decision.
- **P2 Operations duty manager:** wants a simple "next 3 hours" view and alerts.
- **P3 Booth visitor / jury (demo persona):** wants to understand the value in 60 seconds.

## Core user stories (MUST)
1. As a planner, I pick an event (venue, date, start/end time, expected attendance) and see an hourly crowding forecast for corridor stations, before and during the event.
2. I see which station-hours exceed a comfort threshold (load factor > 0.85) — highlighted on a 3D map and a heat-strip timeline.
3. I ask the agent "what should we do?" and get 3 ranked interventions, each with predicted effect (over-capacity station-hours reduced, peak load factor), cost proxy and a one-paragraph rationale with sources.
4. I click **Approve** / **Reject** on each; the twin re-simulates with approved interventions and shows before/after.
5. I can view a table version of everything (accessibility) and export a 1-page PDF/PNG "event mobility brief".
6. Everything works offline with cached agent responses.
7. **Touch-screen kiosk mode** so visitors operate the twin themselves (the exhibit is an interactive digital twin demonstrator).

## SHOULD
- English/Arabic toggle with full RTL.
- "Ask the twin" chat for free-text questions answered only from tool outputs + docs.
- Road-pressure proxy layer on Sheikh Zayed Road segments (synthetic, labelled).
- Booth/kiosk mode: auto-plays a scenario loop when idle 60 s.

## WON'T (this week)
- Real-time feeds, personal data, payments, mobile app, SUMO city-scale microsimulation, any claim of operational use.

## Demo flow (the one that must never break)
1. Landing: 3D corridor, headline "Predict the crowd before it arrives."
2. Load scenario "Dubai Future Week — Day 1 (18 Nov), 9:30 start, 6:00 pm exit surge".
3. Timeline scrub → Emirates Towers & World Trade Centre stations turn amber/red at exit peak.
4. "Plan interventions" → agent returns 3 ranked options with numbers + sources.
5. Approve 2 → re-simulation: red station-hours drop; scoreboard shows the delta.
6. "Evidence" panel: backtest accuracy vs baseline, data sources, SYNTHETIC badges, human-approval log.

## Success metrics (shown on poster, all from eval/results)
- Forecast: MASE < 1.0 vs seasonal-naive on held-out weeks; sMAPE reported per station.
- Event uplift capture: error on event days specifically (report honestly even if worse).
- Simulator: % reduction in over-capacity station-hours for the demo scenario (labelled simulated).
- Agent: % of recommendations whose numbers exactly match tool outputs (target 100%); p95 latency.
