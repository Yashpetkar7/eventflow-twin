# Booth runbook — EventFlow Twin

For the two people on the stand. Laptop + touch monitor, **no internet needed**. Measured numbers: `docs/metrics.md`.
Last updated 18 Nov 2026 for API contract 1.18.0 (the assistant and runs, docs/18).

## Before the exhibition (once, at home, online)
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd apps/web && npm install && cd ../..
python tasks.py synth                                   # only if data/synthetic is empty
```
The 3D map is already baked into the repo (`apps/web/public/geo/`). Nothing is downloaded at the venue.
### Update a laptop that already runs the booth (18 Nov, contract 1.18.0): both laptops, online, once
```bash
git pull origin main
python3 scripts/setup_booth_laptop.py          # Windows: py scripts\setup_booth_laptop.py
```
That one command reinstalls `requirements.txt` and the web packages, rebuilds the offline agent cache and the production
web build, then runs the offline self-check. It takes about 10 minutes and ends with `OK — this laptop is ready`. On
18 Nov, on the build before the assistant (1.16.0), the check reported: an AI plan with 3 options and verified numbers, 18 agents on LangGraph, the
kiosk page rendering. `--check` on its own skips the install **and the web build**, so it can pass on an old build: use
it only to re-test a laptop you have just updated.
- The only package added since 16 Nov is `langgraph==1.2.22`. Without it the same agents run in sequence and the AI team
  tab says so; the booth should show LangGraph.
- Then turn Wi-Fi off and run `python tasks.py demo` once, as on the stand.
- Check: `curl -s localhost:8000/healthz` → `"contract":"1.18.0"` and `"engine":"graph"`. `"engine":"seq"` means LangGraph is
  missing: run the setup again, online.

Optional, with the team's OpenAI key in `.env`: `python tasks.py record-missions` records the agents' model answers for
the demo scenarios (then commit `data/demo_cache/llm/`). **None are recorded yet** (there is no `data/demo_cache/llm/`), so
no language model runs at the booth: the agents use their code rules and the screens say so ("Read by word rules: no AI
model on this machine"). Every number comes from the simulator either way.

## Start (every morning, ~1 minute)
1. Plug in power and the touch monitor (HDMI/USB-C for picture **and** USB for touch). Turn Wi-Fi off — it is not used.
2. In the repo folder:
   ```bash
   source .venv/bin/activate
   python tasks.py demo            # same as: make demo
   ```
   It first runs the pre-flight (`python tasks.py doctor`: pinned packages, the LangGraph engine, data, scene, free
   ports) and stops with the fix if anything is wrong; then it builds the offline agent cache, starts the API, checks
   that the API reports the `graph` engine, builds the web app and prints the kiosk address. Leave this window open.
   On Windows activate with `.venv\Scripts\activate` instead of `source .venv/bin/activate`.
   If UI tests or rehearsals registered test events (the duty inbox and rider page at `/inbox` and `/travel` keep
   them), run `python tasks.py clean-store` once before opening; it keeps the decision log.
3. Open Chrome full screen on the touch monitor:
   ```bash
   open -a "Google Chrome" --args --kiosk "http://localhost:3000/?kiosk=1"                 # macOS
   start chrome --kiosk "http://localhost:3000/?kiosk=1"                                   # Windows
   ```
   Arabic first: add `&lang=ar`. Rehearsal with a 10-second idle timer: add `&idle=10`.
4. Ten-minute check: tap **Guided demo** and let it finish; tap a station; open **Landmarks → Burj Khalifa**; press the
   red **Recentre** button after dragging the map; switch to Arabic and back.
5. Agent team check: **Hot day** → **AI team** tab → **Run the AI team**: the layers light up, the feed fills, the
   critic's table and stress tests appear. **Alerts** tab: the watcher shows World Trade Centre "crosses the line at
   15:00". Approve the option marked **Recommended** in **AI plan** (the 90-second script does the same; option 1 is not
   always the recommended one), then **AI team**: the messenger's drafts appear (marked DRAFT).
6. Loop check (new 17–18 Nov; nothing here needs a language model):
   - **AI plan** → **Brief the team**: tap an example brief → **Read my brief**. It shows "Here is what I understood" and
     "Read by word rules: no AI model on this machine". **Confirm and plan** starts the mission.
   - Tick **Ask me during planning** first to see the team stop and ask: "Plan for it?" (**Yes, plan for …**) and, if no
     plan clears the line, **Show me the best plans** / **Try one more round**.
   - On an option card, **Reject** asks why (**Too expensive** / **Not enough relief**, or your own words) → **Reject and
     replan** → "Round 2: the team replanned with your feedback".
   - **Alerts** → **Event chain · agents trigger each other** → **Start the chain**. After you approve, **Conditions
     changed?** (Heavy rain, Train fault, Crowd surge, Crowd 30% bigger) makes the Watcher re-check the day. Events
     registered at `/inbox` start the same chain and its questions are listed there under "Questions from the team",
     answered with one tap.

7. Assistant check (new 18 Nov, contract 1.17.0 and 1.18.0; no language model needed): **Hot day** → **Ask** tab → tap **Which
   station gets overcrowded?**, then type "Why?". Type "Increase attendance to 60,000 and shorten the exit window to
   45 minutes": the answer shows a green "Scenario changed" card and the two sliders on the left move. **Undo this
   change** puts them back. **AI plan** now shows the run's status, an **Auto-run** switch, **Compare these plans on seven
   objectives** and the **Run history** (contract 1.18.0). On the kiosk: **I'm travelling to the event** → **Ask about your trip** → **Step-free
   access?** shows what RTA publishes, with its source. After pulling, run the setup once so the web build has the tab.

## The visitor kiosk (`?kiosk=1`; kiosk plus since 13 Nov)
- **Attract screen** (golden-hour 3D city, "Will the metro cope?", a live fact from the twin, today's visitor count)
  until someone touches it. The kiosk shows the **realism city at full quality** and, on a laptop that cannot hold
  50 fps, steps down to a lighter level by itself within seconds (decision #108). If it still stutters:
  `?kiosk=1&quality=light` starts on the lighter level, `?kiosk=1&scene=v1` shows the older corridor city (the kiosk
  also switches to that by itself after 20 s under 24 fps).
- **Two ways in**, plus a show:
  - **I'm planning the event** — four steps with a highlighted stepper: **① Event** (pick one, or build **your own
    event**, + weather) → **② Crowd** (guess the busiest station, the twin reveals it; optional **Stress-test it**:
    crowd-size slider, share of visitors by metro, a closed station) → **③ AI plan** (**your idea first**, then 3
    options; **How did the AI decide?** shows the agent's steps and the number check) → **④ Your decision** (approve →
    before/after, you vs the AI, **Undo approval**, QR slot "link coming soon"). On the downtown night the result
    screen also offers **RTA's New Year's Eve measures** (reported measures, labelled, simulated as a comparison).
  - **I'm travelling to the event** — the busiest moment and our tip (station and time), **Fastest** or **Quieter**
    (families, People of Determination).
  - **Show me in 60 seconds** — the planner story plays by itself with captions; any touch takes over. Good for a
    judge with one minute, and for a queue.
- **Start again** and **عربي / English** are always visible; **Aa** = larger text; the **half-moon** = high contrast.
- **60 s without a touch** → "Still there?" with a 10-second countdown → back to the attract screen for the next visitor
  (`&idle=30` for a shorter timer while rehearsing).
- **Team only:** press and hold the **EventFlow Twin logo for 3 seconds** → the full workspace (all settings, My plan,
  Report with **Print / save as PDF**). The header's **Touch kiosk** button returns to the visitor kiosk.
  Press and hold the **grey footer line for 3 seconds** → anonymous booth statistics for today (touches, paths chosen,
  quiz answers, approvals), with **Save as file**. Copy the numbers into the evening report.
- The earlier kiosk (workspace with big targets + idle guided demo) is still at `?kiosk=classic` (used by the soak test).
- Backup videos (git-ignored, in `exhibit/video/`, copy both to the USB stick): `eventflow_kiosk_show.mp4` (the visitor
  kiosk, about 70 s: `node apps/web/tests/backup_video_kiosk.mjs <url>`) and `eventflow_backup_demo.mp4` (the workspace's
  guided demo: `node apps/web/tests/backup_video.mjs <url>`).

**New on 13 Nov (later build, decisions #109–#113):**
- **Bottom-left round button = reach mode.** It moves the card and the language / text / contrast / start-again buttons into the lower half of the screen. Offer it to seated visitors. "Start again" resets it.
- **Stress test** now also shows the extra cars near the venue (under "How many come by metro?") and has **Everyday demand: Model / Real station totals**.
- **"How did the AI decide?"** now ends with the critic's verdict and **Show all tool calls**. For a juror: downtown night → stress test → crowd to about 50,000 → ask the AI → the plans say "Found by replanning", and the tool calls show round 1 failing and round 2 clearing every station.
- Plans that clear every station carry a green **Clears every station** badge.
- **Landmarks (decision #116):** touch a landmark or its name (Burj Khalifa, Museum of the Future, Emirates Towers, …). The camera turns all the way round it and a panel names it. "Back to the corridor" returns; any drag stops the turn.

**New on 16–18 Nov (decisions #129, #141, #142):**
- After approving a plan, the result screen offers **What if a train breaks down now?**: a duty step with one **Approve**,
  **Skip** and **Start again**. The fault is an assumption and the screen says so ("An assumption for this what-if, not an
  RTA figure.").
- Switching **عربي / English** in the middle of a journey now asks again for the plan on screen, so the option titles
  follow the language (before 17 Nov they stayed in the language they were fetched in). Arabic strings are drafts until a
  native speaker has reviewed them (#43).
- A browser without WebGL no longer fails to load: the kiosk runs without the 3D map and the workspace shows its table
  view.

## What visitors can do without help
Pick an event · drag the time bar · tap a station or a landmark · **Plan with AI agents** → Approve / Reject · **My plan** ·
language switch. After 60 s without a touch the guided demo plays by itself; any touch hands control back.

## Recover
| What you see | What to do |
|---|---|
| Amber banner "The planning service is not reachable…" | The screen keeps showing saved results. Look at the terminal: if the API stopped, press `Ctrl+C` once and run `python tasks.py demo` again. The banner clears by itself within ~5 s of the API returning. |
| Blank or frozen page | Press `Cmd+R` / `Ctrl+R` (attach a keyboard). Still blank → quit Chrome, run step 3 again. |
| The view is lost somewhere over the desert | Tap **Recentre** (the round target button on the right edge; it turns red when the view has been moved) or press `Home`. |
| The map is slow or stutters | Nothing to do: the twin lowers its own quality (no ambient occlusion → smaller shadows → no shadows) when it stays under 40 fps for 3 s, and raises it again later. Check the laptop is on mains power and not in low-power mode. |
| "3D needs WebGL…" message with a table | The browser has no graphics context. Nothing crashes: the workspace shows the table with the same numbers and the kiosk runs without the 3D map. To get the 3D back, quit Chrome completely and reopen it (step 3). |
| Port already in use when starting | An old run is still alive: close the old terminal window, or `lsof -ti :3000 -ti :8000 | xargs kill` (macOS/Linux). |
| Everything fails | Second laptop with the same build, or the recorded backup video on the USB stick. |

## If the touch screen stops responding
1. Check the picture: if the picture is fine but touches do nothing, it is the **USB touch cable**, not the app. Re-seat it at both ends; try another USB port.
2. Touches land in the wrong place: the touch input is mapped to the laptop's own screen. macOS: System Settings → Displays → arrange so the touch monitor is the main display (or mirror). Windows: Control Panel → Tablet PC Settings → Setup, and tap the touch monitor.
3. Touch works in other apps but not in the twin: press `Esc`, then `Cmd+R` / `Ctrl+R`.
4. While you fix it, the stand still works: leave the guided demo looping (it needs no touch) and operate with the trackpad.
5. Wipe the screen with a dry cloth; some panels ignore touches when wet or greasy.

## Printed material and the USB stick (rebuilt 18 Nov from `main` at `d9838af`)
- **Poster and handouts:** with the API and web app running, `python scripts/build_exhibit_print.py` (it captures the hero
  image from the live twin) writes `exhibit/poster/EventFlow_Twin_A1_poster.pdf` and the English and Arabic A4 handouts.
  PDFs are git-ignored, so **rebuild them after any change to the plans or figures**: a poster printed earlier shows the
  old ones. Leave the QR out until Dr. Rachit has approved the public link, then add `--qr <url>`.
- **Demo script:** `exhibit/DEMO_SCRIPT_90S.md` approves the option marked **Recommended**.
- **Backup videos:** the two commands under the visitor kiosk section; copy both files to the USB stick.

## Shut down (every evening)
1. `Cmd+Q` / `Alt+F4` to close Chrome.
2. In the terminal press `Ctrl+C` once; both servers stop.
3. The day's approvals are in `data/processed/decisions_log.jsonl` (kept on the laptop only; no visitor data is collected).

## Do not
- Do not connect to venue Wi-Fi "to be safe" — nothing needs it, and a captive-portal pop-up can cover the kiosk.
- Do not run `npm run dev` on the stand; `python tasks.py demo` runs the production build.
- Do not say or show that RTA uses or endorses this. It is a student research prototype on synthetic baseline demand.

## Not verified yet
Status on 18 Nov, still open: the real touch monitor (touch mapping, pinch zoom, native resolution; #42), a full
exhibition day, both booth laptops updated and run once with Wi-Fi off (#44), and the native Arabic review (#43). The
Windows measurements below are from 13 and 15 Nov, before the 16–18 Nov changes (agent team, duty shift, brief and
checkpoints): repeat `node tests/kiosk_fps.mjs` on the final build.

- **Windows laptop on MAINS power, measured 15 Nov 2026** — same laptop as the battery run below, plugged in and charging,
  OneDrive stopped for the runs, no other 3D page open. Production build of `main` at `b9bfd2d` (includes the realism
  passes of 13 Nov, #114–#116). One warm-up run was discarded. Every number is from a file in `eval/results/ui/booth_windows/`
  or `eval/results/ui/realism_r7/`.

  | Kiosk attract screen (`node tests/kiosk_fps.mjs`, headless Chrome, 3D at 1920×1080, 20 one-second samples) | Runs | Average fps per run | Lowest second per run | Quality tier at the end | File |
  |---|---|---|---|---|---|
  | `?kiosk=1` (default: realism scene, full quality) | 5 | 56.2, 55.9, 56, 56.4, 55.9 | 52.9, 52.1, 52.5, 54.3, 52.2 | 0, 0, 0, 0, 0 | `kiosk_default_mains.json` |
  | `?kiosk=1&quality=light` | 3 | 56.7, 56.3, 56.3 | 56.2, 53.7, 55.9 | 1, 1, 1 | `kiosk_light_mains.json` |
  | `?kiosk=1&scene=v1` (corridor scene) | 3 | 55.9, 56.3, 56.1 | 49.6, 55.9, 55.6 | 0, 0, 0 | `kiosk_v1_mains.json` |

  - **The level it settles on: full quality (tier 0) in 5 of 5 runs**, no step-down; lowest second
    52.1 fps. Every scene and level reads about 56 fps: Chrome on this laptop was held at about 56 Hz in these
    runs (the corridor scene too), so 56 is the cap here, not the load.
  - **The installed Chrome started with `--kiosk`** (`node tests/kiosk_real_chrome.mjs`, real full screen on the laptop's own
    screen: screen 1280x800, window 1280x800 at device pixel ratio 1.5, canvas 1920x1200 px), measured after 30 s on
    `/?kiosk=1`: average 56.1 fps, lowest second 55.4, tier 0 (`kiosk_real_chrome_mains.json`).
  - **Reach mode** (round button bottom-left) pressed once in that window: `kiosk_real_chrome_mains_reach.png` — the
    language, contrast and text-size controls move to the lower left.
  - **With the 60 Hz cap removed** (`node tests/r7_fps.mjs windows_after_mains`): workspace on the realism scene
    89.2–122.2 fps median over 8 camera / time cases (lowest second 79.2);
    kiosk attract screen 72.2 median, tier 0, with one stall of 30.9 fps in its 10 samples.
  - **Not measured:** the booth's touch monitor (C4); a soak on this laptop.
- **Windows laptop, measured 13 Nov 2026 — ON BATTERY, not on mains (the charger was not available).** Lenovo 83DA,
  Intel Core Ultra 5 125H, 16 GB, `ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)`, built-in screen 1920×1200 at 59 Hz with
  150 % scaling, Balanced power plan, OneDrive running. Production build of `main` at `19bb596` plus one test fix (commit `1162057`). A battery run is the
  pessimistic case on this laptop; **repeat on mains before the exhibit** (same commands, files named `…_mains.json`).
  Every number below is from a file in `eval/results/ui/booth_windows/` or `eval/results/ui/realism_r7/`.

  | Kiosk attract screen (`node tests/kiosk_fps.mjs`, headless Chrome, 3D at 1920×1080, 20 one-second samples) | Runs | Average fps per run | Lowest second per run | Quality tier at the end | File |
  |---|---|---|---|---|---|
  | `?kiosk=1` (default: realism scene, full quality) | 5 | 59.3, 51.9, 59.7, 59.3, 59.4 | 50, 17.2, 55.1, 47.2, 50.2 | 0, 1, 0, 0, 0 | `kiosk_default_battery.json` |
  | `?kiosk=1&quality=light` | 3 | 59.9, 59.9, 59.9 | 59, 59, 59.4 | 1, 1, 1 | `kiosk_light_battery.json` |
  | `?kiosk=1&scene=v1` (corridor scene) | 3 | 59.9, 59.8, 59.7 | 59.1, 58, 54.8 | 0, 0, 0 | `kiosk_v1_battery.json` |

  - **Which level it settles on:** full quality (tier 0) in 4 of 5 runs; in 1 run it stepped down to tier 1 by itself
    after a stall (lowest second 17.2 fps). So on battery this laptop sits at the edge of full quality.
  - **In a real Chrome window on the laptop's own screen** (`EFT_HEADED=1`, window 1280x665 at device pixel ratio 1.5, canvas 1336x998 px):
    averages 59.6, 59.6 fps, lowest seconds 53.1, 54.2, tier 0, 0
    (`kiosk_default_real_screen_battery.json`). Chrome did not go truly full screen under automation, so this window is
    smaller than the booth view; the headless 1920×1080 rows above are the harder case.
  - **With the 60 Hz cap removed** (`node tests/r7_fps.mjs windows_after_battery`, file `realism_r7/windows_after_battery_fps.json`):
    workspace on the realism scene 99.9–134 fps median over 8 camera / time cases
    (lowest second 93.8); kiosk attract screen 71.9 median, 58.8 lowest, tier 0.
  - **Not measured in this battery run:** mains power and Chrome's real `--kiosk` full screen — both measured on 15 Nov, above.
  - **These runs are on `19bb596`.** `main` has since gained the realism passes of 13 Nov (decisions #114 and #115:
    rooms behind windows, cloud shadows, figures at stations, landmark models with 5 times the triangles). The mains
    run must be on the current `main`; expect the kiosk to step down to tier 1 a little more often than in the table above.
  - The two scripts now label the power source correctly on a Windows laptop that is plugged in and charging (review of
    PR #16: a charging status used to be written down as battery).
- The real touch monitor (touch mapping, pinch zoom) and its native resolution.
- A full exhibition day on battery/mains with the lid angle and brightness you will use.
