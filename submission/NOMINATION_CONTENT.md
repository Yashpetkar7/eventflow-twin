# Nomination content — copy into the RTA template (give to Dr. Rachit; he submits)

> **v2 draft (12 Nov 2026):** wording corrected to match what the build does and the four concept pictures replaced
> by real screenshots (`submission/images/final/`). Regenerate:
> `python submission/tools/fill_template.py <template-or-previous-draft.pdf> submission/EventFlow_Twin_RTA_Nomination_v2_DRAFT.pdf`
> (needs `pip install reportlab pypdf pillow`). The PDF is git-ignored: it is based on the RTA template — keep it private.
> The text in that script is the source of truth; this file mirrors it.

> **Where each figure comes from** (re-check before sending if the code changed):
> - 78 % / 92 % / 70 % peak load, top plan "guide 35 % to Emirates Towers": `POST /agent/plan` for `gitex2025_d1`
>   (normal and `weather: hot`), offline planner, synthetic baseline.
> - About 44,400 visitors (break point, World Trade Centre, default train fullness): `POST /breakpoint` for `gitex2025_d1`.
> - MASE 0.78 vs 0.97: `eval/results/forecast_20261112-0918.json` (LightGBM backtest vs seasonal naive, synthetic data).
> - 48 of 48 plan options with faithful numbers: `eval/results/agents_20261112-163846.json`.
> - 0 of 15 prompt-injection attacks succeeded: `eval/results/redteam_20261112-163848.json`.

## Section 1 — Nomination profile
**University / Institution:** SP Jain School of Global Management, Dubai — Master of Artificial Intelligence in Business (MAIB), September 2025 batch

**Project / Research title:** EventFlow Twin: Agentic AI for Event-Ready Mobility in Dubai

**Lead contact:** [Dr. Rachit Garg, Assistant Professor (AI & Data Science), rachit.garg@spjain.org — confirm with him] · Student lead: Krishna Mathur, +971 50 194 6921, krishna.as25dxb018@spjain.org

**Project team and partners:** Students (MAIB, Sep 2025 batch): Krishna Mathur (lead – data science, AI agents, build), Atharva Soundankar, Yash Petkar. Supervisor: Dr. Rachit Garg (to confirm). Data: RTA open data (official GTFS metro timetable), OpenStreetMap; station demand is synthetic and labelled until RTA ridership (Dubai Pulse) is obtained. No industry funding.

**Type of exhibit:** Interactive digital twin demonstrator: a live 3D twin of the corridor on a touch screen that visitors operate themselves (choose an event, see the crowd build, approve AI plans), plus an A1 research poster.

**Transport and mobility domain:** Public transport (metro), event mobility, congestion management, multimodal integration (shuttles, robotaxis), accessibility.

