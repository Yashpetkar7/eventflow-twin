# Morning checklist — EventFlow Twin booth (print and tick, ~10 minutes)

Date: ______  Names on the stand: ______________________

**Power and screens**
- [ ] Power strip in; laptop A charging; touch monitor on (picture cable **and** touch USB cable plugged in)
- [ ] Wi-Fi **off** (the demo needs no internet)

**Start**
- [ ] In the repo folder: `source .venv/bin/activate` (Windows: `.venv\Scripts\activate`), then `python tasks.py demo`
- [ ] Wait for the kiosk address; leave that window open
- [ ] Chrome full screen on the touch monitor: `http://localhost:3000/?kiosk=1` (command in `docs/BOOTH_RUNBOOK.md`)

**Check (as a visitor would)**
- [ ] Kiosk shows the attract screen with the realistic city; touch → **I'm planning the event** → ① Event → ② guess a station → ③ your idea, then the AI's plans → ④ approve → **Start again**
- [ ] Touch → **I'm travelling to the event** → a tip appears (station, time, how full) → **Finish**
- [ ] Touch → **Show me in 60 seconds** → it plays to "Before and after" and returns to the attract screen by itself
- [ ] If the city stutters: open `http://localhost:3000/?kiosk=1&quality=light`; if it still does, `http://localhost:3000/?kiosk=1&scene=v1` (older, lighter city)
- [ ] Hold the logo 3 s → full workspace opens; **Touch kiosk** brings the visitor kiosk back
- [ ] In the full workspace, tap **Guided demo** and let it finish
- [ ] Tap **World Trade Centre** → Station tab shows the **Break point** card
- [ ] **Hot day** → **AI plan** → **Plan with AI agents** → 3 options, "All … figures match" → **Approve** option 1
- [ ] **Clear approved plans**; **Landmarks → Burj Khalifa**; drag the map, then **Recentre**
- [ ] **عربي** and back to English
- [ ] Touch: tap, drag and pinch work on the monitor; buttons are easy to hit

**Booth**
- [ ] Poster up, handouts (EN + AR) at the front, backup video on laptop B and the USB stick
- [ ] Laptop B: `python3 scripts/setup_booth_laptop.py --check` printed `OK` (once per day is enough)
- [ ] One full run of the 90-second script (`exhibit/DEMO_SCRIPT_90S.md`)

If anything fails: `docs/BOOTH_RUNBOOK.md` → Recover. Write what happened here: ______________________________
