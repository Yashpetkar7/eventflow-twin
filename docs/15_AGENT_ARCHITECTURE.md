# 15 — The agent team: architecture, orchestration, logic and measured accuracy

Written 16 Nov 2026 after a senior professor's review ("the UI is good; the backend is weak for an agentic-AI
challenge"). This document answers his questions one by one. Every figure is read from a file in `eval/results/`
(named next to it); nothing is typed from memory. Decisions: `docs/09_DECISIONS.md` #121–#125.

> One rule runs through all of it: **models decompose, propose, route and explain; code simulates, checks, ranks and
> decides** (CLAUDE.md rule 2). No language model ever produces a number a planner acts on. A human approves.

## 1. What is the architecture?

```
 Web app (Next.js + react-three-fiber twin, EN/AR, kiosk)        ← plays the mission's events back, offline-safe
        │  POST /agent/run(/stream) · /chain/start · /chain/{id}/decide · /agent/plan · /watch/scan · /agent/message · /agent/ask
 FastAPI (apps/api/eventflow/main.py)                           ← typed contract 1.14.0 (contract/openapi.json)
        │
 Agent engine (agents/engine.py)  ── LangGraph StateGraph  (fallback: same agents in sequence; classic planner kept)
        │
 Agents (agents/nodes.py, personas.py, standing.py)  ── 18 agents, 5 layers + 2 standing agents
        │  tools only — the agents never compute a figure themselves
 Deterministic tools:  forecast.build_forecast · simulate.simulate (15-min fluid queue, conservation-tested)
                       breakpoint.break_points (exact) · road.road_pressure · planner.PlanRun steps
        │
 Data: official RTA GTFS timetable (capacity), OpenStreetMap / Overture (scene), SYNTHETIC demand (labelled)
```

## 2. How many agents, and what does each do?

**18 agents in five layers, plus the human.** 8 of them may call a language model; 10 are code. The roster is served
by `GET /agent/roster` and drawn on screen (workspace "AI team" tab, kiosk planning step).

| Layer | Agent | Kind | Job |
|---|---|---|---|
| 1 Command | Supervisor | code | routes work between layers; enforces the budget (60 steps, 80 simulations, 12 model calls, 45 s); decides replan / stop / hand to the human |
| 2 Understand | Intake | model + code | turns the goal and the planner's typed constraints into an objective; screens free text for injection (logged, never followed); a model may *suggest* constraints, shown as "not applied" |
| | Forecast | code | hourly demand per station with its p10–p90 band |
| | Diagnosis | code | baseline simulation, every station over the threshold, the break point, road pressure, the target (worst station, quietest neighbour, shuttle target, hours) |
| 3 Propose | Rail service | model + code | extra trains, extended hours |
| | Station & crowd | model + code | entry metering, wayfinding to a quieter station |
| | Venue | model + code | staggered exit |
| | First & last mile | model + code | feeder shuttles, robotaxis |
| | Composer | code | cross-domain bundles from the specialists' measures, dedupe, ordering, the simulation budget; stronger and combined variants when the supervisor asks for a replan |
| 4 Test & challenge | Simulation | code | every bundle through the deterministic simulator |
| | Critic | code | named criteria C1–C7 (below), rejections with a reason, asks for a replan |
| | Stress test | code | re-simulates the kept options under changed assumptions |
| | Ranker | code | relief − λ·cost, never an option that moves the hotspot first, three different kinds |
| 5 Explain & govern | Explainer | model / template | the option texts in English and Arabic |
| | Verifier | code | every number in every text must be a simulator figure or an input, else the template is restored; blocks endorsement claims ("approved by RTA", Arabic forms) |
| | Messenger | model / template | after approval: passenger notice, signage line, operations briefing, EN + AR, **drafts never sent** |
| Standing | Watcher | code | duty view: looks 3 hours ahead on the scenario clock, raises alerts before a station crosses the line, hands over to the team |
| | Ask the twin | model + code | routes a question to one tool and answers with that tool's figures and run id; refuses anything off-topic or harmful |
| — | **You** | human | approve or reject each option; nothing is applied without that click (`POST /decisions`, append-only log) |

## 3. How are they orchestrated?

A **LangGraph `StateGraph`** (`agents/engine.py`, `langgraph==1.2.22`). The graph shown on screen is generated from
the compiled graph (`draw_mermaid`), not drawn by hand.