**Development stage:** Prototype (working software; lab validation on RTA's official timetable and clearly labelled synthetic demand scenarios).

**Executive summary (limit 100–150 words; headline scenario GITEX Global 2025; written around RTA AI Strategy KPIs):**
Large events concentrate thousands of metro trips into a few hours at a few stations, causing crowded platforms and road congestion. EventFlow Twin is an interactive digital twin demonstrator that visitors operate on a touch screen. Its headline scenario replays GITEX Global 2025 at Dubai World Trade Centre: using RTA's official metro timetable and labelled synthetic demand, it forecasts station crowding along the Sheikh Zayed Road / Trade Centre corridor and plans the response before the crowd arrives. It is designed around three RTA AI Strategy priorities. Congestion reduction: it shows where and when stations exceed comfortable capacity and measures how much each intervention – extra trains, feeder shuttles, robotaxi staging, staggered exits – cuts over-capacity station-hours. Agentic AI: a planning agent proposes and compares complete plans, while a deterministic simulator produces every figure. Human approval: no plan is applied until a planner approves it, and every decision is logged.

## Section 2 — Solution and supporting visuals
**Mobility challenge / opportunity:**
Events such as GITEX Global – expected to draw upwards of 200,000 visitors to Dubai World Trade Centre over five days in October 2025 – concentrate tens of thousands of trips into a few hours at a handful of stations. Overcrowded platforms, long queues and road congestion reduce safety and visitor experience. Planners need earlier, evidence-based answers to "where and when will capacity be exceeded, and what is the best response?" Beneficiaries: event and operations planners, metro and bus operators, visitors and residents.

**Proposed solution and pioneering element:**
How it works: (1) forecast entries per station in 15-minute steps with uncertainty bands; (2) add the event surge from venue, timing and attendance; (3) flag station loads above 85% of practical capacity; (4) a planning agent proposes intervention bundles from a defined menu; (5) a deterministic simulator measures each; (6) a human approves and the twin shows before/after.
Headline scenario: GITEX Global 2025 Day 1 at Dubai World Trade Centre (to be checked against real ridership). With 40,000 assumed visitors World Trade Centre peaks at 78% load; the twin shows it tips over at about 44,400. On a hot day it reaches 92%, and the top plan (guide 35% of riders to Emirates Towers) brings it to 70% – simulated, synthetic baseline.
What is new: event-aware, multimodal what-if planning with agentic AI that is auditable by design – the AI cannot invent numbers (all figures come from simulation tools and are automatically verified), and nothing is "applied" without human approval ("human leads, AI enables"). Bilingual Arabic/English interface.

**Key technical features:**
Python; weekday-profile quantile forecast with UAE calendar (incl. the 2022 weekend change) plus a transparent event-surge model, to be calibrated on GITEX 2025 ridership (a LightGBM quantile model is backtested: MASE 0.78 vs 0.97 for the seasonal baseline, synthetic data); capacity from RTA's official GTFS timetable per station and direction; exact break-point analysis; deterministic 15-minute simulator with property tests; planner with JSON-schema-checked proposals and automatic number verification – deterministic offline, with an optional Claude proposer/explainer behind the same checks; FastAPI; Next.js + react-three-fiber 3D twin built from OpenStreetMap; touch kiosk; Arabic/English RTL; runs fully offline, web version deployable. Evaluation gate in CI: forecast, simulator, number faithfulness (48 of 48 plan options) and prompt injection (0 of 15 attacks succeeded). Station aggregates only – no personal data. IP: original student work (not registered).

**Supporting pictures** (real 1920×1080 screenshots, `submission/images/final/`, made by `apps/web/tests/final_shots.mjs`; cropped in the PDF):
1. `1_overview_golden_hour.png` — 3D twin from OpenStreetMap – GITEX 2025 Day 1 scenario
2. `2_station_closeup_ai_options.png` — Planner options for World Trade Centre; every figure from the simulator
3. `6_break_point.png` — Break point: crowd size at which a station crosses 85% load
4. `3_after_approval_report.png` — After human approval: before/after report and decision log
Also available for the poster / LinkedIn: `4_night_downtown.png` (hypothetical downtown night), `5_arabic_view.png`.

## Section 3 — Exhibition and logistics
**Display footprint and dimensions:** Tabletop. Visitor touch screen (our own 24–27" touch monitor) + laptop + A1 poster stand (59.4 × 84.1 cm). Optional venue screen ≥ 50" for an attract loop. Table ~1.8 m × 0.8 m. Total weight < 15 kg.

**Utilities and connectivity:** 2 × standard 13A UAE sockets (or one + power strip), < 300 W total. Internet not required (fully offline demo); Wi-Fi optional. HDMI input to venue screen if provided. No audio required. Normal ambient lighting.

**Installation and dismantling:** 30 minutes install, 15 minutes dismantle. Tools: none. Carried by hand. 1 person.

**Safety, security and approvals:** No moving parts, no lasers, no liquids, no sharp edges. Only standard consumer laptop/monitor batteries. Cables taped down. Visitors use the touch screen under team supervision; screen wiped regularly. No personal data collected from visitors.

**Transport and storage:** Hand-carried by the team daily; no crate or storage needed. Daily check: 10 minutes.

**On-site representative(s):** Krishna Mathur (lead presenter), Atharva Soundankar, Yash Petkar – MAIB students, English; rota so 2 are always on the stand. Dr. Rachit Garg – faculty supervisor (to confirm). Availability: both periods. Arabic: bilingual UI and poster.

**Preferred participation dates:** Both periods (flexible to RTA's preference).

**Additional requirements or constraints:** Results labelled as research prototype using RTA open data (timetable) and synthetic scenarios; not an operational RTA system. Photography welcome. University branding on poster.
