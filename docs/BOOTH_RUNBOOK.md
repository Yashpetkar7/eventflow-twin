# Booth runbook — EventFlow Twin

For the two people on the stand. Laptop + touch monitor, **no internet needed**. Measured numbers: `docs/metrics.md`.

## Before the exhibition (once, at home, online)
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cd apps/web && npm install && cd ../..
python tasks.py synth                                   # only if data/synthetic is empty
```
The 3D map is already baked into the repo (`apps/web/public/geo/`). Nothing is downloaded at the venue.
Or all of it in one go, with an offline self-check at the end (use it for laptop B too):
`python3 scripts/setup_booth_laptop.py` → prints `OK — this laptop is ready`.

## Start (every morning, ~1 minute)
1. Plug in power and the touch monitor (HDMI/USB-C for picture **and** USB for touch). Turn Wi-Fi off — it is not used.
2. In the repo folder:
   ```bash
   source .venv/bin/activate
   python tasks.py demo            # same as: make demo
   ```
   It builds the offline agent cache, starts the API, builds the web app and prints the kiosk address. Leave this window open.
3. Open Chrome full screen on the touch monitor:
   ```bash
   open -a "Google Chrome" --args --kiosk "http://localhost:3000/?kiosk=1"                 # macOS
   start chrome --kiosk "http://localhost:3000/?kiosk=1"                                   # Windows
   ```
   Arabic first: add `&lang=ar`. Rehearsal with a 10-second idle timer: add `&idle=10`.
4. Ten-minute check: tap **Guided demo** and let it finish; tap a station; open **Landmarks → Burj Khalifa**; press the
   red **Recentre** button after dragging the map; switch to Arabic and back.

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
  kiosk, 60 s: `node apps/web/tests/backup_video_kiosk.mjs <url>`) and `eventflow_backup_demo.mp4` (the workspace's
  guided demo: `node apps/web/tests/backup_video.mjs <url>`).

**New on 13 Nov (later build, decisions #109–#113):**
- **Bottom-left round button = reach mode.** It moves the card and the language / text / contrast / start-again buttons into the lower half of the screen. Offer it to seated visitors. "Start again" resets it.
- **Stress test** now also shows the extra cars near the venue (under "How many come by metro?") and has **Everyday demand: Model / Real station totals**.
- **"How did the AI decide?"** now ends with the critic's verdict and **Show all tool calls**. For a juror: downtown night → stress test → crowd to about 50,000 → ask the AI → the plans say "Found by replanning", and the tool calls show round 1 failing and round 2 clearing every station.
- Plans that clear every station carry a green **Clears every station** badge.

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
| "3D needs WebGL…" message with a table | The browser lost its graphics context. Quit Chrome completely and reopen it (step 3). The table shows the same numbers meanwhile. |
| Port already in use when starting | An old run is still alive: close the old terminal window, or `lsof -ti :3000 -ti :8000 | xargs kill` (macOS/Linux). |
| Everything fails | Second laptop with the same build, or the recorded backup video on the USB stick. |

## If the touch screen stops responding
1. Check the picture: if the picture is fine but touches do nothing, it is the **USB touch cable**, not the app. Re-seat it at both ends; try another USB port.
2. Touches land in the wrong place: the touch input is mapped to the laptop's own screen. macOS: System Settings → Displays → arrange so the touch monitor is the main display (or mirror). Windows: Control Panel → Tablet PC Settings → Setup, and tap the touch monitor.
3. Touch works in other apps but not in the twin: press `Esc`, then `Cmd+R` / `Ctrl+R`.
4. While you fix it, the stand still works: leave the guided demo looping (it needs no touch) and operate with the trackpad.
5. Wipe the screen with a dry cloth; some panels ignore touches when wet or greasy.

## Shut down (every evening)
1. `Cmd+Q` / `Alt+F4` to close Chrome.
2. In the terminal press `Ctrl+C` once; both servers stop.
3. The day's approvals are in `data/processed/decisions_log.jsonl` (kept on the laptop only; no visitor data is collected).

## Do not
- Do not connect to venue Wi-Fi "to be safe" — nothing needs it, and a captive-portal pop-up can cover the kiosk.
- Do not run `npm run dev` on the stand; `python tasks.py demo` runs the production build.
- Do not say or show that RTA uses or endorses this. It is a student research prototype on synthetic baseline demand.

## Not verified yet (do this before 18 Nov)
- The real touch monitor (touch mapping, pinch zoom) and its native resolution.
- A full exhibition day on battery/mains with the lid angle and brightness you will use.
