# RTA nomination — v4 (18 Nov 2026)

Replaces v3 (17 Nov). The text below is what `submission/tools/fill_template.py` prints into the template; that
script is the source of truth. Dr. Rachit submits; the team never sends the template or the PDF to RTA.

Make the PDF (it is git-ignored and stays private: it is built on RTA's template):

```
pip install reportlab pypdf pillow
python submission/tools/fill_template.py <template-or-previous-draft.pdf> <output.pdf>
```

Contact details come from `submission/tools/contact.local.json` (git-ignored), never from this repository.

## Where each figure comes from (re-run before sending if the code changes)

| Figure | Source (18 Nov 2026, contract 1.18.0) |
|---|---|
| 78 % peak at World Trade Centre, 40,000 visitors | `POST /forecast` + `POST /simulate`, `gitex2025_d1`, normal day |
| tips over at about 44,400 visitors | `POST /breakpoint`, `gitex2025_d1` |
| 92 % on a hot day; recommended plan 74 %, 6 of 6 applicable checks | `POST /agent/run`, `gitex2025_d1`, `weather: hot` (`recommended_rank` 3: staggered exit 45 min + 10 % wayfinding) |
| 18 agents: 8 can call a model, 10 code only | `POST /agent/run` → `counts` |
| MASE 0.77 vs 0.97 (served weekday-profile forecast vs seasonal naive, synthetic data) | `eval/results/forecast_20261118-1328.json` (`profile_mase`, `naive_mase`) |
| 139 simulator property checks | `eval/results/simulator_20261118-132804.json` |
| 132 of 132 plan options, 60 scenarios | `eval/results/agents_20261118-132814.json` |
| 0 of 53 attack cases | `eval/results/redteam_20261118-132841.json` |
| 15 of 15 incident shifts applied nothing without a human | `eval/results/incidents_20261118-132953.json` |
| 17 of 24 unseen phrasings routed correctly | `eval/results/assistant_20261118-134655.json` (`routing_accuracy_heldout`) |

Not claimed, on purpose: accuracy against real ridership (demand is synthetic), any language model running at the
stand (none is recorded; the demo runs on rules and code), voice-recognition accuracy, RTA endorsement.

## Section 1 — Nomination profile

**University / institution:** **SP Jain School of Global Management, Dubai** – Master of Artificial Intelligence in Business (MAIB), September 2025 batch; supervised by Dr. Rachit Garg, AI Initiatives

**Project / research title:** **EventFlow Twin: Agentic AI for Event-Ready Mobility in Dubai** – predicting and managing metro crowding around major events on the Sheikh Zayed Road / Trade Centre corridor

**Lead contact:** faculty lead Dr. Rachit Garg (to confirm); student lead Krishna Mathur (contact details only in the PDF).

**Project team and partners:** **Students (MAIB, Sep 2025 batch):** Krishna Mathur (lead – data science, AI agents, build), Atharva Soundankar, Yash Petkar. **Supervisor:** Dr. Rachit Garg. **Data:** RTA open data (official GTFS metro timetable), OpenStreetMap; station demand is synthetic and labelled until RTA ridership (Dubai Pulse) is obtained. **Industry partners / funders:** none – independent academic prototype.

**Type of exhibit:** **Interactive digital twin demonstrator:** a live 3D twin of the corridor on a touch screen that visitors operate themselves – choose or describe an event, see the crowd build, answer the AI team’s questions, edit and approve its plans – plus an A1 research poster.

**Transport and mobility domain:** Public transport (metro), event mobility and congestion management, multimodal integration (feeder buses, robotaxis), incident response, passenger safety and accessibility.

**Development stage:** **Prototype** (working software; lab validation on RTA’s official timetable and clearly labelled synthetic demand scenarios). Not connected to any RTA system.

**Executive summary (149 words):** Large events concentrate tens of thousands of metro trips into a few hours at a few stations. EventFlow Twin is an **agentic AI digital twin** that plans the response before the crowd arrives. It replays GITEX Global 2025 at Dubai World Trade Centre on RTA’s official metro timetable, with labelled synthetic demand. **Agentic AI:** 18 AI agents work like an operations room – a watcher raises the alert hours ahead, specialists for rail, stations, venue and last mile size their measures, a critic challenges every plan on seven criteria, and a deterministic simulator produces every figure. **Human-led:** the team asks the planner at decision points; nothing is applied until a human approves, and every decision is logged. People can type in English or Arabic to change the scenario. **Congestion reduction:** it shows where and when stations exceed comfortable capacity and how much each measure relieves them. Runs fully offline.

## Section 2 — Solution and supporting visuals

**Mobility challenge / opportunity:** Events such as GITEX Global – expected to draw upwards of 200,000 visitors to Dubai World Trade Centre over five days in October 2025 – concentrate tens of thousands of trips into a few hours at a handful of stations, causing crowded platforms, queues and road congestion. Planners need early, evidence-based answers: where and when will capacity be exceeded, and which response works best? **Beneficiaries:** operations planners, duty managers, operators, visitors and residents, including people of determination.

**Proposed solution and pioneering element:** **How it works:** (1) forecast station demand and add the event surge; (2) simulate every station in 15-minute steps against timetable capacity; (3) specialist agents propose measures sized to the gap; (4) the simulator tests each plan, a critic checks seven criteria, and the team replans when none meets the goal; (5) the team asks the human at decision points, who can edit, approve or reject. **Headline scenario (simulated, synthetic demand):** GITEX 2025 Day 1, 40,000 assumed visitors: World Trade Centre peaks at 78% of comfortable capacity and tips over at about 44,400. On a hot day it reaches 92%; the recommended plan (exits spread over 45 more minutes, 10% of riders guided to Emirates Towers) brings it to 74%, passing all 6 applicable checks.

**What is new:** agents that cannot invent numbers and that ask before they act; visitors type or tap on the kiosk. Arabic/English.

**Key technical features:** Python, FastAPI; LangGraph graph of 18 agents (8 can call a language model, 10 are code only); weekday-profile forecast with the UAE calendar (backtest MASE 0.77 vs 0.97 for the seasonal baseline, synthetic data); capacity from RTA’s official GTFS timetable; break-point analysis; deterministic 15-minute simulator (139 property checks); assistant with typed scenario changes, cited documents and graded confidence; Next.js + react-three-fiber 3D twin from open map data; touch kiosk with a built-in English/Arabic keyboard; fully offline on rules and code, language models optional behind the same checks. CI evaluation gate: number faithfulness 132 of 132 plan options (60 scenarios); 0 of 53 attack cases succeeded; 15 of 15 incident shifts applied nothing without a human; typed questions routed by word rules (17 of 24 unseen phrasings correct). Station aggregates only – no personal data. IP: original student work.

**Supporting pictures** (`submission/images/final/`):
1. `1_overview_golden_hour.png` — 3D twin from open map data, GITEX 2025 Day 1 scenario
2. `2_station_closeup_ai_options.png` — the AI team's options for World Trade Centre; every figure from the simulator
3. `7_kiosk_ai_keyboard.png` — kiosk: visitors type or tap to change the scenario (built-in English/Arabic keyboard)
4. `8_team_asks_the_visitor.png` — human in the loop: the team tests harder cases itself, then asks which to plan for

## Section 3 — Exhibition and logistics

**Display footprint:** **Tabletop.** Visitor touch screen (our own 24–27" touch monitor) + laptop + A1 poster stand. Optional venue screen ≥ 50" for an attract loop. Table approx. 1.8 m × 0.8 m. Total weight < 15 kg.

**Utilities and connectivity:** 2 × standard 13A UAE sockets (or one + power strip), < 300 W. **No internet required** (fully offline demo; the optional QR handoff uses the visitor’s own phone data). HDMI input if a venue screen is provided. No audio. Normal ambient lighting.

**Installation and dismantling:** Install 30 min, dismantle 15 min. No tools, no special access. Hand-carried, no crate. Done by our 3-person team; no technical staff needed from RTA.

**Safety, security and approvals:** No moving parts, lasers, liquids or sharp edges. Only standard consumer laptop/monitor batteries. Cables taped down. Visitors use the touch screen under team supervision; screen wiped regularly. No visitor data collected. No insurance or permits expected beyond standard venue rules.

**Transport and storage:** Hand-carried by the team each day; no delivery, crate or storage required. Daily 10-minute system check before opening; backup device and recorded demo video on hand.

**On-site representatives:** **Krishna Mathur** (lead presenter), **Atharva Soundankar** and **Yash Petkar** – MAIB students, English; rota so 2 are always on the stand. **Dr. Rachit Garg** – faculty supervisor (to confirm). Availability: both periods. Arabic: bilingual UI and poster.

**Preferred participation dates:** **Both periods:** 18–21 November at Emirates Towers and 23–25 November at RTA HQ (flexible to RTA’s preference).

**Additional requirements or constraints:** Research prototype using RTA open data (timetable) and clearly labelled synthetic / assumption-based scenarios – not an operational RTA system and not endorsed by RTA. Photography and filming welcome. University branding on poster. No confidential information.
