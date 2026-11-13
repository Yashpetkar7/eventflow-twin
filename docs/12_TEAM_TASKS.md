# 12 — Who does what: 12 → 17 November

Written Thu 12 Nov 2026 for Krishna, Atharva and Yash. It replaces the status and stream lists in
`docs/TEAM_PLAN.md` (the rules in §2 there still apply). This is a **proposed** split along the folders each of you
already owns — swap tasks if you like, but keep exactly one owner per task and say so in the team chat.

Background reading (15 minutes): `docs/11_MVP_ROADMAP.md` (where we are going and why) and
`docs/superpowers/plans/2026-11-12-vercel-live-demo.md` (the step-by-step plan most of the tasks below point to).

## Status on Fri 13 Nov, evening — realism R8–R10, shader part (decision #114, branch `k/realism-r8-r10`)
- **On screen:** rooms behind the windows, floors and lights on the landmark towers, the Burj Khalifa's lights after
  dark, drifting cloud shadows, lamp pools on Sheikh Zayed Road, figures at the station entrances (the simulator's
  riders), larger kiosk labels. `?clouds=0` and `?film=0` switch the sky extras off.
- **Atharva:** two prompts are waiting in `docs/13_REALISM_FABLE_TASKS.md` → "R8–R10 — status": **R8** landmark
  geometry (needs Blender, which the Mac does not have) and **R9b** street level. Please also repeat the kiosk run on
  the Windows laptop on mains power with this build: the new effects run at full quality only.
- **Yash:** no change to your four tasks (C4 touch monitor, C5 Arabic, C6 screenshots, B4 live AI test). C6 should
  wait for this branch to be merged.

## Status on Fri 13 Nov, afternoon — score-up build (decisions #109–#113, contract 1.10.0)
- **Planner:** a code critic checks the goal after each round and the planner replans (at most twice) when no tested
  plan meets it; every tool call is recorded and shown ("How did the AI decide?" → "Show all tool calls"; workspace AI
  tab → "Tool calls"). The default scenarios still need one round, so their plans and numbers are unchanged.
- **New on screen:** road-pressure figure (extra cars near the venue, an assumption model), "Real station totals"
  switch in the stress test, "Clears every station" badge, reach mode (bottom-left round button).
- **Evals:** 60 planner scenarios, 53 attack cases tagged to the OWASP agentic list, a latency result from
  `python scripts/load_test.py <api url>`; the gate is green.
- **Atharva:** nothing changes in your Windows run; please also press the reach button once and send a photo.
  The new gold rows (en/ar 11–30, rt16–rt53) are waiting for your review (`eval/gold/README.md`).
