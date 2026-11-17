# Implementation roadmap

Status on 17 Nov 2026 (`main` `7f33270`). The exhibitions are 18–21 Nov (Emirates Towers, Dubai Future Week) and
23–25 Nov (RTA HQ, UAE Innovates).

**Freeze.** Krishna decided on 17 Nov (issue #45): no new agent features before the exhibit, so the plan cache, the
offline snapshot and the gold scenarios stay valid. Everything in M1 is outside the code; M2 onwards starts after
21 Nov, or after 25 Nov if the second exhibition uses the same build.

## Done (milestones M0)

| Milestone | Decisions | Evidence |
|---|---|---|
| Forecast, simulator, break point, road proxy | #1–#60 | `simulator_*`, `forecast_*` |
| Realistic 3D city, landmarks, kiosk story | #94–#130 | `docs/metrics.md`, kiosk Playwright tests |
| 18-agent team on LangGraph, critic, replan, stress, verifier | #122–#125 | `agents_*`, `orchestration_*` |
| Incidents, duty shift, debate, operations brief, kiosk duty step | #128–#129 | `incidents_*` |
| Agents that message each other, event chain, store, sign-in, tamper-evident log, trace, Docker, CI | #132–#139 | `orchestration_*`, CI |
| Duty inbox, rider page | #140 | contract 1.15.0 |

## M1 — Exhibit readiness (18 Nov, no code)

| Task | Owner | Issue |
|---|---|---|
| Booth laptops: pull, install, run with Wi-Fi off | Atharva | #44 |
| Kiosk on the booth touch screen, Safari, paper print of the brief | Atharva | #42 |
| Native Arabic review of the new strings | team | #43 |
| Updated nomination text for the second exhibition | Dr. Rachit (submits) | `RTA_NOMINATION_DRAFT.md` |

## M2 — Memory agent (after the exhibit; about one day)

**Why.** Each mission starts fresh; earlier human approvals and rejections are logged but unused. This is the one
role from the brief that the system does not have.

**Design.**
- A code agent, **Memory**, reads the hash-chained decision log (`data/processed/decisions_log.jsonl`) before the
  Composer runs.
- It recalls earlier decisions on the same event and hotspot station: which kinds of measure were approved and which
  were rejected, and how often.
- It publishes a `memory.recall` event that names the decisions it used.
- The Ranker keeps its score, but among options with equal checks it puts a kind that humans approved before ahead of
  a kind they rejected. The Critic still decides the goal.
- Only `user` values from real people count. `guided-demo`, `test` and the booth's anonymous visitor log are kept apart
  with a flag, so a crowd of visitors cannot teach the twin.

**Cost.** A new agent in the roster, a contract bump, new suite rows: a recalled decision changes the order only
within equal checks, and the faithfulness metrics stay at 1.0. The plan cache and snapshot must be rebuilt.

## M3 — Voice at the kiosk (only if the booth asks for it)

The browser's own speech synthesis can read the result card aloud in English and Arabic. Before building: measure
whether the booth laptops have an Arabic voice installed offline, and whether a noisy hall makes it useful.

## M4 — Real ridership (blocked on data)

The open RTA taps have no time of day (`ridership_check_20261112-1947.json`). An hourly panel needs RTA's hourly
station data; then recalibrate the forecast and replace "synthetic" with measured accuracy.

## M5 — Kiosk at tablet width (issue #41)

Only if a tablet is used. Otherwise document the screen requirement and close.

## Risks

| Risk | Mitigation |
|---|---|
| Change before the exhibit breaks the offline demo | freeze (#45); every change behind the CI gate; booth tag `booth-safe-2026-11-16` to roll back |
| A visitor asks "is this RTA's system?" | wording rule: designed for, not endorsed by; on screen and in `exhibit/JURY_QA.md` |
| Synthetic demand questioned | labelled on screen; real timetable and city; M4 is the plan |
