# 17 — Build plan for Yash: closing the gaps a strict reviewer would find

**Plan written by Claude Fable 5.2 on Mon 16 Nov 2026 for Krishna. Owner: Yash Petkar. It will be executed with
Claude Code on Opus 5.5, in sessions that have none of the planning conversation.** Everything the executor needs is
in this file and the files it names. Executor: read it all before the first edit, do one work package per session,
do not redesign, and verify every claim with a command before reporting it.

Read first, in this order: `CLAUDE.md` (the hard rules bind) → this file → `docs/15_AGENT_ARCHITECTURE.md` →
`docs/11_MVP_ROADMAP.md` (phases 4 to 6 are the long form of some packages here) → `docs/14_RIDERSHIP_DATA.md`.

## 1. Why this plan exists

On 16 Nov the project was scored strictly from eleven points of view (RTA jury, RTA AI engineer, agentic-AI
engineer, CTO, CEO, CMO, COO, kiosk, digital-twin practice, security, product). The exhibit prototype scores well;
the product scores low. The five gaps that cost most:

1. **Demand is synthetic at the hour level.** Real station totals exist only as an opt-in level
   (`demand_level=real_totals`, `config/calibration.yaml`); the hourly shape and the event model are not calibrated.
2. **No language model runs at the booth.** `data/demo_cache/llm/` is empty, so all 18 agents run their code
   policies. That is labelled on screen, and it is the first thing an agentic-AI judge will probe.
3. **No validation against an observed day**, even though `eval/results/ridership_check_20261112-1947.json` already
   holds real measurements (GITEX 2025 at World Trade Centre: metro arrivals × 1.65, 95 % range 1.48 to 1.84).
4. **Plans ignore operations**: trains and staff available, cost in dirhams. The critic's checks C4 to C7 are
   reported but never change what is recommended.
5. **No production basics**: no sign-in or roles, decisions in a file (not kept on the hosted site), no tracing,
   UI tests not in CI, manual deploys.

