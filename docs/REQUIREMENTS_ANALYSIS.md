# Requirements analysis

Derived from the code, `docs/02_PRD.md`, `CLAUDE.md`, the decision log and RTA's invitation (`docs/01`). Status as of
`main` `7f33270`, 17 Nov 2026. See `PROJECT_DISCOVERY.md` for the evidence behind each line.

## 1. Stakeholders

| Stakeholder | Needs | Where the twin serves them |
|---|---|---|
| Duty and operations planners (metro, bus, events) | early warning, tested options, a decision they can defend | workspace, duty shift, duty inbox (`/inbox`) |
| Riders and event visitors, incl. people of determination | when and where to travel, step-free warnings | kiosk "I'm travelling", rider page (`/travel`) |
| Event organisers | effect of exit timing and crowd size | stress test, break point, staggered exit |
| RTA innovation and AI teams (exhibition audience) | a credible, auditable agentic AI example | kiosk with the AI team on screen, trace, evidence |
| University and team | a nomination that stands up to questions | this pack, `exhibit/JURY_QA.md` |

## 2. Use cases (prioritised)

1. **Plan an event day (MUST, done).** Pick an event → see the crowd → agents propose and test plans → approve one →
   before and after.
2. **Respond to an incident (MUST, done).** Train fault or weather during the event → the Watcher raises an alert →
   the team plans on top of approved measures → one recommendation → approve → the day ends clear or the residual is
   handed over.
3. **Advise a rider (SHOULD, done).** Best time and station to leave from; the duty team's published notice.
4. **Explain the AI (MUST, done).** Which agent did what, which simulator run backs each figure, which checks passed.
5. **Learn from past decisions (COULD, not built).** Use earlier human approvals and rejections to order options.

## 3. Functional requirements

| ID | Requirement | Priority | Status | Evidence |
|---|---|---|---|---|
| F1 | Hourly station demand with p10–p90 band and event surge | MUST | done | `forecast_20261116-2045.json` |
| F2 | 15-minute station simulation against GTFS capacity | MUST | done | `simulator_20261116-204519.json` |
| F3 | Agents propose, size, test, criticise and replan measures | MUST | done | `agents_*`, `orchestration_20261116-204754.json` |
| F4 | Every number shown comes from a tool, with its run id | MUST | done | number faithfulness 1.0 |
| F5 | Nothing applied without a human approval; decision logged first | MUST | done | `shift_no_autonomous_apply` 1.0 |
| F6 | English and Arabic, right to left | MUST | done (Arabic drafts under review, #43) | Playwright Arabic tests |
| F7 | Runs offline at the booth | MUST | done | `docs/metrics.md` → 0 external requests |
| F8 | Self-triggering event chain and duty shift | SHOULD | done | decision #135, `incidents_*` |
| F9 | Observable trace of agent steps | SHOULD | done | trace card, `trace_complete` 1.0 |
| F10 | Memory of past decisions informs new plans | COULD | not built | roadmap M2 |
| F11 | Voice input and output | COULD | not built | roadmap M3 |

## 4. Non-functional requirements

| ID | Requirement | Target | Measured |
|---|---|---|---|
| N1 | Mission latency | under 3 s | p95 0.86 s (`orchestration_20261116-204754.json`) |
| N2 | 3D frame rate at the booth | ≥ 50 fps or step down | 55.9 fps average, lowest second 52.2, tier 0 on the Windows booth laptop (`eval/results/ui/booth_windows/kiosk_default_mains.json`) |
| N3 | Prompt injection never changes a plan | 0 successes | 0 of 53 (`redteam_20261116-204631.json`) |
| N4 | Off-topic and harmful questions refused | 100 % | 1.0, over-refusal 0.0 (`safety_20261116-204835.json`) |
| N5 | No personal data | none collected | station aggregates only; kiosk counters anonymous and local |
| N6 | Kiosk touch targets | ≥ 48 px | met at 1920 × 1080; not met at 768 px (#41) |

## 5. Constraints

Synthetic demand must be labelled; no RTA endorsement claim; no keys in the repository; files under 50 MB; MUST before
SHOULD; **no new agent features before the exhibit** (Krishna, issue #45, 17 Nov 2026).
