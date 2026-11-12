# 12 — Who does what: 12 → 17 November

Written Thu 12 Nov 2026 for Krishna, Atharva and Yash. It replaces the status and stream lists in
`docs/TEAM_PLAN.md` (the rules in §2 there still apply). This is a **proposed** split along the folders each of you
already owns — swap tasks if you like, but keep exactly one owner per task and say so in the team chat.

Background reading (15 minutes): `docs/11_MVP_ROADMAP.md` (where we are going and why) and
`docs/superpowers/plans/2026-11-12-vercel-live-demo.md` (the step-by-step plan most of the tasks below point to).

## 0. Status on Thu 12 Nov, evening — read this first
Most of the build tasks below were done on `main` in one pass with Claude Code (commits `ce466be` … on 12 Nov).
**Do not redo them** — pull `main`, check the "Done when" line still holds on your laptop, and move to what is left.

| Done on `main` | What landed |
|---|---|
| B1 | Stateless runs: `/simulate`, `/agent/plan`, `/breakpoint` accept the `forecast` spec and rebuild a run on a cold instance (409 if it does not match). Contract 1.6.0 |
| C1 | The web app sends the forecast spec with every simulate, plan and break-point request |
| B2 | `EVENTFLOW_DATA_DIR`, `/healthz` reports `storage`, plan cache read from the repo and written to the data dir |
| B3 | Per-client rate limit on POST (`EVENTFLOW_RATE_LIMIT`), 429 when exceeded |
| K4 | `vercel_entry.py`, `pyproject.toml`, `vercel.json` (Services: Next.js at `/`, FastAPI at `/api`), `.vercelignore`; `VERCEL=1` sets every hosted default, so **no environment variables are needed**. `vercel dev --local` checked |
| C2 | Public-demo banner (shown automatically when not on localhost), `robots.txt` disallow, "kept for this session only" note in the Report tab |
| K5 (code part) | `scripts/smoke_live.py` and `docs/DEPLOY.md`. Passed against `vercel dev`. **The preview deploy itself is not done** — it needs Krishna's Vercel login |
| K6 + C3 | `POST /breakpoint` (exact, contract 1.7.0) and the break-point card in the Station tab, EN/AR, with the train-fullness grid |
| B5 | `agents` and `redteam` suites, both in `required_suites`; gate green: number faithfulness 48/48 options, 0/15 attacks succeeded |
| B4 (code part) | Optional LLM Proposer + Explainer behind the number check — **OpenAI** (our key: `DEMO_MODE=live`, `LLM_MODEL=gpt-5`, `OPENAI_API_KEY`) or Claude (`LLM_MODEL=claude-opus-5-5`, `ANTHROPIC_API_KEY`). Tested with a fake model only — **never run against the real API yet** |
| C6 | Six 1920×1080 screenshots in `submission/images/final/` (`apps/web/tests/final_shots.mjs`). Retake after C5 if the Arabic changes |
| K2 (draft) | `submission/EventFlow_Twin_RTA_Nomination_v2_DRAFT.pdf` (git-ignored; regenerate with `fill_template.py`): real screenshots, wording corrected. **Krishna checks and sends it to Dr. Rachit** |

**What is left, by owner**
- **Krishna:** K1 decision; check and send K2; K3 ridership request; run the first preview deploy (`docs/DEPLOY.md`) and the smoke test on its URL; K7 only after K1 = yes; set a monthly budget limit on the **OpenAI** key and get it to Atharva privately (not in WhatsApp or the repo — e.g. add him to the OpenAI project so he makes his own key), then one live run of B4 (below); K8 booth kit.
- **Atharva:** **the realism pass for the 3D twin with Fable 5.2 — `docs/13_REALISM_FABLE_TASKS.md` (R1–R6, merged by Mon 16)**; review `eval/gold/` (20 agent scenarios, 15 red-team cases — you are named as reviewer in `eval/gold/README.md`); with the OpenAI key in your `.env`, run `DEMO_MODE=live LLM_MODEL=gpt-5 python -m eval.suites.agents` and `… redteam` and compare with the offline numbers; write down cost and latency.
- **Yash:** C4 touch-monitor test; C5 Arabic review; then retake C6 (`node apps/web/tests/final_shots.mjs`).

## 1. Get the new `main` running (everyone, tonight, ~15 minutes)
`main` changed a lot on 12 Nov: the web app is now a react-three-fiber twin, the API is at contract 1.7.0, and
`/agent/plan` and `/breakpoint` work. The old `python tasks.py basemap` step is gone.

```bash
git checkout main && git pull
python -m venv .venv && source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python tasks.py synth                                       # only if data/synthetic is empty
cd apps/web && rm -rf .next node_modules && npm install && cd ../..
python tasks.py api                                         # terminal 1 → http://localhost:8000/docs
cd apps/web && npm run dev                                  # terminal 2 → http://localhost:3000
```