- **Yash:** C5 Arabic review now also covers the block at the end of `apps/web/src/components/kiosk/strings.ts`
  (critic, tool calls, road, real totals) and the new keys at the end of `apps/web/src/messages/ar.json`.
  B4 live run: `DEMO_MODE=live` now also exercises the replanning call (the model sees the critic's finding).
- **Krishna:** rehearse the "show me the planner failing" walk-through in `docs/BOOTH_RUNBOOK.md`; JURY_QA has six new answers.

## Status on Fri 13 Nov, 05:00 — newest first
- **Best 3D by default (decision #108):** the kiosk and the desktop workspace open on the realism city at full quality;
  a slow laptop steps down by itself (kiosk: under 50 fps). `?quality=light` and `?scene=v1` are the manual fallbacks.
  **Atharva:** your Windows kiosk run now tells us which level the booth laptop settles on (it no longer gates a switch):
  open `http://localhost:3100/?kiosk=1`, wait 30 s, and send the tier and fps (`node tests/kiosk_fps.mjs http://localhost:3100 v2`).
  **Yash:** C6 screenshots can be retaken now; the workspace shots show the realism city.
- **Live:** https://eventflow-twin.vercel.app on `main` with everything below (contract 1.9.0). Still public and unshared
  until Dr. Rachit replies.
- **Kiosk plus (PR #12, decisions #104–#106):** two ways in (planning / travelling / 60-second show), stress test, your
  idea vs the AI, how the AI decided, undo, RTA's reported New Year's Eve measures as a labelled comparison, your own
  event, high contrast, booth statistics. `docs/BOOTH_RUNBOOK.md` → "The visitor kiosk" has the walkthrough.
- **Realism R1–R7 are all merged.** R7 (PR #11, decision #103) makes the realism scene cheaper to draw; the kiosk still
  runs it at quality tier 1 (#102). **Atharva:** measure tier 0 on the Windows laptop with the commands in
  `docs/13_REALISM_FABLE_TASKS.md` → "To switch the kiosk to tier 0"; we switch only if every lowest sample is ≥ 55 fps.
- **K3 is closed:** ridership option 1 (#88). **Booth kit:** new kiosk backup video `exhibit/video/eventflow_kiosk_show.mp4`;
  offline cache and API-down snapshot regenerated on contract 1.9.0; poster and handouts are unchanged (they show the
  workspace, not the kiosk).
- **Yash:** C5 now includes the new kiosk Arabic (`apps/web/src/components/kiosk/strings.ts`, everything after
  "two ways in"); C4 touch test should cover the stress-test slider and the two long-press gestures; C6 can run now.
- **Krishna:** rehearse with the new kiosk flow, copy both videos to the USB stick, laptop B check, print after Dr.
  Rachit's answer on the QR code.

## 0. Status on Thu 12 Nov, evening
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

**Update Thu 12 Nov, 17:30 (Krishna's list, done with Claude Code):**
- **K5 done:** Vercel project `eventflow-twin`; live at https://eventflow-twin.vercel.app (first deploy = production,
  so it is public — not shared yet; see `docs/DEPLOY.md` → Status). Smoke test OK, 5/5 remote UI checks passed.
- **K3:** the ridership dataset is now listed as *Open* on data.dubai ("Dubai Metro Ridership",
  https://data.dubai/en/l/466403, updated 9 Nov 2026) — download by hand, see `data/raw/MANIFEST.md`.
- **K2 / K1:** checklist ticked except "lead confirmed" and "sent"; email ready in
  `submission/EMAIL_V2_TO_DR_RACHIT.md` (asks about the public link and making the repo private). Krishna sends.
- **K8 (part):** poster evidence box and the 90-second script filled with measured numbers (`exhibit/`); backup video
  recorded with `apps/web/tests/backup_video.mjs` → `exhibit/video/eventflow_backup_demo.mp4` (git-ignored, 59 s).
  Still to do: rehearse 3×, USB stick, second laptop.
- **K8 (more, 12 Nov evening):** print-ready **A1 poster** and **A4 handouts (EN + AR draft)** →
  `python scripts/build_exhibit_print.py` (PDFs in `exhibit/poster/`, git-ignored; QR added with `--qr` after K1);
  `exhibit/JURY_QA.md` rewritten with the measured numbers (it wrongly said the ridership was real);
  `exhibit/BOOTH_PLAN.md` + printable `exhibit/MORNING_CHECKLIST.md`; **laptop B**: `python3 scripts/setup_booth_laptop.py`
  installs everything and ends with an offline self-check (`OK`). Krishna's mobile and student email are no longer in
  the public repo (`submission/tools/contact.local.json`, git-ignored, feeds the PDF).

**Update Thu 12 Nov, 18:00 — real ridership and Dr. Rachit's reply**
- **Ridership (new, before Mon 16 noon):** the open dataset is huge (3,141 files × ~155 MB, each a mixed sample of
  2017–2026). Read **`docs/14_RIDERSHIP_DATA.md`** first.
  - **Yash:** download 10 CSV files from 10 different pages into `data/raw/ridership/` (§2), note them in
    `data/raw/MANIFEST.md`, hand them to Atharva by USB/private drive.
  - **Atharva:** download the DDSE monthly check-ins per station (§2), run `python tasks.py ingest` (§3), fix unmatched
    station names in `config/station_aliases.yaml`, post the summary (coverage, sparsity, real vs synthetic, GITEX
    uplift at World Trade Centre). Krishna decides on `--write-panel` (§4).
  - The ingest is built and tested (`scripts/ingest.py`, `tests/test_ingest.py`) — no code needed unless the check
    finds a surprise.
- **When Dr. Rachit replies** (Krishna tells the team, then):
  | He says | Who does what |
  |---|---|
  | Public link OK | Krishna: note it in `docs/09_DECISIONS.md`; reprint with `python scripts/build_exhibit_print.py --qr https://eventflow-twin.vercel.app`; add the link to `README.md` |
  | Public link not OK | Krishna (or Claude): lock the site — Vercel → Project → Settings → Deployment Protection (`docs/DEPLOY.md` → Status) |
  | Make the repo private | **Yash** (owner): GitHub → Settings → General → Danger Zone → Change visibility → Private. Vercel keeps working (it deploys from the CLI) |
  | Changes to the nomination | Krishna edits `submission/tools/fill_template.py` (or asks Claude), regenerates the PDF, sends it back |


- **Krishna:** K1 decision; check and send K2; K3 ridership request; run the first preview deploy (`docs/DEPLOY.md`) and the smoke test on its URL; K7 only after K1 = yes; decide whether the public site may ever use the OpenAI key (default: no — it stays offline); K8 booth kit.
- **Atharva:** **the realism pass for the 3D twin with Fable 5.2 — `docs/13_REALISM_FABLE_TASKS.md` (R1–R6, merged by Mon 16)**; review `eval/gold/` (20 agent scenarios, 15 red-team cases — you are named as reviewer in `eval/gold/README.md`).
- **Yash:** C4 touch-monitor test; C5 Arabic review; then retake C6 (`node apps/web/tests/final_shots.mjs`).
  **Yash holds the team's OpenAI key**, so the live AI test (B4) is Yash's:
  1. In the OpenAI dashboard set a **monthly budget limit** on the key's project.
  2. Copy `.env.example` to `.env` on your laptop (git-ignored) and set `OPENAI_API_KEY=…`, `LLM_MODEL=gpt-5` (or the
     GPT-5 model id the key can use), `DEMO_MODE=live`.
  3. Run `python -m eval.suites.agents`, `python -m eval.suites.redteam`, `python -m eval.gate`; post the numbers
     (number faithfulness, attack success, p95 latency) and the cost from the OpenAI usage page in the team chat.
  4. Never send the key in WhatsApp, email, screenshots, GitHub or Vercel without Krishna's decision. If someone else
     needs access, add them to the OpenAI project so they create their own key.

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
- Secrets (API keys, Vercel tokens) never go in the repo or the chat. The OpenAI key stays with Yash (see §0); Krishna decides if a key is ever added to Vercel or GitHub secrets.
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
| Krishna | Vercel account linked to the repo; data.dubai ridership download; the decision in K1 |
| Atharva | Gold examples for the agent suites (10 EN + 10 AR prompts) in `eval/gold/` |
| Yash | The touch monitor and its cables; a native Arabic reviewer; the OpenAI key (with a monthly budget limit) |
| All | One full offline rehearsal on two laptops on Monday (`docs/BOOTH_RUNBOOK.md`) |

## 6. If we run out of time
Cut in this order, last first: B4 real agents → C3 break-point view → K7 production link (the preview URL is
enough to show the professor). Never cut: K2 honest nomination wording, C4 touch monitor test, K8 rehearsals.
