# RTA nomination — v3 draft (17 Nov 2026)

Updates `submission/NOMINATION_CONTENT.md` (v2, 12 Nov) for the second exhibition (23–25 Nov, RTA HQ) and for jury
questions. Since v2 the single planner became an 18-agent team, and the figures below changed with it. Dr. Rachit
submits; the PDF is made with `submission/tools/fill_template.py`, which still holds the v2 text.

**Where each figure comes from** (re-run before sending if the code changes):
- 78 %, 92 % and 74 %, and the recommended plan: `POST /agent/run` for `gitex2025_d1` (normal and `weather: hot`),
  `main` `7f33270`, synthetic baseline.
- About 44,400 visitors: `POST /breakpoint` for `gitex2025_d1`.
- 132 of 132 options: `eval/results/agents_20261116-204539.json`. 0 of 53 attacks: `redteam_20261116-204631.json`.
- MASE 0.78 vs 0.97: `forecast_20261116-2045.json`. 15 of 15 duty shifts: `incidents_20261116-204848.json`.

## Section 1 — Nomination profile

**Project title:** EventFlow Twin: Agentic AI for Event-Ready Mobility in Dubai

**University / faculty:** SP Jain School of Global Management, Dubai — Master of Artificial Intelligence in Business
(MAIB), September 2025 batch.

**Lead contact and team:** Supervisor Dr. Rachit Garg (to confirm). Students: Krishna Mathur (lead), Atharva
Soundankar, Yash Petkar. Contact details stay in the PDF, not in this public repository.

**Type of exhibit:** Interactive digital twin demonstrator: a 3D twin of the Sheikh Zayed Road corridor on a touch
screen that visitors operate themselves, with the AI agent team working on screen; plus an A1 research poster.

**Transport and mobility domain:** Public transport (metro), event mobility, congestion management, multimodal
integration (feeder shuttles, robotaxis), incident response, accessibility.

**Development readiness:** Working prototype, lab-validated on RTA's official timetable and labelled synthetic
demand. Not connected to any RTA system.

**Executive summary (148 words):**
Large events concentrate tens of thousands of metro trips into a few hours at a few stations. EventFlow Twin is an
agentic AI digital twin that plans the response before the crowd arrives. Its headline scenario replays GITEX Global
2025 at Dubai World Trade Centre on RTA's official metro timetable. A team of AI agents works like an operations room:
a Watcher raises the alert hours ahead, specialists for rail, stations, venue and first and last mile each size
their own measure, a critic challenges every plan on seven named criteria and sends it back for replanning, and a
deterministic simulator produces every figure. Nothing is applied until a human approves, and every decision is
logged in a tamper-evident record. It handles incidents such as a train fault. It runs offline in English and Arabic,
and is designed around RTA's priorities for agentic AI, congestion and human-led decisions.

## Section 2 — Solution and supporting visuals

**Mobility problem:** events such as GITEX Global (expected to draw upwards of 200,000 visitors over five days in
October 2025) squeeze many trips into short exit windows at a handful of stations, causing crowded platforms, long
waits and road congestion. Planners need early, evidence-based answers to "where and when will capacity be exceeded,
and which response works best?"

**Target beneficiaries:** metro, bus and event operations planners; duty managers; event visitors and residents,
including people of determination who need step-free routes.

**Proposed solution:** (1) forecast hourly station demand with an uncertainty band and add the event surge;
(2) simulate every station in 15-minute steps against timetable capacity; (3) the Watcher looks three hours ahead and
starts the team by itself; (4) four specialist agents propose measures sized to the gap; the composer builds plans;
(5) the simulator tests each, the critic checks seven criteria, the stress test tries harder assumptions, and the
supervisor asks for a replan when no plan meets the goal; (6) one recommendation goes to a human, who approves or
rejects it; (7) the messenger drafts the rider notice in English and Arabic (never sent automatically).

**Headline scenario (simulated, synthetic demand):** GITEX 2025 Day 1, 40,000 assumed visitors: World Trade Centre
peaks at 78 % of comfortable capacity and tips over at about 44,400 visitors. On a hot day it reaches 92 %; the plan
the team recommends (spread venue exits over 45 more minutes and guide 10 % of riders to Emirates Towers on foot)
brings it to 74 %, passing all seven checks.

**Pioneering features:** a multi-agent team that argues (briefs, proposals, objections, replans) rather than a single
chatbot; agents that cannot invent numbers (every figure in every text is checked against the simulator: 132 of 132
plan options); resistance to manipulation (0 of 53 prompt-injection attacks changed a plan); a self-triggering event
chain and an incident duty shift (15 of 15 shifts ended honestly, none applied anything without a human); bilingual
right-to-left interface; fully offline.

**Technical architecture and technology:** Python, FastAPI, LangGraph multi-agent graph with an identical sequential
fallback; deterministic forecast (LightGBM backtest MASE 0.78 vs 0.97 for a seasonal baseline, synthetic data),
simulator (139 property checks) and break-point analysis; optional language models (OpenAI, Anthropic or self-hosted)
behind the same checks; Next.js and a react-three-fiber 3D twin built from OpenStreetMap; SQLite or Postgres;
Docker; a continuous-integration evaluation gate. Station aggregates only, no personal data.

**Supporting visuals (4–5):**
1. Hero: `submission/images/final/1_overview_golden_hour.png` (3D twin, GITEX scenario).
2. Architecture: the Mermaid diagrams in `docs/AGENTIC_ARCHITECTURE.md` (§2 and §4), exported as images.
3. Prototype: `eval/results/ui/kiosk/22_duty_step.png` (the kiosk's train-fault step with the team's recommendation).
4. Prototype: `submission/images/final/2_station_closeup_ai_options.png` (options, every figure from the simulator).
5. Testing evidence: the results table in `docs/TESTING_AND_VALIDATION.md` §2.

## Section 3 — Exhibition and logistics

See `docs/EXHIBITION_SETUP.md` for the full sheet. In short: tabletop, about 1.8 m × 0.8 m; one 24–27" touch monitor,
a laptop and an A1 poster; two standard UAE sockets, under 300 W (estimate); **no internet needed**; 30 minutes to
install, 15 to dismantle; no moving parts; hand-carried daily; two team members on the stand; both periods.

**Additional constraints:** research prototype using RTA open data (timetable) and synthetic demand; not an RTA
system and not endorsed by RTA; results are simulated.
