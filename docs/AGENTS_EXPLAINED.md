# How the agents work — the version to explain to a professor

Written 16 Nov 2026 (contract 1.14.0, decisions #132–#138). The long technical form is `docs/15_AGENT_ARCHITECTURE.md`;
this page is the one to talk through. Every claim names the file that proves it.

## The one-sentence answer

**Eighteen agents on a LangGraph graph pass typed messages to each other; code simulates, checks and ranks; models
(when switched on) only propose and write; a human approves — and since 1.14.0 the whole loop can run as a chain of
events that triggers itself until a human decision is needed.**

## 1. What triggers the agents

There are two ways in. Both end at a human.

**a) A planner asks** — "Plan with AI agents" (workspace or kiosk) → `POST /agent/run` (or `/agent/run/stream`, which
sends each message to the screen the moment it happens).

**a′) A planner briefs the team in plain words** (since 1.16.0, decision #143) — AI plan → "Brief the team":

```
"Concert near Business Bay, Saturday 19:00–22:30, 17k people, no buses, keep Burj Khalifa calm"
   └─► POST /agent/brief ─► Intake reads it (its model if available, else word rules) ─► code checks every field
   └─► "Here is what I understood": station BBY · weekend · 19:00–22:30 · 17,000 · don't use shuttles · keep BKD calm
         each field shows the words it came from; YOU edit or remove fields, then "Confirm and plan"
   └─► the mission's first message: You → Intake "Your brief: … · you changed 1 field"
```

The model can only fill fields; a field whose quoted words are not in the brief is dropped (`agents/brief.py`,
`tests/test_brief.py`). Nothing becomes a constraint until the human confirms it.

**b) The day triggers itself** — the event chain (`POST /chain/start`, Alerts tab → "Event chain"):

```
scenario.loaded ─► Watcher ─► alert.raised ─► Supervisor ─► (the 18-agent team on LangGraph) ─► plan.ready ─► YOU
                     ▲                                                                                  │ approve / reject
                     └──────────── Watcher ◄── decision.made (logged first) ◄──────────────────────────┘
                                                   └─► Messenger ─► drafts.ready (EN + AR, never sent)
           Watcher, nothing left over the line ─► day.ended
```

Each event records who published it and which agents it triggered (`agents/chain.py`, tests in
`tests/test_chain_auth_log.py`). Nothing is applied until your decision is in the tamper-evident log
(`GET /decisions/verify`).

| On screen | Endpoint | What runs |
|---|---|---|
| AI plan → Brief the team → Confirm and plan | `POST /agent/brief`, then `/agent/run/stream` | Intake reads the brief; you confirm; the mission starts from it |
| AI plan / AI team → "Plan with AI agents" | `POST /agent/run/stream` | one planning mission, streamed live |
| Alerts → Event chain → Start | `POST /chain/start` | Watcher → Supervisor → team → your inbox |
| Event chain → Approve / Reject | `POST /chain/{id}/decide` | log → Messenger → Watcher → next alert or end of day |
| Alerts → Duty shift | `POST /shift/next` | the same loop, driven step by step by the browser |
| AI team → Ask the twin | `POST /agent/ask` | one question routed to one tool |

