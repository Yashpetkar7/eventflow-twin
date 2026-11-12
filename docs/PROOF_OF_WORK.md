# EventFlow Twin — proof of work (write-up, metrics, LinkedIn post, CV bullets)

Written 12 Nov 2026 for use **after the exhibit** (RTA R&D & Innovation Zone, 18–21 Nov 2026). Every number below is
copied from a file in `eval/results/`, `docs/metrics.md`, the test runners or git history; the source is next to it.
Re-run before posting if anything changed: `python tasks.py eval-fast`, `python -m pytest --collect-only -q`,
`cd apps/web && npx playwright test --list`, `python scripts/ui_metrics.py`.

House rules for anything public: say **prototype**, **synthetic demand** (until RTA ridership is ingested), **simulated**
results, and **"designed for / aligned with RTA's priorities"** — never "used by" or "approved by" RTA. No RTA logo.

## 1. The project in one paragraph
EventFlow Twin is an interactive 3D digital twin of Dubai's Sheikh Zayed Road / Trade Centre metro corridor that
forecasts station crowding around big events (headline scenario: GITEX Global 2025 at Dubai World Trade Centre) and
lets a planning agent propose responses: extra trains, wayfinding to the next station, feeder shuttles, robotaxi
staging, staggered exits, entry metering and extended service hours. A deterministic simulator computes every number,
an automatic check rejects any explanation containing a number the simulator did not produce, and nothing is applied
until a human approves it. It runs fully offline on a laptop with a touch screen for the exhibit, and as a web app.
Team: Krishna Mathur (lead), Atharva Soundankar, Yash Petkar, MAIB, SP Jain School of Global Management, Dubai.

## 2. Verified metrics
| What | Value | Source |
|---|---|---|
| Plan options whose every number traced to the simulator | **48 of 48** (number faithfulness 1.0), 20 gold scenarios in English and Arabic, schema validity 1.0 | `eval/results/agents_20261112-181449.json` |
| Top plan never pushes another station over the line | 1.0 (all scenarios) | same file, `top_no_new_hotspot` |
| Prompt-injection attacks that changed a plan | **0 of 15** (8 English, 4 Arabic, 3 mixed) | `eval/results/redteam_20261112-181451.json` |
| Simulator property checks | **139**, pass rate 1.0, rider conservation error 0 | `eval/results/simulator_20261112-181445.json` |
| Forecast backtest (LightGBM quantile vs seasonal naive), **synthetic data** | MASE **0.78 vs 0.97**; 80 % interval coverage 0.81; n = 8,904 held-out rows | `eval/results/forecast_20261112-1814.json` |
| 3D twin performance | **60 fps** at 1920×1080, all layers on (Apple M4 Pro, Chrome) | `docs/metrics.md` ← `eval/results/ui/fps.json` |
| Offline | **0** requests leave the laptop during load, an AI plan and a language switch | `docs/metrics.md` ← `eval/results/ui/network.json` |
| 3D scene | 11,196 OpenStreetMap building footprints (1,175 with OSM heights) | `docs/metrics.md` |
| Live web demo under load (previous version) | 20 visitors at once, forecast + AI plan: **40/40** requests OK, p95 **1.8 s** | `eval/results/load_20261112-1821.json` |
| Automated tests | **130** Python tests, **20** browser (Playwright) tests, CI eval gate on every push | `pytest --collect-only`, `playwright test --list`, `.github/workflows` |
| Build history | 41 commits, 11–12 Nov 2026; API contract v1.8.0 | `git log`, `contract/VERSION` |

**Not measured yet (say so if asked):** accuracy on real RTA ridership (the ingest is built, data being downloaded);
touch-monitor fps at the booth; live-language-model cost and latency (GPT-5 path tested with a fake client only).

## 3. Honest limitations
- Station demand is **synthetic** and labelled on screen; the metro timetable (GTFS) and the 3D city (OpenStreetMap) are
  real. The forecast shown on screen is a weekday profile plus an event-surge model; LightGBM is only in the backtest.
- Event attendance, the share of visitors taking the metro and how full trains arrive are assumptions you can change.
- 9,724 of the 11,196 building heights are estimated.
- Results are simulated; nothing has been validated against an operational RTA system.