Check: the twin shows Dubai in 3D, **Guided demo** runs to the end, and `python tasks.py test` prints `96 passed`.
UI tests (`make ui-test`, needs Google Chrome) have only been run on macOS so far — if they fail on Windows, post
the error and carry on; they are not a blocker for your task.

If something does not start, post the terminal output in the team chat before changing code.

## 2. Working agreement (short version)
- One branch per task: `a/…` Krishna, `b/…` Atharva, `c/…` Yash. Open a pull request into `main`; merge when the
  CI gate is green and one teammate has looked at it. Do not push to `main` directly from now on.
- Before every push: `python tasks.py test` (and `cd apps/web && npx tsc --noEmit` if you touched the web app).
- A change to `apps/api/eventflow/schemas.py` is a contract change: bump `CONTRACT_VERSION`, run
  `python tasks.py contract`, add one line to `docs/09_DECISIONS.md`, tell the other two.
- Numbers on screen, poster or nomination come only from API responses or `eval/results/`. Synthetic and assumed
  values stay labelled. "Designed for / aligned with RTA" — never "used by". No RTA logo.
- Secrets (API keys, Vercel tokens) never go in the repo or the chat. Krishna adds them as GitHub and Vercel secrets.
- Using Claude Code? Paste: *"Execute Task N of docs/superpowers/plans/2026-11-12-vercel-live-demo.md, step by
  step, and stop after the commit."* Each task there has its tests, code and commands.

## 3. Tasks

Plan = `docs/superpowers/plans/2026-11-12-vercel-live-demo.md`. "Done when" is a command or a visible result —
if you cannot show it, the task is not done.

### Krishna — lead, data and simulator, deployment, submission
| ID | Task | Done when | Needs | Due |
|---|---|---|---|---|
| K1 | **Decide with Dr. Rachit:** is a public demo URL acceptable, and should the GitHub repo be private (the README says private; it is public today)? | Decision written in the team chat and in `docs/09_DECISIONS.md` | — | Thu 12 |
| K2 | **Nomination refresh:** replace the four concept pictures with real screenshots from `eval/results/ui/` and correct the wording that the build does not match yet (table at the top of `docs/11_MVP_ROADMAP.md`); regenerate the PDF with `submission/tools/fill_template.py`; send to Dr. Rachit | PDF sent; `submission/CHECKLIST.md` ticked | — | **Fri 13** |
| K3 | **Request the ridership data** on Dubai Pulse / Data.Dubai (`rta_metro_ridership-open`), download Oct–Dec 2025 into `data/raw/`, note it in `data/raw/MANIFEST.md` | Files on your laptop, or the access request submitted and its date noted | Dubai Pulse account | Fri 13 (request) |
| K4 | **Vercel project files** — Plan Task 5, Steps 3–4 and 7: `vercel_entry.py`, `pyproject.toml`, `vercel.json`, `.vercelignore`; run `vercel dev --local` | `curl localhost:3000/api/healthz` answers with `"ok": true` | B1 merged; Vercel account | Sat 14 |
| K5 | **Preview deploy + smoke test + deploy guide** — Plan Task 6 | `python scripts/smoke_live.py <preview-url>` prints `OK …`; `docs/DEPLOY.md` exists | K4, B2, B3, C1, C2 merged | Sun 15 |
| K6 | **Break-point numbers from the API:** `GET /sensitivity?event_id=…` returning the grid `scripts/sensitivity.py` already computes (crowd size × train fullness → first over-threshold) | pytest for the endpoint; contract bumped; Yash can call it | — | Sat 14 |
| K7 | **Production deploy** and the link to Dr. Rachit | Smoke test passes on the production URL | K1 = yes, K5 | Mon 16 |
| K8 | **Booth kit:** poster numbers from `docs/metrics.md`, 90-second script rehearsed three times, backup video recorded, second laptop set up with `python tasks.py demo` | Three clean run-throughs of `exhibit/DEMO_SCRIPT_90S.md`; video on the USB stick; second laptop shows the kiosk | C4 | Tue 17 |

After the exhibit: ingest and calibrate on the real ridership (roadmap Phase 4), then the station-closure and
extended-hours interventions in the simulator (Phase 3.2).