```
START → intake → forecast → diagnosis ─┬─(no station over the line)──────────────────────────────→ conclude → END
                                       └→ rail ┐
                                          station_crowd ├→ composer → simulation → critic → supervisor ─┬→ the four specialists (replan, ≤ 2)
                                          venue │                                                       └→ ranker ┬→ explainer ┐
                                          last_mile ┘                                                            └→ stress ───┴→ verifier → conclude → END

Since 1.14.0 (decision #133) events can be **messages** (`AgentEvent.to`): the supervisor briefs the specialists, each
specialist sends its sized proposal to the composer, the critic sends an **objection** to each specialist that can act
on what is still over the line, and the supervisor's replan edge goes back to the specialists (each one answers only
if an objection names it), not straight to the composer.
```

- **Conditional edges** for the supervisor (replan → specialists / rank) and after the diagnosis (act / nothing to do).
- **Fan-out / fan-in**: the four specialists run in parallel; the composer waits for all four. Explainer and stress
  test run side by side; the verifier waits for both.
- **Determinism under parallelism**: parallel agents never write shared state; they return their proposals and events,
  and the next agent merges them in roster order. The graph and the sequential engine produce identical events.
- **Budget**: the step budget is the recursion limit; the supervisor stops replanning when any budget is reached.
- **No checkpointer, no `interrupt()`**: the public site is stateless (Vercel). The human gate is the mission's
  `status: awaiting_human` + `POST /decisions`.
- **Fallbacks**: if LangGraph cannot be imported, the same node functions run in a plain loop (`seq`); the original
  single planner stays as `classic`. All three are gated to give identical plans.

## 4. On what logic do the agents act?

**Diagnosis.** The worst station is the one with the most 15-minute bins over the threshold, then the highest peak.
The target context fixes the hours (±1 h around the over-threshold hours), the quietest walkable neighbour, the
quietest station a shuttle can reach (≤ 8 km), the line and the menu's settings.

**Proposals (sized, since 1.14.0).** Each specialist owns its measures and works out *how much* from the simulator's
hourly rows at the diagnosed station (`planner.size_measures`): the riders per hour over the line (capacity × (load −
threshold)); rail: trains per hour now × load ÷ threshold → a headway; station & crowd: the share to walk away, capped by
the neighbour's room; last mile: shuttles = gap ÷ (bus capacity × trips per hour), capped by the receiving station's
room, robotaxis only for what shuttles cannot carry and only when the allowed fleet can close it; venue: exit spreads of
30/45/60/90 min tested in the simulator, the shortest that clears the hotspot. Single-domain bundles close the whole gap;
rail and last mile also offer a lighter half-gap size; cross-domain bundles give each specialist half. Everything stays
inside the hard bounds of `config/corridor.yaml` (minimum headway 2.5 min, at most 50 % redirected, 30 buses, 60
robotaxis, 15–90 min stagger, metering 0.5–0.95). A model can add at most two bundles of two measures per specialist;
anything outside the specialist's measures or the bounds is dropped before it is simulated.

**The critic's criteria** (reported on every option):

| | Criterion | Effect |
|---|---|---|
| C1 | every station under the threshold | goal (with C2, C3) |
| C2 | no new hotspot (no station pushed over the line) | goal; such options rank last but one |
| C3 | not worse overall | goal; such options rank last |
| C4 | longest wait ≤ 10 min | recommendation |
| C5 | road pressure not raised | recommendation |
| C6 | the planner's typed constraints (forbidden measures are never simulated; protected stations; cost cap) | forbidden → rejected; others: recommendation |
| C7 | holds under stress (≥ half the stress cases keep every station under the line) | recommendation |