A correction to that scorecard, so nobody repeats it: it said "no real ridership data". That is wrong. 10 sample
files and the official monthly station totals were ingested on 12 Nov (`docs/14`, decision #74). What is missing is a
real **hourly** panel, which the default window cannot give (taps from Jun 2025 to Mar 2026 carry no time of day).

## 2. State of the project (verified 16 Nov, 18:10 Dubai time)

- `main` at merge of PR #35. Live at <https://eventflow-twin-roan.vercel.app>, contract **1.13.0**.
- Stages 1 to 3 are live: rendering fixes and gauge (#126), Dubai Mall, fountain and five landmarks (#127),
  incidents, duty shift, debate, operations brief (#128).
- `python tasks.py test` → 217 passed. `python -m eval.gate` → 30 of 30 checks pass. Playwright → 52 of 52 on a
  production build (run on a laptop; it is not in CI).
- **Atharva owns** (issue #34, `docs/16_STAGE3_HANDOVER.md`): the duty shift on the kiosk, the rest of the UI audit.
  His files: `apps/web/src/components/kiosk/Kiosk.tsx`, `logic.ts`, `strings.ts`, `apps/web/tests/kiosk.spec.ts`.
  **Do not edit those four files** in this plan; if a package needs a kiosk change, write it up for him.

## 3. Rules for every package

From `CLAUDE.md`: demo runs offline · numbers only from deterministic code, each with its source (tool + run id) ·
nothing applied without an Approve click, logged · synthetic and assumed values labelled · no claim of RTA
endorsement, no RTA logo ("designed for", "aligned with") · never commit `.env`, keys, raw data, files over 50 MB ·
every eval writes `eval/results/<suite>_<timestamp>.json` · one row per non-trivial choice in
`docs/09_DECISIONS.md` (take the next free number when you write the row; on a conflict keep every row in numeric
order).

Added for this plan:

- **Config freeze.** `config/corridor.yaml` and `config/events.yaml` are the config hash. Changing either one
  invalidates the plan cache, the web snapshot and the gold scenarios. **Do not edit them** unless a package says so
  (only WP8 does, after the exhibit). New assumptions go in a new file outside the hash, as `config/incidents.yaml`
  and `config/agents.yaml` do.
- **Exhibit freeze.** The exhibit runs 18 to 21 Nov (Emirates Towers) and 23 to 25 Nov (RTA HQ). Before a package
  marked "after the exhibit" is merged, Krishna must say yes. Nothing is merged or deployed on the morning of an
  exhibit day. Every deploy needs Krishna's OK: the Vercel project is on his account
  (`docs/16_STAGE3_HANDOVER.md` §2A has the three commands).
- **A change to `apps/api/eventflow/schemas.py` is a contract change**: additive fields only, bump
  `CONTRACT_VERSION`, run `python tasks.py contract`, add a decisions row. The web snapshot
  (`apps/web/public/cache/`) holds answers recorded before the change, so the UI must treat every new field as
  possibly absent.
- One branch per package, PR into `main`, merge when the `eval` check is green. Never push to `main`.
- UI copy in British English plus Arabic. New Arabic strings are drafts: append them, no digits inside strings.
- Do not use subagents unless Yash asks. Report what was verified and what was not; never hide a failing test.

## 4. The packages, in the order to do them

| # | Package | Lifts | Size | When | Needs |
|---|---|---|---|---|---|
| WP1 | Validation note from the real measurements already in the repo | RTA engineer, jury | S | Before opening | Nothing |
| WP2 | Pilot proposal, ROI sketch, 60-second video script | CEO, CMO | S | Before opening | Nothing |
| WP3 | C4 to C7 decide what is recommended | Agentic | M | Exhibit week, with Krishna's OK | Nothing |
| WP4 | Agent trace view (and optional export) | Agentic, CTO | M | Exhibit week, with Krishna's OK | Nothing |
| WP5 | Tamper-evident decision log | Security, CTO | S | Exhibit week, with Krishna's OK | Nothing |
| WP6 | CI: UI tests, container build, deploy on merge | CTO | M | After 21 Nov | Repository secrets (Yash), a Vercel token (Krishna) |
| WP7 | Operations limits and cost in dirhams | COO | M | After 21 Nov | Krishna's unit costs, or labelled defaults |
| WP8 | Real hourly panel and back-test (Sep 2024 to Jan 2025) | RTA engineer, twin, MVP | L | After the exhibit | About 40 more files downloaded by Yash |
| WP9 | Recorded model runs for the three demo events | Agentic, jury | M | Only if Krishna asks | The OpenAI key in `.env` |
| WP10 | Sign-in, roles, database | CTO, security, SaaS | L | After the exhibit | Decisions in §5 |
| WP11 | Second corridor from a timetable upload (multi-city) | SaaS | L | After the exhibit | A decision that SaaS is the goal |

Sizes: S = under half a day, M = about a day, L = several days. If a package overruns, cut scope, not quality, and
say what was cut.

---

### WP1 — Validation note (before opening)

**Goal.** One page a judge can read: what the twin assumes for GITEX 2025 against what RTA's open data measured.

**Do.**
1. New script `scripts/validate_real.py`. It reads `eval/results/ridership_check_20261112-1947.json` (find the keys
   by reading the file; do not guess them) and `config/calibration.yaml`, runs
   `forecast.build_forecast("gitex2025_d1")` and the same weekday with no event, and writes
   `eval/results/validation_<timestamp>.json` in the usual result format (suite, git_sha, timestamp, models,
   dataset_version, metrics, n, split) with:
   - the model's event-day metro arrivals at World Trade Centre as a multiple of the plain weekday, next to the
     measured × 1.65 and its range, and whether the model falls inside the range;
   - per corridor station, synthetic weekday entries against real weekday entries and their ratio (already in the
     calibration file);
   - the peak load and over-threshold station-hours of `gitex2025_d1` at `demand_level` synthetic and `real_totals`.
2. New `docs/18_VALIDATION.md`: the table, what agrees, what does not, and the limits (a sample of 10 files; about
   77 sample arrivals per GITEX day; daily totals only, because the taps carry no time of day; departures measured
   × 0.84, which the model should be compared with honestly, even if it is worse).
3. Add the result to `GET /evidence` only by writing the file (the endpoint lists the latest file per suite).
   Do **not** add a gate threshold: this is a report, not a pass mark.
4. Published figures for New Year's Eve may be added **only** if you open the primary source in this session, quote
   the figure with its URL and date, and it is a figure the twin also produces. Otherwise leave them out.

**Accept.** The script runs offline; the result file exists; every number in `docs/18` is in the result file; a
pytest test checks the script's output shape; no model or config file changed.

### WP2 — Pilot proposal, ROI sketch, video script (before opening)

**Do.** Three files under `exhibit/`: `PILOT_PROPOSAL.md` (one page: what a four-week pilot on one event would
need from RTA, what it would deliver, what would count as success), `ROI_SKETCH.md` (a worked example with every
input labelled as an assumption and its source; no claim of savings), `VIDEO_SCRIPT_60S.md` (shot list matched to
real screens in `eval/results/ui/`).

**Rules.** Every project number comes from a file in `eval/results/` and names that file. Nothing invented. No
endorsement wording. Read `exhibit/JURY_QA.md` and `exhibit/DEMO_SCRIPT_90S.md` first so the three agree with them.

**Accept.** A reviewer can trace each number to its file; `grep -ri "endorsed by\|partner" exhibit/` shows only
the "not endorsed" disclaimers.

### WP3 — C4 to C7 decide what is recommended (contract 1.14.0)

**Why.** Today the plan's order is relief minus λ × cost (`planner.py`, `score_one`), and `goal_met` is C1 to C3.
C4 (waits), C5 (road pressure), C6 (constraints) and C7 (stress) are computed in `agents/mission.py::checks_for`
and shown, but nothing uses them. The duty shift already recommends "the first option that clears every station"
(`agents/shift.py`), a rule that lives in the wrong place.

**Design (do not change it).** Do **not** reorder `plan.options`: `/agent/plan`, the three engines' equivalence
test and the 60 gold scenarios depend on that order. Instead add `Mission.recommended_rank` and
`Mission.recommendation` (`{rank, basis, passed, applicable}`), computed in `mission.py` after the assessments:

1. the first option that passes every applicable check C1 to C7;
2. else the first that passes C1 to C3 and the most of C4 to C7;
3. else the option that passes the most checks; ties go to the plan's own order.

`basis` is one of `all_checks`, `goal_and_most`, `most_checks`. `shift.py` then uses `mission["recommended_rank"]`
and its own rule is deleted.

**Do.** Schema fields (optional, so old snapshots still parse) → `mission.py` → `shift.py` → web: a "Recommended"
badge on that option in `PlanTabs.tsx` with one line saying why (text from `basis`, figures from the checks), and
`Duty.tsx` reading the mission's field → `eval/suites/orchestration.py`: new metric `recommendation_consistent`
(the recommended option really is the one the rule picks, recomputed independently) gated at 1.0, and report
`recommended_all_checks_rate` → tests → `python tasks.py contract` → docs 15 and 09.

**Accept.** Engines still agree (orchestration suite 1.0); `tests/test_agent_engine.py` and
`tests/test_incidents_shift.py` pass (update the shift tests' expectation to the new field); the incidents suite
stays at 1.0 on all six gated metrics; Playwright green; the UI shows no badge when the field is absent.

### WP4 — Agent trace view

**Why.** A reviewer asks "show me what each agent did and how long it took". The mission already has ordered
events with `seq`, `t_ms`, `agent`, `kind`, `run_id` (`schemas.AgentEvent`).

**Do.**
1. Server: in `mission.py`, add `Mission.spans` (optional): one span per agent step, `{agent, layer, start_ms,
   end_ms, kind, run_ids[], llm}` derived from the events in order. No new timing source.
2. Web: a "Trace" card on the AI team tab (`components/mission/`, new file): a waterfall by layer, DOM or SVG only
   (not in the 3D canvas), each bar labelled with the agent and its simulator runs. Reduced motion respected.
3. Optional export, **off by default**: when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, send the same spans with the
   OpenTelemetry SDK. Add the dependency only as an extra (not in `requirements.txt`), import it lazily, and keep
   `tests/test_agent_engine.py::test_an_offline_mission_opens_no_network_connection` passing. If this cannot be
   done cleanly in the session, leave it out and say so.

**Accept.** Spans cover every event; graph and sequential engines give the same spans apart from timings
(extend the equivalence test); the offline no-socket test passes; a Playwright test opens the card.

### WP5 — Tamper-evident decision log

**Do.** In `main.py::decisions`, each record gets `prev` (the SHA-256 of the previous line as written, or 64 zeros
for the first) and `hash` (SHA-256 of the record without `hash`, canonical JSON). New `GET /decisions/verify` →
`{ok, records, first_bad}`. Old records without the fields are reported as "unchained", not as broken. Show
"log verified · N records" on the Report tab (`ReportTab.tsx`). Contract bump, tests (edit a line → `ok` is false
and `first_bad` points at it).

**Limit to state in the docs.** On the hosted site the log lives in `/tmp` and does not survive a restart; the
chain proves order and integrity while it lasts, not durability. Durability is WP10.

### WP6 — CI and deploy (after 21 Nov)

**Do.**
1. `.github/workflows/eval-gate.yml`: add a second job that builds the web app, starts the API and runs Playwright
   **without** the frame-rate tests (GitHub runners have no GPU; software WebGL would fail them). Give those tests
   a tag and skip them when `CI` is set; keep them for laptops. If the 3D scene does not start at all on the runner,
   run `mission.spec.ts` and the non-3D tests only and say which were left out.
2. `Dockerfile` for the API and `docker-compose.yml` (API + web) for a laptop without Python set up. Offline rule:
   the image must run with no network.
3. Deploy on merge: a workflow that runs `vercel deploy --prod --archive=tgz` and then `scripts/smoke_live.py`,
   using secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Yash adds the secrets; Krishna creates the
   token (never in chat, never in a file). Until the secrets exist, leave the workflow manual
   (`workflow_dispatch`).

**Accept.** A PR shows both checks; a failing UI test fails the PR; the compose file starts the app on a clean
machine; the README says how.

### WP7 — Operations limits and cost in dirhams (after 21 Nov)

**Do.** New `config/operations.yaml` (outside the config hash): trains that can be added per hour, staff per
measure, and unit costs in AED, **each marked `[ASSUMPTION]` with its source or "team estimate"**. Ask Krishna for
the figures; if he gives none, use labelled defaults and say so on screen. Add to `Constraints`
(`max_extra_trains_per_hour`, `staff_available`) as typed fields set by controls, never from free text. The critic
gets C8 "inside the operations limits" (reported, and used by WP3's recommendation rule if WP3 is done). Each
option shows "cost ≈ AED N (assumption)" beside the cost proxy, computed in code from the simulator's effects.
Contract bump, tests, suite rows, Arabic drafts.

**Do not** change `cost_proxy` in `config/corridor.yaml` (config freeze).

### WP8 — Real hourly panel (after the exhibit)

Follow `docs/14_RIDERSHIP_DATA.md` §4 "option 2" and §5 exactly. Yash downloads about 40 files; ingest the fully
timed period Sep 2024 to Jan 2025 (it contains GITEX 2024, 14 to 18 Oct 2024); `--write-panel` only when the check
report says `panel_ready`. Then every number on screen changes: run the whole §5 list (evals, cache, snapshot,
metrics, poster and script numbers) in the same PR. Back-test LightGBM on the real panel and report event days
separately, even if worse. This is the one package that may edit `config/events.yaml` (to calibrate
`gitex2025_d1`), with a decisions row. **Krishna must approve before it is merged.**

### WP9 — Recorded model runs (only if Krishna asks)

Krishna chose on 16 Nov to skip this for the exhibit. If he changes that: he puts `OPENAI_API_KEY` in `.env`
himself (never print, log or commit it; check only with `grep -c '^OPENAI_API_KEY=' .env`); verify the model id with
the provider; `python tasks.py record-missions` for the three demo events in English and Arabic; then
`python tasks.py cache`, `npm run snapshot`, the full gate, and the red-team suite at 0 successful attacks with the
recording in place. The screen must say "AI answers recorded <date> · <model>".

### WP10 and WP11 — after the exhibit

Long form in `docs/11_MVP_ROADMAP.md` (phases 5 and 6). Do not start either before the decisions in §5 are made.

## 5. Decisions only Krishna can make (ask once, record the answer in `docs/09`)

1. WP3, WP4, WP5 during the exhibit week, or after it?
2. Unit costs and limits for WP7, or labelled defaults?
3. WP9: record model runs after all?
4. WP10: which sign-in provider and which Postgres host (the hosted site keeps nothing today)?
5. WP11: is a multi-city product the goal, or a deeper Dubai twin?

## 6. Environment and commands

```bash
git clone https://github.com/Yashpetkar7/eventflow-twin && cd eventflow-twin
python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt   # Python 3.11 or 3.12
python tasks.py synth            # only if data/synthetic is empty
cd apps/web && npm install && cd ../..
python tasks.py test             # pytest (217 on 16 Nov)
python tasks.py eval-fast && python -m eval.gate
python tasks.py api              # FastAPI on :8000 — restart after changing Python, it does not reload
cd apps/web && npm run dev       # Next.js on :3000
cd apps/web && npx tsc --noEmit && npx eslint src tests --quiet
cd apps/web && npx playwright test   # needs Google Chrome; about ten minutes; no other 3D work beside it
python tasks.py contract         # after any change to schemas.py
```

Known friction: PRs conflict on `docs/09_DECISIONS.md` (keep every row, in numeric order) · macOS can leave files
named `something 2.ext` (git-ignored; under `apps/web/.next` they break `tsc`: delete them) · a GitHub runner was
eight times slower than usual on 16 Nov: if `eval` sits in "Run evals" beyond 15 minutes, cancel and re-run it.

## 7. Prompt to start each session (Opus 5.5)

> Read CLAUDE.md and docs/17_PLAN_YASH_OPUS.md in full before doing anything. I am Yash. This session does exactly
> one work package: **WP_**. First confirm the starting point: git status, `python tasks.py test`, and
> `python -m eval.gate`; tell me the counts. Then read the files that package names and tell me in a few lines what
> you will change, and wait for my OK. Follow the package's design; do not redesign it. Work on a new branch. Do not
> edit Kiosk.tsx, kiosk/logic.ts, kiosk/strings.ts or kiosk.spec.ts (Atharva owns them), and do not edit
> config/corridor.yaml or config/events.yaml. When done, run the package's acceptance checks and the full test
> commands in §6 and show me the results. Stop and ask me before committing, pushing, merging or deploying. Report
> plainly what you verified and what you could not. Do not use subagents unless I ask.

## 8. Report back

After each package: the PR number, the test and gate counts, the new result files, what was cut and why, and what
was not verified. Post it on the GitHub issue that points to this plan.