**c) The loop with you in it** (since 1.16.0, decision #144) — the agents run as one loop and stop for you wherever a
human decision matters:

```
        ┌──────────────────────────────────────────────────────────────────────┐
        ▼                                                                      │
 OBSERVE ──► PLAN (team + critic loop) ──► ⏸ YOU ──► ACT (logged first) ──► MONITOR
 Watcher      ⏸ hotspot: "plan for BKD?"     approve · reject       with your plan in place:
              ⏸ partial: "no plan clears it — reject with a reason   rain / train fault / bigger crowd
                 accept · one more round ·     └─► Intake reads it ─► the team replans the same alert
                 allow a measure · raise cap"                         ─► plan.checked ─► new alert if it no longer holds
 Stops: the day ends · nothing over the line · the budget is used · you stop it
```

| You do | Endpoint | What the agents do next |
|---|---|---|
| Tick "Ask me during planning", Plan | `POST /agent/run` with `checkpoints` | the Supervisor stops at the hotspot and, if no plan clears it, again |
| Answer a question | `POST /agent/run` with `answers` (or `/chain/{id}/answer`) | the team replays your answers and goes on |
| Reject with a reason | `POST /agent/feedback` (or `/chain/{id}/decide` with `reason_codes`) | your reason becomes constraints; round 2 starts |
| Conditions changed | `POST /chain/{id}/change` | the Watcher re-checks your approved plan and asks again where it fails |
| — | `GET /memory` | your past rejections come back as suggestions (never applied) |

## 2. Inside one mission: who talks to whom

The graph is compiled by LangGraph (`agents/engine.py`; the picture on screen is drawn from the compiled graph):

```
intake → forecast → diagnosis ─┬─ nothing over the line → conclude
                               └─ Supervisor BRIEFS the four specialists (in parallel)
                                    rail · station & crowd · venue · first & last mile
                                    each SIZES its measure from the diagnosis and SENDS it to the composer
                                  composer → simulation → critic → supervisor
                                    goal met?  ── yes → ranker → explainer ∥ stress test → verifier → conclude → YOU
                                               └─ no → critic sends OBJECTIONS to the specialists who can act;
                                                       supervisor routes the replan back to them (≤ 2 rounds);
                                                       each resizes its own measure from what is still over the line
```

**A real example** (Downtown night, 60,000 visitors; reproduce with `POST /agent/run`):

1. Supervisor → specialists: "Burj Khalifa/Dubai Mall is 12,753 riders an hour over the line at its peak."
2. Rail → composer: "needs about 43 trains an hour (now 8): the minimum headway, 2.5 minutes."
3. Station & crowd → composer: "walk 10 % to Financial Centre — it only has room for 79 an hour."
4. Venue → composer: "tested exit spreads of 30, 45, 60, 90 minutes in the simulator: 45 helps most, not enough alone."
5. First & last mile → composer: "12 shuttles to Max (room for about 2,807 an hour there); no robotaxis needed."
6. Critic → rail, station & crowd, last mile: "Burj Khalifa/Dubai Mall is still 1,236 riders over at 22:00 — best
   plan so far: trains + shuttles."
7. Supervisor routes round 2 to exactly those three. Last mile answers "shuttles 12 → 24"; the others add measures
   for what is left.
8. Critic: goal met by 9 of 25 tested plans; it recommends option 3 (passes 5 of the 6 checks that apply; not C7, the
   stress test) and says so on the card.

## 3. What is code and what is a model

| Kind | Agents | Rule |
|---|---|---|
| Code (always) | supervisor, forecast, diagnosis, composer, simulation, critic, stress test, ranker, verifier, watcher | every number comes from here |
| Model or code | intake (also reads the planner's brief), rail, station & crowd, venue, first & last mile, explainer, messenger, ask-the-twin | a model may add bundles inside the bounds and write texts; anything outside the menu or the bounds is dropped; any number in its text that is not a simulator figure restores the template |

**Today at the booth no model runs** — every agent uses its code rules, and the screen says so ("No language model in
this run"). The model path was tested live with GPT-5 (number faithfulness 1.0, but 66 s per plan:
`docs/LIVE_AI_TEST.md`). The plan is to host an open model on the college's GPUs (`docs/GPU_REQUEST.md`).

**"Not hardcoded"** — since 1.14.0 the specialists do not propose fixed amounts. They work them out from the
simulator's rows: riders per hour over the line, trains per hour now, room at the neighbouring station, shuttle
capacity × trips per hour (`planner.size_measures`). The venue agent searches stagger lengths with the simulator. When
the critic objects, they resize from the residual (`PlanRun.revisions_for`). The menu of *kinds* of measure is fixed
on purpose: a planner must be able to act on every recommendation.

## 4. How we know it works (measured, gated in CI)

See the table in `docs/15_AGENT_ARCHITECTURE.md` §5 — every row names its `eval/results/` file. The headline ones:
every number on screen equals the simulator's; the three engines (LangGraph, plain sequence, classic planner) give
identical plans; every critic objection is answered by the agent it names; the recommended option is the one the
C1–C7 rule picks (checked by an independent implementation); 0 of 53 prompt-injection attacks succeed; and the team's
first option scores 0.96 of the best plan an exhaustive grid can find.

## 5. Questions a professor will ask

**"Is LangChain used? Langfuse?"** LangGraph is (it is from the LangChain team). LangChain itself is not: we call
OpenAI/Claude/a local server directly with strict JSON schemas, which is simpler to test. Langfuse: the agent trace is
exported over OpenTelemetry when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and Langfuse accepts exactly that
(`apps/api/eventflow/tracing.py`); it is off by default so the booth sends nothing anywhere.

**"Isn't it just a pipeline?"** The order is a graph with conditional edges, parallel branches and a loop whose next
step depends on the critic's message; the chain is event-driven. What it is *not* is free-form agents chatting —
by design: an operator must be able to audit every step, and every step is in the event log and the trace.

**"Why not let the LLM decide?"** Because a wrong number in a crowd-safety plan is worse than a slow one. Models
propose and explain; code decides what is true; a human decides what happens.

**"Is the data real?"** Capacity and timetable are RTA's open GTFS; demand is synthetic at the hourly level and
labelled SYNTHETIC on every screen. Real monthly station totals are used as a stress case. A real hourly panel is
work package 8 (`docs/17_PLAN_YASH_OPUS.md`).

**"Why do you need a GPU?"** To run the model agents on campus with an open model instead of a slow, paid external API
(`docs/GPU_REQUEST.md` has the measured numbers and the acceptance rules).