**Recommendation (docs/17 WP3, decision #134).** The option put in front of the human is the first that passes every
applicable check C1–C7; else the first that passes C1–C3 with the most of C4–C7; else the one that passes the most
checks (ties: the plan's order). `Mission.recommendation` carries the rank, the basis and the failed checks; the card
says why. The plan's own order is unchanged.

If no tested plan meets C1–C3, the critic sends objections and the supervisor asks for a replan (at most two): for
the two most effective plans, the specialists named in the objections resize their own measures from the residual gap
(`PlanRun.revisions_for`) and add their measures aimed at what is still over the line; the composer assembles the
revised plan, the combinations and, last, every setting at its bound.

**Ranking.** score = riders relieved − λ·added cost (λ = 60 / 20 / 5 for priority cost / balanced / impact). Options
that make things worse go last, then those that move the hotspot; after a replan, plans that meet the goal first;
three different kinds of plan are offered, and a goal-meeting plan is always among them when one was found.

**Stress test.** Every kept option is re-simulated under: attendance × 1.10 and × 1.25, metro share 55 % and 65 %, the
other weather, and the corridor's real station totals (from the ridership check).

**Explanation and verification.** Template text with figures copied from the simulator, or a model's text that must
contain only those figures (and no endorsement claim) — otherwise the template is restored.

**Untrusted text.** Goal, notes and questions are data. Constraints come only from typed controls, so text cannot
change a simulation. Instruction-like text is logged as a finding.

## 5. How accurate are they? (measured)

| What | Result | Source |
|---|---|---|
| Every number on screen equals the simulator's | **1.0** (132 options, 60 scenarios EN/AR) | `agents_20261116-204539.json` |
| The three engines (LangGraph, sequence, classic) give identical options | **1.0** (60 scenarios) | `orchestration_20261116-204754.json` |
| Graph and sequence log identical agent events | **1.0** | same |
| Every offered option's simulation in the event log; budgets respected; all five layers act | **1.0 · 1.0 · 1.0** | same |
| Every critic objection answered by the specialist it names, in the next round | **1.0** (12 objections in 4 replanning missions) | same |
| The recommended option is the one the C1–C7 rule picks (independent re-implementation) | **1.0** (44 missions with options); all checks passed by the recommendation in 0.32 of them | same |
| Critic's C1–C3 verdicts vs an independent re-check from the simulator's hourly rows | recall **1.0**, precision **1.0** (1,007 plans) | `critic_20261116-204831.json` |
| When an exhaustive grid over the menu (≈ 48 plans per scenario) can clear every station, the team offers such a plan | **1.0** (22 of 22 hotspot scenarios) | `optimality_20261116-204831.json` |
| Riders relieved: gap between the team's best offer and the grid's best acceptable plan | **0** (mean and max) | same |
| First option's score (relief − λ·cost) as a share of the grid's best | **0.96** on average (0.80 before the specialists sized their measures, decision #133) | same |
| Prompt-injection and API attacks that succeeded (53 cases, EN/AR/mixed, all 10 OWASP agentic categories, both endpoints) | **0** | `redteam_20261116-204631.json` |
| Injection attempts the intake flags / legitimate goals it flags | **0.93** / **0** (in-sample: patterns written after reading the cases) | same |
| Ask the twin: off-topic and harmful questions refused / legitimate questions refused | **1.0** / **0** (40 questions EN/AR, in-sample) | `safety_20261116-204835.json` |
| Mission time offline (graph, no model), 95th percentile | **0.86 s** (60 scenarios; 0.36 s on 16 Nov afternoon before the sizing probes and replans, measured on a laptop running other servers) | `orchestration_20261116-204754.json` |
| Simulator property tests (conservation of riders, bounds, monotonicity) | **1.0** (139 checks, conservation error 0) | `simulator_20261116-204519.json` |
| Forecast backtest (SYNTHETIC data): LightGBM MASE vs seasonal naive | **0.78** vs 0.97; 80 % interval coverage 0.81 | `forecast_20261116-2045.json` |

**What "accuracy" can and cannot mean here.** The figures are exact by construction and gated at 1.0. What a model
proposes or writes is bounded and checked, not guaranteed: a model can propose a weak plan (the critic and ranker
judge it) or a bad sentence (the verifier replaces it). The forecast is only as good as its data, and the demand is
**synthetic** until RTA ridership is ingested; that is labelled everywhere.

**Language models.** With `DEMO_MODE=live` the eight model agents call the configured model (OpenAI GPT-5 family by
default; Claude supported). The booth and the public site replay answers recorded with `python tasks.py
record-missions` — only words are replayed; every simulation and check runs again — and say so on screen
("AI answers recorded <date> · <model>"). Without a recording each agent uses its code policy, and the screen says that
too. Live timing and token cost per agent are written to `eval/results/live/missions_*.json` when recorded.

### Incidents and the duty shift (contract 1.13.0, decision #128)

**Incident what-ifs.** A request may carry `incident: {type, hour}`: a train fault (the Red Line runs half its
scheduled trains for two hours), heavy rain or extreme heat (the weather what-if), or a bigger crowd (attendance × 1.3).
What an incident changes is fixed in `config/incidents.yaml` and resolved by the server; the client sends only the type
and the hour, and the forecast answers with the resolved figures and their source. A train fault leaves demand alone
and reaches the simulator as a service factor, so extra trains count from the reduced timetable. An incident is part of
the scenario, so every endpoint (simulate, watch, team, messenger, ask, break point) works on it without change.

**The duty shift on autopilot** (`POST /shift/next`, `agents/shift.py`). The standing Watcher and the planning team
work the scenario day one step at a time: the clock runs to the Watcher's next alert (never earlier than an incident's
hour), the team plans on top of the measures already approved, and the step returns with one option in the approval
inbox: the first that the critic says clears every station, else the plan's first. **Nothing is applied by the shift.**
The human's decision is logged first (`POST /decisions`); only then does the client add the measures and ask for the
next step. After an approval a station that is still over the line is a new alert; after a rejection the same alert is
not raised again. The shift ends "clear" only when nothing is over the line; otherwise it reports what remains for the
duty manager. The API keeps no shift state: the client carries the approved measures, the handled alerts and the clock.

**On the kiosk (decision #129).** After a visitor approves a plan, one optional step asks "What if a train breaks
down now?": a train fault at the event's last hour, the shift's first step, one Approve button, then the result. It
uses the same store actions as the workspace card; the fault day starts without the plan approved before it. It needs
the planning service, so it is not in the offline snapshot: without the service the step says so and the visitor
carries on.

| What | Result | Source |
|---|---|---|
| Same incident request → same run id and simulation; an incident never makes the day easier | **1.0 · 1.0** (15 shifts) | `incidents_*.json` |
| Each proposal's figures equal an independent simulation of the measures in place | **1.0** | same |
| Every shift ends; "clear" only when nothing is over the line; the shift writes no decision | **1.0 · 1.0 · 1.0** | same |
| Shifts with crowding that end with nothing over the line, all proposals approved | **1.0** (10 of 10; reported, not gated) | same |

## 6. Can we watch them work?

Yes. In the workspace, **AI team** tab: the five layers light up agent by agent as the mission plays, with a feed of
what each agent did and the simulator run behind every figure, the critic's C1–C7 table, the stress cases, the plans
tested and not offered with the reason, the budget and the measured accuracy above. On the kiosk the planning step
shows the same team at work (skippable). The Alerts tab shows the Watcher; the AI team tab has Ask the twin and, after
an approval, the Messenger's drafts. The same mission replays offline from the snapshot when the API is down.

Since #128 the Alerts tab also runs the **duty shift**: pick an incident (or none), start the shift, and the clock
runs to the first alert, where the team's recommendation waits with Approve and Reject. The AI team tab shows the
**debate** behind it: for each plan tested, the specialist's case with the simulator's figures, the critic's objection
by criterion, and the verdict. When the shift ends, the **operations brief** (a printable draft: incident, decisions,
before and after, the Messenger's drafts in English and Arabic) opens from the same card. The duty shift and incidents
need the planning service: they are not in the offline snapshot.

## 7. Limits (stated, not hidden)

- Demand is synthetic; capacity and timetable are real (RTA GTFS); several model parameters are assumptions
  (`config/corridor.yaml`, labelled `[ASSUMPTION]`).
- The intake's injection screen and the ask router's patterns were written with their test sets in view (in-sample).
- C4–C7 decide the recommendation (since 1.14.0); the plan's order itself is still relief − λ·cost.
- Incident figures (half the trains for two hours, 30 % more visitors) are assumptions for a what-if, not RTA data;
  rain and heat reuse the weather what-if, which applies to the whole event, not from the incident hour on.
- The duty shift asks about one recommendation at a time; a real control room would also weigh staff and rolling stock.
- The model path's quality depends on the recording; replans are code-only to keep a mission under the time budget.
- "Designed for / aligned with" RTA priorities — not an RTA system, not endorsed by RTA.

## 8. The event chain and the product layer (contract 1.14.0, decisions #133–#138)

- **Event chain** (`agents/chain.py`): `scenario.loaded` → Watcher → `alert.raised` → Supervisor (runs this team) →
  `plan.ready` → the human's inbox; the decision (logged first) → `decision.made` → Messenger (`drafts.ready`, never
  sent) and Watcher → the next alert or `day.ended`. `POST /chain/start`, `POST /chain/{id}/decide`, `GET /chain/{id}`.
  On screen: Alerts tab → "Event chain".
- **Live stream**: `POST /agent/run/stream` sends each agent event the moment it is logged; the workspace shows them
  as they arrive (paced for reading, never ahead of what happened).
- **Trace** (WP4): one span per agent step (`Mission.spans`), drawn on the AI team tab; exported over OpenTelemetry
  only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (Langfuse's OTLP endpoint works). LangChain is not used; LangGraph is.
- **Store, sign-in, roles**: chains, users and sessions in SQLite (offline) or Postgres (`DATABASE_URL`);
  `EVENTFLOW_AUTH=on` → bearer tokens, roles viewer < planner < admin; off by default so the booth is unchanged.
- **Tamper-evident decision log** (WP5): `prev`/`hash` on every record, `GET /decisions/verify`.
- **Self-hosted model**: `LLM_PROVIDER=local` + `LLM_BASE_URL` for an OpenAI-compatible server on the college's GPUs;
  `python -m eval.suites.gpu_benchmark [--llm]`; `docs/GPU_REQUEST.md`.
- **Docker and CI**: `Dockerfile`, `docker-compose.yml` (+ `docker-compose.saas.yml`), CI jobs `saas`, `docker`, `ui`.