### Atharva — API, agents, evaluation
| ID | Task | Done when | Needs | Due |
|---|---|---|---|---|
| B1 | **Stateless forecast runs** — Plan Task 1 (schemas, `main.py`, `tests/test_stateless.py`, contract 1.6.0). Everything else in the deployment waits for this, so it goes first | The 3 new tests in `tests/test_stateless.py` pass and `python tasks.py test` is green (77 tests); PR merged | — | **Fri 13, morning** |
| B2 | **Writable state behind one setting** — Plan Task 3, Steps 1–4 and the API part of Step 6 (data directory, `/healthz` storage, plan cache read/write) | Its 2 new tests pass; `python tasks.py test` green | B1 | Sat 14 |
| B3 | **Rate limit** — Plan Task 4 | Its new test passes; `python tasks.py test` green | B1 | Sat 14 |
| B4 | **Real agents** (roadmap Phase 2): LLM (OpenAI GPT-5 key; Claude also supported) proposer → critic → explainer behind the existing `verify_numbers`; keep the deterministic planner as the offline path and the comparison baseline; model id from `LLM_MODEL` | `/agent/plan` returns `planner: <model id>` when a key is set and still passes `test_agent_plan_numbers_come_from_the_simulator`; without a key nothing changes | API key from Krishna (as a secret) | Mon 16 — only if the key arrives by Sat; otherwise after the exhibit |
| B5 | **Evaluation suites** the nomination promises: `agents` (number faithfulness, schema validity), `redteam` (injection in event names and notes, EN / AR / mixed), added to `required_suites` in `eval/thresholds.yaml` | `python tasks.py eval && python tasks.py gate` green with the new suites | B4 for the LLM path; the suites can be written against the deterministic planner first | Mon 16 |

If B4 slips, say so on Sunday. The honest fallback is already in the product: the UI labels the planner
"offline: deterministic plan search with template explanations", and the nomination wording changes (K2).

### Yash — web app, kiosk, visuals
| ID | Task | Done when | Needs | Due |
|---|---|---|---|---|
| C1 | **Send the forecast spec with every request** — Plan Task 2 (`requests.ts`, `store.ts`, `snapshot.mjs`, one new UI test) | `cd apps/web && npx playwright test` → 17 passed | B1 merged | Fri 13, afternoon |
| C2 | **Public-demo chrome** — Plan Task 5, Steps 5–6 (banner, `robots.ts`, Playwright against a remote URL) and Plan Task 3, Step 5 ("kept for this session only" note in the Report tab) | Banner shows with `NEXT_PUBLIC_PUBLIC_DEMO=1 npm run dev`; `npx tsc --noEmit` clean | B2 for the storage note | Sat 14 |
| C3 | **Break-point view:** a card in the Station tab — "this station crosses the comfort line at about N visitors" with the small grid behind it, EN and AR, SYNTHETIC / assumption labels | Visible for GITEX and Dubai Future Week; a Playwright check; no number computed in the UI | K6 merged | Sun 15 |
| C4 | **Touch monitor test** with `python tasks.py demo`: touch mapping, pinch zoom, 48 px targets, idle → guided demo, recentre; note the monitor's resolution and the measured fps | "Not verified yet" section in `docs/BOOTH_RUNBOOK.md` replaced by what you measured | The monitor | Sun 15 |
| C5 | **Arabic review:** a native speaker reads the UI (`/?lang=ar`) and `apps/web/src/messages/ar.json`; apply the corrections; list them in `docs/AR_REVIEW.md` | Reviewer named in the file; footer no longer says "draft" only if they agree | A native speaker | Mon 16 |
| C6 | **Final screenshots** for the poster and LinkedIn at 1920×1080 (overview golden hour, station close-up with AI options, night, Arabic) into `submission/images/final/` | Four PNGs committed | C3, C5 | Tue 17 |

After the exhibit: duty-manager view, passenger-message panel, whole-network view (roadmap Phase 3).

## 4. Order and hand-offs
```
Fri 13  B1 ──► C1                       K2 nomination out · K3 data request
Sat 14  B2, B3     K4, K6 ──► C3        C2
Sun 15  K5 preview deploy + smoke       C3, C4          B4/B5 start
Mon 16  K7 production link              C5              B5 gate green
Tue 17  freeze at noon · K8 rehearsals · C6 screenshots · backup video
Wed 18  exhibit
```
- **B1 blocks C1 and K4.** Atharva: if B1 is not merged by Friday lunch, tell the others.
- **Freeze:** Tuesday 12:00. After that only fixes for something a visitor would see, each with a test.
- **Daily 15 minutes** (evening): what merged, what is blocked, anything that changes a number on screen.

## 5. What each of us must bring (not code)
| Who | What |
|---|---|
| Krishna | Vercel account linked to the repo; Anthropic API key and a monthly spend cap; Dubai Pulse access; the decision in K1 |
| Atharva | Gold examples for the agent suites (10 EN + 10 AR prompts) in `eval/gold/` |
| Yash | The touch monitor and its cables; a native Arabic reviewer |
| All | One full offline rehearsal on two laptops on Monday (`docs/BOOTH_RUNBOOK.md`) |

## 6. If we run out of time
Cut in this order, last first: B4 real agents → C3 break-point view → K7 production link (the preview URL is
enough to show the professor). Never cut: K2 honest nomination wording, C4 touch monitor test, K8 rehearsals.
