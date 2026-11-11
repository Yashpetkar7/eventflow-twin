# Nomination content — copy into the RTA template (give to Dr. Rachit; he submits)

> A filled draft PDF already exists: `submission/EventFlow_Twin_RTA_Nomination_DRAFT.pdf` (regenerate with `python submission/tools/fill_template.py` after editing the text in that script). Keep it private; it is based on the RTA template.

> Placeholders: [ ] = you fill; [METRIC] = fill only from docs/metrics.json after Phase 6. If a metric is not ready by 13 Nov, write "being validated – results at exhibit".

## Section 1 — Nomination profile
**University / Institution:** SP Jain School of Global Management, Dubai — Master of Artificial Intelligence in Business (MAIB), September 2025 batch

**Project / Research title:** EventFlow Twin: Agentic AI for Event-Ready Mobility in Dubai

**Lead contact:** [Dr. Rachit Garg, Assistant Professor (AI & Data Science), rachit.garg@spjain.org — confirm with him] · Student lead: Krishna Mathur, +971 50 194 6921, krishna.as25dxb018@spjain.org

**Project team and partners:** Students (MAIB, Sep 2025 batch): Krishna Mathur (lead – data science, AI agents, build), Atharva Soundankar, Yash Petkar. Supervisor: Dr. Rachit Garg (to confirm). Data: Dubai Pulse / RTA open data, OpenStreetMap. No industry funding.

**Type of exhibit:** Interactive digital twin demonstrator: a live 3D twin of the corridor on a touch screen that visitors operate themselves (choose an event, see the crowd build, approve AI plans), plus an A1 research poster.

**Transport and mobility domain:** Public transport (metro), event mobility, congestion management, multimodal integration (shuttles, robotaxis), accessibility.

**Development stage:** Prototype (lab validation on historical open data and labelled synthetic scenarios).

**Executive summary (146 words; limit 100–150; headline scenario GITEX Global 2025; written around RTA AI Strategy KPIs):**
Large events concentrate thousands of metro trips into a few hours at a few stations, causing crowded platforms and road congestion. EventFlow Twin is an interactive digital twin demonstrator that visitors operate on a touch screen. Its headline scenario replays GITEX Global 2025 at Dubai World Trade Centre: using RTA open data and the official metro timetable, it forecasts station crowding along the Sheikh Zayed Road / Trade Centre corridor and plans the response before the crowd arrives. It is designed around three RTA AI Strategy priorities. Congestion reduction: it shows where and when stations exceed comfortable capacity and measures how much each intervention – extra trains, feeder shuttles, robotaxi staging, staggered exits – cuts over-capacity station-hours. Agentic AI: AI agents propose and compare complete plans, while a deterministic simulator produces every figure. Human approval: no plan is applied until a planner approves it, and every decision is logged.

## Section 2 — Solution and supporting visuals
**Mobility challenge / opportunity:**
Events such as GITEX Global – expected to draw upwards of 200,000 visitors to Dubai World Trade Centre over five days in October 2025 – concentrate tens of thousands of trips into a few hours at a handful of stations. Overcrowded platforms, long queues and road congestion reduce safety and visitor experience. Planners need earlier, evidence-based answers to "where and when will capacity be exceeded, and what is the best response?" Beneficiaries: event and operations planners, metro and bus operators, visitors and residents – especially families and People of Determination who benefit most from avoiding peak crowding.

**Proposed solution and pioneering element:**
How it works: (1) forecast hourly entries and exits per station with uncertainty bands; (2) add an event surge from venue, timing and attendance; (3) detect hotspots where load exceeds 85% of practical capacity; (4) AI agents propose intervention bundles from a defined menu; (5) a deterministic simulator measures each bundle's effect; (6) a human approves, and the twin re-simulates before/after.
Headline scenario: GITEX Global 2025, Day 1 (13 October 2025, 10:00–17:00) at Dubai World Trade Centre, beside World Trade Centre metro station – a real event on the corridor that the twin replays and that will be checked against the actual ridership once it is ingested. Dubai Future Week 2026 is the forward-looking scenario. Because the answer depends on how full trains already are when they arrive, the twin shows the crowd size at which each station tips over comfortable capacity, rather than one tuned number.
What is new: event-aware, multimodal what-if planning with agentic AI that is auditable by design – the AI cannot invent numbers (all figures come from simulation tools and are automatically verified), and nothing is "applied" without human approval ("human leads, AI enables"). Bilingual Arabic/English interface.

**Key technical features:**
Python, LightGBM quantile forecasting with UAE calendar features (incl. the 2022 weekend change); transparent event-surge model with timing profiles per event type, calibrated against GITEX 2025 ridership as the data becomes available; capacity from RTA's official GTFS timetable, per station and direction; deterministic intervention simulator with property tests; LangGraph multi-agent workflow with JSON-schema-constrained proposals and a number-verification step; FastAPI; Next.js + deck.gl 3D map; touch-screen kiosk mode; Arabic/English RTL; offline demo mode; continuous evaluation gate (forecast accuracy, number faithfulness, prompt-injection tests). Data: RTA open data (official GTFS timetable; metro ridership from Dubai Pulse / Data.Dubai) + clearly labelled synthetic and assumption-based scenarios; aggregated, no personal data. IP: original student work; [no registered IP].
Evidence: forecast MASE vs seasonal baseline [METRIC]; simulated reduction in over-capacity station-hours for the GITEX 2025 scenario [METRIC] (simulated); crowd size at which World Trade Centre exceeds comfortable capacity, by assumed free space on arriving trains [METRIC – eval/results/sensitivity_*.json]; agent number-faithfulness [METRIC].

**Supporting pictures:** submission/images/ (1_hero, 2_options, 3_test, 4_architecture) – already placed in the filled PDF. ⚠️ The current concept renders still show the Dubai Future Week scenario; replace them with real GITEX 2025 screenshots once the prototype runs (see IMAGE_SHOTLIST.md), and regenerate the PDF.

## Section 3 — Exhibition and logistics
**Display footprint and dimensions:** Tabletop. Visitor touch screen (our own 24–27" touch monitor) + laptop + A1 poster stand (59.4 × 84.1 cm). Optional venue screen ≥ 50" for an attract loop. Table ~1.8 m × 0.8 m. Total weight < 15 kg.

**Utilities and connectivity:** 2 × standard 13A UAE sockets (or one + power strip), < 300 W total. Internet not required (fully offline demo); Wi-Fi optional. HDMI input to venue screen if provided. No audio required. Normal ambient lighting.

**Installation and dismantling:** 30 minutes install, 15 minutes dismantle. Tools: none. Carried by hand. 1 person.

**Safety, security and approvals:** No moving parts, no lasers, no liquids, no sharp edges. Only standard consumer laptop/monitor batteries. Cables taped down. Visitors use the touch screen under team supervision; screen wiped regularly. No personal data collected from visitors.

**Transport and storage:** Hand-carried by the team daily; no crate or storage needed. Daily check: 10 minutes.

**On-site representative(s):** Krishna Mathur (lead presenter), Atharva Soundankar, Yash Petkar – MAIB students, English; rota so 2 are always on the stand. Dr. Rachit Garg – faculty supervisor (to confirm). Availability: both periods. Arabic: bilingual UI and poster.

**Preferred participation dates:** Both periods (flexible to RTA's preference).

**Additional requirements or constraints:** Results labelled as research prototype using public open data and synthetic scenarios; not an operational RTA system. Photography welcome. University branding on poster.