## 4. Write-up (for a portfolio page or the README "Results" section)
**Problem.** Big events squeeze thousands of metro trips into a few hours at a few stations. GITEX Global 2025 was
expected to draw over 200,000 visitors to Dubai World Trade Centre in five days. Planners need to know where capacity
breaks before it happens, and which response works.

**What we built.** A digital twin a visitor operates on a touch screen: pick an event, watch station crowding build up
hour by hour, ask a planning agent for options, approve or reject. The agent proposes from a fixed, bounded menu; a
deterministic simulator measures each option in 15-minute steps; options are ranked by riders relieved minus a cost
proxy; every number in every explanation is checked against the simulator. It shows the crowd size at which each
station tips over, because the answer depends on how full trains already are. Bilingual English/Arabic, offline.

**How we kept the AI honest.** Numbers only come from tools. An evaluation gate in CI checks forecast accuracy,
simulator properties, number faithfulness on 20 gold scenarios and 15 prompt-injection attacks; a build fails if any
drops. The optional language model (OpenAI GPT-5 or Claude) sits behind the same checks, with the deterministic
planner as the offline fallback.

**What's next.** Calibrate on RTA's open metro ridership (data.dubai), then a pilot on one real event with planners.

## 5. LinkedIn post draft (post after 21 Nov; ~190 words)
> What happens to a metro station when 40,000 people leave an expo hall at the same time?
>
> At the RTA R&D & Innovation Zone (18–21 Nov) our team showed EventFlow Twin: a 3D digital twin of Dubai's Sheikh
> Zayed Road metro corridor that forecasts station crowding around big events and lets a planning agent propose
> responses (extra trains, wayfinding, feeder shuttles, entry metering), which a human then approves or rejects.
>
> The part I'm proudest of is how we kept the AI honest. A simulator computes every number. An automatic check
> traced every figure in 48 of 48 plan options back to the simulator, and 0 of 15 prompt-injection attacks changed
> a plan. 130 Python and 20 browser tests run in CI, and the twin runs fully offline at 60 fps.
>
> It's a student research prototype on synthetic demand, designed around RTA's AI Strategy priorities, not an RTA
> system. Next step: calibrating on RTA's open ridership data.
>
> Thanks to Dr. Rachit Garg and my teammates Atharva Soundankar and Yash Petkar.
>
> [screenshot: submission/images/final/2_station_closeup_ai_options.png] · [link: repo or demo, once approved]
>
> #DigitalTwin #AgenticAI #Dubai

Before posting: confirm Dr. Rachit is happy to be named, that the repo/demo link may be public (K1), and that
"showed at the RTA R&D & Innovation Zone" is true (only if the nomination was accepted and you exhibited).

## 6. CV bullets — pick one per variant (25–35 words, no em dashes)
**AI/ML Analyst**
1. Led a three-person team building EventFlow Twin, an agentic AI digital twin of Dubai's metro corridor (FastAPI, React Three Fiber, LightGBM), with 130 Python and 20 browser tests and a CI evaluation gate.
2. Built a number-verified planning agent over a deterministic crowd simulator; every figure in 48 of 48 plan options traced to the simulator, and 0 of 15 prompt-injection attacks succeeded in English and Arabic.
3. Designed an evaluation gate in CI covering forecast backtests (LightGBM MASE 0.78 vs 0.97 seasonal baseline, synthetic data), 139 simulator property checks, agent faithfulness and red-team suites for a metro twin.

**AI Business Analyst**
1. Turned an event-crowding problem on Dubai's Sheikh Zayed Road metro corridor into an interactive decision tool where planners compare simulated responses and approve them, exhibited as a prototype aligned with RTA's AI priorities.
2. Led a three-person student team from brief to a working, tested prototype, writing the requirements, task split and nomination, with a human approval step and an audit log for every AI recommendation.
3. Framed AI trust for transport stakeholders: every number in AI plans traced to a simulator (48 of 48 options), synthetic data labelled on screen, and an offline kiosk running at 60 fps.

Notes: bullet AI-BA 1 says "exhibited" — keep only if you did. Mirror keywords from a job description when you have
one. The build used Claude Code as a coding assistant; say so if asked how a team of three shipped this so quickly.
