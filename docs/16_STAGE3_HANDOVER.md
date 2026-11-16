# 16 — Handover to Atharva: finishing stage 3

Written by Claude Fable 5.2 for Krishna on Mon 16 Nov 2026. **Owner from here: Atharva Soundankar**, working with
Claude Code on Fable 5.2. Everything needed is in this file and the files it names; it assumes nothing from the
session that wrote it. The exhibit opens **Wed 18 Nov 2026**.

Read `CLAUDE.md` first (the hard rules bind), then this file, then `docs/09_DECISIONS.md` rows 126 to 128 and
`docs/15_AGENT_ARCHITECTURE.md` (the section "Incidents and the duty shift").

## 1. Where things stand

The lead asked for three stages after the professor's second review. Each stage is tested, merged and deployed
before the next.

| Stage | What | State on 16 Nov, 18:10 Dubai time |
|---|---|---|
| 1 | Rendering faults fixed, new station gauge, welcome sheet closes (#126) | **Live.** PR #31 |
| 2 | Dubai Mall rebuilt, animated fountain, One Za'abeel, Address Sky View, Address Downtown, Coca-Cola Arena, Burj Al Arab (#127) | **Live.** PR #32 merged and deployed |
| 3 | Incident mode, duty shift on autopilot, agent debate, operations brief (#128) | **Live.** PR #33 merged and deployed; smoke test reports contract 1.13.0 |

Checked on the live site after the last deploy: the duty shift with a train fault (inbox item at 16:00 for World Trade
Centre, Approve, "No station is over the line", operations brief), the fountain at night, the Dubai Mall, Burj Al
Arab, and Financial Centre station in close-up. **Section 2A below is done; start at 2B.**

### What stage 3 already contains (do not rebuild)

- **Incidents** (contract 1.13.0): `ForecastRequest.incident {type, hour}` with `train_fault`, `rain`, `heat`,
  `crowd_surge`. What each changes is in `config/incidents.yaml` and resolved by the server
  (`apps/api/eventflow/forecast.py::resolve_incident`, `build_from_spec`). A train fault is a service factor in the
  simulator (`simulate(service=…)`).
- **Duty shift**: `POST /shift/next` (`apps/api/eventflow/agents/shift.py`), stateless, one step per call, never
  applies anything.
- **Web**: `apps/web/src/components/mission/Duty.tsx` (incident chips, approval inbox, shift log, end summary,
  operations brief), `Debate.tsx` (AI team tab), store actions `setIncident`, `startShift`, `shiftDecide`,
  `stopShift` in `apps/web/src/lib/store.ts`. English and Arabic strings under `mission.duty`, `mission.brief`,
  `mission.debate`.
- **Checks**: `tests/test_incidents_shift.py` (11 tests), `eval/suites/incidents.py` (gated in
  `eval/thresholds.yaml`, six metrics at 1.0 over 15 shifts), three Playwright tests at the end of
  `apps/web/tests/mission.spec.ts`.
- **Docs**: 03, 08, 09 (#128), 15.

To see it: start the API and the web app, open the workspace, **Alerts** tab → choose "Train fault" → "Start the duty
shift" → Approve → "Operations brief". The **AI team** tab then shows the debate.

## 2. What is left, in order

### A. Ship stages 2 and 3 — DONE on 16 Nov (kept as the recipe for the next deploy)

1. **PR #32** (`c/dubai-landmarks`): when its `eval` check is green, merge it into `main` (merge commit, as before).
   If the check sits in "Run evals" for more than 15 minutes, cancel and re-run it
   (`gh run cancel <id>` then `gh run rerun <id>`); on 16 Nov one runner was about eight times slower than usual
   and nothing in the code was at fault (the same commands pass locally in under a minute).
2. **Deploy** (merging does not deploy). From a clean checkout of `main`:
   `vercel link --yes --project eventflow-twin`, delete the `.env.local` it creates, then
   `vercel deploy --prod --yes --archive=tgz` (a plain upload has failed with "fetch failed"; the archive form
   works), then `python scripts/smoke_live.py https://eventflow-twin-roan.vercel.app`.
   If you have no access to the Vercel project, ask Krishna or Yash to run these three commands.
3. **Look at the live site**: Landmarks menu shows fourteen places in two columns; open The Dubai Mall, The Dubai
   Fountain (jets move, by day too), One Za'abeel, Burj Al Arab (the chip says "Outside the modelled corridor");
   Station close-up on Financial Centre shows the station, with no tower standing on it; overview at 21:30 has no
   floating white rings.
4. **PR for stage 3** (`b/incident-shift`): after #32 is merged, `git fetch && git merge origin/main` on the branch.
   The only expected conflict is `docs/09_DECISIONS.md`: keep every row, in numeric order. Push, wait for `eval`,
   merge.
5. **Deploy again** as in step 2. The smoke test should report contract **1.13.0**.
6. **Look at the live site**: Alerts tab → Train fault → Start the duty shift → an inbox item at 16:00 for World
   Trade Centre → Approve → "No station is over the line for the rest of the day" → Operations brief opens, shows
   DRAFT, prints. AI team tab shows "Debate: the case and the critic". Repeat once in Arabic.

Done means: both PRs merged, production deployed twice, smoke test green, the checks in steps 3 and 6 seen with your
own eyes. Report anything that differs; do not paper over it.

Two things seen while doing it on 16 Nov: `vercel deploy` once answered "Not authorized" and worked on the next try;
and after a deploy the production address served the old files for about a minute (check with
`curl -s https://eventflow-twin-roan.vercel.app/api/healthz`, which must report the new contract).

### B. Duty shift on the kiosk — DONE on 16 Nov (decision #129)

Built as described below: one optional step after the approval, "What if a train breaks down now?". The fault day
starts without the plan approved before it (the store's rule from #128). Tests: three at the end of
`apps/web/tests/kiosk.spec.ts`.

Today the duty shift is in the workspace only (and so in the kiosk's planner mode). The lead asked for agentic
features on the kiosk too.

- Add one step to the kiosk story after the plan is approved: "What if a train breaks down now?" → the visitor
  taps → incident `train_fault` at the event's last hour → the shift's first step → one Approve button → result.
- Files: `apps/web/src/components/kiosk/Kiosk.tsx`, `logic.ts`, `strings.ts` (Arabic must mirror English key for
  key). Reuse the store actions; do not write a second client for `/shift/next`.
- Rules: targets at least 48 px; every figure from the API answer; reduced motion respected; a Skip button.
- Accept: a new test in `apps/web/tests/kiosk.spec.ts`; the existing kiosk tests and the kiosk frame-rate test
  still pass.

### C. UI and UX audit — second pass DONE on 16 Nov (decision #130)

Done with `node apps/web/tests/audit2.mjs` (pictures in `eval/results/ui/audit2/`). One fault fixed (the Arabic
train-fault sentence named the line in English). Still open: the kiosk at tablet width is the booth layout scaled
down (buttons about 27 px), a real touch screen, Safari, a paper print. The list below is the original one.

Checked so far on stage 3: workspace at 1920 px in English and Arabic, phone width 375 px (two faults found and
fixed: the landmark menu opened half off screen; a long chip pushed the page sideways).

Not checked yet:
- Kiosk journeys end to end after stages 2 and 3 on a real touch screen.
- The operations brief printed from Safari and from Chrome on Windows (it was checked in Chrome on macOS only).
- High-contrast and large-text modes with the new duty card.
- The new landmarks at night from every camera preset; Burj Al Arab's surroundings are bare satellite ground at
  39 m a pixel, because it stands outside the detailed ring. That is expected; say so if asked.
- Tablet width (768 px).

For each fault: reproduce, find the cause, fix it, add a test where one fits, record it in `docs/09_DECISIONS.md`.

### D. "More RTA, Dubai and metro agentic features" (could do; choose at most two, ask Krishna first)

The lead asked for more beyond the four built. Candidates, smallest first:

1. **Two incidents in one shift** (for example a bigger crowd, then a train fault): the scenario carries one
   incident today. Needs a list in `ForecastRequest`, a contract bump and new suite rows.
2. **Rain and heat from the incident hour on**: today they change the whole event's metro share (stated as a limit
   in docs/15). Needs the event overlay to change share over time (`event_model.py`).
3. **A concert night at Coca-Cola Arena** as a fourth event. **Warning:** `config/events.yaml` is part of the config
   hash; changing it invalidates the plan cache (`python tasks.py cache`), the web snapshot (`npm run snapshot`) and
   the gold scenarios. Do not start this on 17 Nov.
4. **End-of-shift handover note** written by the Messenger for the next shift (template first, model optional).

Scope rule from `CLAUDE.md`: MUST items before SHOULD; if time runs short, cut scope, not quality.

### E. Team-side items (not code)

- **Arabic review** by a native speaker of the new strings: `apps/web/src/messages/ar.json` → `lmName` (six new
  places), `outsideCorridor`, `mission.duty`, `mission.brief`, `mission.debate`; and the six new `lmNames` /
  `lmLines` in `apps/web/src/components/kiosk/strings.ts`. They are drafts.
- **Booth laptops**: `git pull`, `pip install -r requirements.txt` once online, `python tasks.py demo`, then try
  the duty shift with Wi-Fi off (it needs the local API, not the internet).
- Pitch deck and poster figures: every number must come from a file in `eval/results/`. New ones:
  `incidents_20261116-173152.json`.

## 3. Rules that bind (from `CLAUDE.md`)

Demo runs offline · numbers only from deterministic code, each with its source · nothing applied without an
Approve click, logged · synthetic data labelled · no claim of RTA endorsement, no RTA logo ("designed for",
"aligned with") · never commit `.env`, keys, raw data or files over 50 MB · evals write
`eval/results/<suite>_<timestamp>.json` · one row per non-trivial choice in `docs/09_DECISIONS.md` (next number:
**132**) · a change to `schemas.py` is a contract change: bump `CONTRACT_VERSION`, run `python tasks.py contract`.

Branches and PRs only; never push to `main`. Arabic strings: no digits inside strings; figures come as parameters.

## 4. How to run and test

```bash
python tasks.py test                       # pytest (217 on this branch)
python tasks.py eval-fast && python -m eval.gate
python tasks.py api                        # FastAPI on :8000; restart it after changing Python (it does not reload)
cd apps/web && npm run dev                 # Next.js on :3000
cd apps/web && npx tsc --noEmit && npx eslint src tests --quiet
cd apps/web && npx playwright test         # needs Google Chrome; about ten minutes; do not run other GPU work beside it
```

Blender models (only if a model changes; Blender 5.3, no raw map data needed):
`python scripts/landmark_sites.py && python scripts/r8b_polys.py`, then
`blender --background --python scripts/blender/build_models.py -- --only=<names>`.

Known friction:
- macOS sometimes leaves copies named `something 2.ext` in the tree. They are git-ignored, but a copy under
  `apps/web/.next` breaks `tsc`: `find apps/web/.next -name "* 2.*" -delete`.
- PRs conflict on `docs/09_DECISIONS.md` (an append-only table): keep every row in numeric order.
- The Playwright frame-rate tests fail if another browser is rendering 3D at the same time.

## 5. What changed on screen in stages 1 to 3 (for the report to the lead)

Stage 1 (#126): pale slabs and the floating frame at night gone (tower crowns keep their windows); sea-side towers
drawn solid at full height; a cut-away keeps the selected station visible in close views; new station gauge (a stack
of discs, one per 10 % of capacity, red and pulsing above the threshold ring, visible through buildings); station
roofs floodlit at night; welcome sheet centred, with a close button and backdrop click.

Stage 2 (#127): the Dubai Mall rebuilt (roof, vaults, dome, lake front); the Dubai Fountain animated, by day too;
One Za'abeel with The Link, Address Sky View, Address Downtown, Coca-Cola Arena, Burj Al Arab; fourteen places in
the Landmarks menu, two columns, each with its own camera bearing; Financial Centre station no longer hidden by a
wrongly mapped tower; "Outside the modelled corridor" for Burj Al Arab; footer text corrected.

Stage 3 (#128): duty card on the Alerts tab (incident chips with the server's resolved figures, approval inbox, shift
log, end summary); debate card on the AI team tab; printable operations brief in English and Arabic; phone width:
landmark menu on screen, no sideways scroll.

## 6. A prompt to start your Claude Code session (Fable 5.2)

> Read CLAUDE.md and docs/16_STAGE3_HANDOVER.md in full before doing anything. I am Atharva; I now own the rest of
> stage 3. Sections 1 and 2A are done (stages 1 to 3 are live). First confirm that for yourself: run the smoke test
> and tell me the contract version it reports. Then start section 2B (the duty shift on the kiosk) on a new branch.
> Stop and ask me before merging, deploying, or anything outside section 2. Do not use subagents unless I ask. Report plainly what you verified and what you could not.
