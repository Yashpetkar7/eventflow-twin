# Project discovery — EventFlow Twin

Written 17 Nov 2026 from the repository at `main` `7f33270` (contract 1.15.0, live on
https://eventflow-twin-roan.vercel.app). Every figure below comes from a file named next to it. Each claim is marked
**[repo]** (seen in code or docs), **[measured]** (an eval result file), **[source]** (an external public source,
linked) or **[assumption]**.

## 1. Repository intelligence

| Item | Finding |
|---|---|
| Remote and branch | `github.com/Yashpetkar7/eventflow-twin`, `main` tracks `origin/main`, level, clean tree **[repo]** |
| Size of recent work | 21 commits merged on 16–17 Nov (PRs #38–#52), decisions #129–#142 **[repo]** |
| Languages | Python 3.12 (API, models, evals), TypeScript (Next.js web app) **[repo]** |
| API | FastAPI, Pydantic v2, typed contract 1.15.0 exported to `contract/openapi.json` and TypeScript types **[repo]** |
| Agents | 18 agents in five layers plus two standing agents, on a LangGraph `StateGraph` (`apps/api/eventflow/agents/`, 3,167 lines) **[repo]** |
| Deterministic tools | forecast, 15-minute fluid-queue simulator, exact break point, road-pressure proxy **[repo]** |
| Web | Next.js App Router, react-three-fiber 3D twin from OpenStreetMap and Overture, English and Arabic (RTL), touch kiosk **[repo]** |
| Persistence | append-only, hash-chained decision log; chains, users and sessions in SQLite or Postgres **[repo]** |
| Delivery | Docker and compose, CI with eval gate, Playwright UI job, offline image smoke test **[repo]** |
| Tests | 260 pytest tests, 59 Playwright tests **[repo]** (`pytest --collect-only`, `playwright test --list`) |
| Open work | issues #41–#44 (tablet kiosk, real-device checks, Arabic review, booth laptops) **[repo]** |

**Sync status on 17 Nov:** local `main` was 21 commits behind with no local changes; fast-forwarded to `7f33270`.
No conflicts, nothing overwritten.

## 2. What the project does

EventFlow Twin is an agentic AI digital twin of the Dubai Metro Red Line between Max and Business Bay (six stations
along Sheikh Zayed Road / Trade Centre). For a large event it:

1. forecasts station demand per hour with an uncertainty band, adding the event's arrival and exit surge;
2. simulates every station in 15-minute steps against the capacity of RTA's official GTFS timetable;
3. lets a team of agents diagnose the hotspot, propose and size measures (extra trains, wayfinding, metering, staggered
   exit, feeder shuttles, robotaxis), test them in the simulator, criticise them on seven named criteria and replan;
4. puts one recommendation in front of a human, who approves or rejects it; nothing is applied before that, and the
   decision is logged first;
5. drafts the passenger notice and operations briefing in English and Arabic (never sent automatically).

A standing Watcher looks three hours ahead on the scenario clock and starts the team by itself (the event chain),
and a duty shift works a whole event day with incidents (train fault, rain, heat, bigger crowd) step by step.

## 3. The problem it is attempting to solve

**Mobility problem [repo, source].** Large events concentrate tens of thousands of trips into a few hours at a few
stations. The question an operations planner faces is "where and when will capacity be exceeded, and what is the best
response, decided early enough to act?". RTA already analyses event traffic (its Transport Data Analysis Laboratory
analysed GITEX 2025, [source](https://www.dubaieye1038.com/news/local/dubai-launches-transport-data-lab-to-improve-traffic-management)).

**Who experiences it.** Event visitors and daily riders (crowded platforms, long waits, people of determination who
need step-free access); metro, bus and event operations planners; event organisers.

**Why existing tools fall short [assumption, stated as such].** Timetable and crowd tools answer "what is happening";
they do not propose, test and compare complete multimodal responses before the event, and a general-purpose chat
assistant cannot be trusted with figures. The project's answer: agents choose and argue, a deterministic simulator
produces every number, and a human decides.

## 4. What is implemented, incomplete and weak

| | Status |
|---|---|
| Forecast + event surge, simulator, break point, road proxy | built and tested (139 simulator property checks, `simulator_20261116-204519.json`) |
| 18-agent team on LangGraph, critic C1–C7, replan, stress test, verifier | built; 132 of 132 plan options with faithful numbers over 60 scenarios (`agents_20261116-204539.json`) |
| Watcher, event chain, duty shift with incidents | built; 15 of 15 shifts honest and terminating (`incidents_20261116-204848.json`) |
| Kiosk story with the duty step, workspace, rider page, duty inbox | built; 59 Playwright tests |
| Real RTA ridership | **incomplete**: 10.48 M rows read, but the open taps have no time of day, so an hourly panel cannot be built (`ridership_check_20261112-1947.json`); demand on screen stays synthetic and labelled |
| Live language model | optional (`DEMO_MODE=live`); the booth replays recorded answers or uses the code policy |
| Memory across missions | **not built**: each mission starts fresh; past human decisions are logged but not used |
| Voice | **not built** |
| Kiosk at tablet width | **weak**: buttons about 27 px at 768 px (issue #41) |

**Technically weak points.** Demand is synthetic, so accuracy against reality is unmeasured. Routing between agents
is code with a budget, not a model's choice. The injection screen's patterns were written with their test set in
view (in-sample). Incident effects are assumptions.

## 5. What "genuinely agentic" means here, and what is reused

The system already has the parts the brief asks for: an orchestrator (Supervisor) with a budget and replan, a planning
layer (four specialists that size their own measures, a Composer), tool execution (every proposal is simulated),
evaluation (Critic, Stress test, Verifier), agent-to-agent messages (briefs, proposals, objections), a self-triggering
event chain, persistent chain state, a hash-chained decision log, a live event stream and a per-step trace.

**Reuse everything.** Nothing needs rebuilding. The gaps worth closing are in `IMPLEMENTATION_ROADMAP.md`: memory of
past human decisions (a Memory agent), and, only if the booth asks for it, voice.

**A deliberate design choice, not a gap.** The brief asks for reasoning and tool selection to be "AI-driven". Here a
model may propose, size and explain, but the routing and every figure are code. That is what lets the system state,
measured, that no plan text contains a number the simulator did not produce, and that no prompt-injection case
changed a plan (0 of 53, `redteam_20261116-204631.json`). For a transport operator this is the right trade.

## 6. Relevance to RTA

- **Agentic AI:** RTA's updated AI Strategy (launched 1 Nov 2026) puts agentic AI at its centre
  ([source](https://mediaoffice.ae/en/news/2026/novemebr/01-11/al-tayer-launches-rta-updated-ai-strategy)).
- **Event mobility:** RTA already studies event traffic (GITEX 2025, source above); the twin's headline scenario is
  GITEX Global 2025 Day 1 at Dubai World Trade Centre.
- **Multimodal and autonomous:** the planner can stage robotaxis and feeder shuttles alongside metro measures; Dubai's
  robotaxi service is live ([source](https://www.wam.ae/en/article/c1t9txb-dubai-robotaxi-surpasses-million-kilometres)).
- **Human leads, AI enables:** nothing is applied without approval; every decision is logged and tamper-evident.

Wording rule kept everywhere: "designed for" or "aligned with" RTA priorities — not an RTA system, not endorsed by RTA.

## 7. Exhibition format

The repository already contains three ways in, and the right booth format is the **touch kiosk on a large landscape
screen**, with the workspace on a presenter laptop. Reasons: RTA asks for interactive demonstrators; the kiosk runs
fully offline (no venue Wi-Fi needed, `docs/metrics.md`); a visitor can go from "pick an event" to "approve a plan"
in one to three minutes without a guide; the 60-second show plays by itself as an attract loop. A tablet is not
recommended until issue #41 is fixed.
