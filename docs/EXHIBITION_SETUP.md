# Exhibition setup

For the stand at Emirates Towers (18–21 Nov) and RTA HQ (23–25 Nov). Operating steps are in `docs/BOOTH_RUNBOOK.md`
and `exhibit/MORNING_CHECKLIST.md`; the kit list and rota in `exhibit/BOOTH_PLAN.md`. Figures marked **pending
verification** have not been measured; do not quote them as facts.

## Format and why

A **self-service touch kiosk** on a large landscape screen, with the 3D twin as the centrepiece, plus a presenter
laptop running the workspace and an A1 poster.

- A visitor goes from "pick an event" to "approve a plan" in one to three minutes, and can ask "what if a train
  breaks down now?". Two other journeys: "when should I leave?" and a 60-second show that plays by itself.
- Idle for 60 s → "Still there?" → back to the attract screen, so each visitor starts clean (no shift, no incident,
  no approved plan left over).
- English and Arabic at a tap, larger text, high contrast, and "reach" mode (all controls in the lower half).
- Fully offline. No personal data: the counters are anonymous and stay on the laptop.
- No voice: a noisy hall makes it of little use, and an offline Arabic voice is not confirmed on the booth laptops
  (roadmap M3).

## Footprint and hardware

| Item | Value | Status |
|---|---|---|
| Table | about 1.8 m × 0.8 m (venue table) | from the nomination; venue to confirm |
| Visitor screen | our 24–27" touch monitor, landscape, at least 1280 px wide (a tablet is not supported yet, #41) | model and touch behaviour **pending verification** (#42) |
| Laptops | A (primary) and B (backup), Windows with Intel Arc graphics or a Mac | kiosk measured on laptop A: 55.9 fps, full quality, on mains |
| Poster | A1 (59.4 × 84.1 cm) on an easel | reprint needed if already printed: figures changed on 17 Nov (see below) |
| Optional | venue screen ≥ 50" by HDMI for the attract loop | venue to confirm |
| Total weight | under 15 kg | estimate |

## Power and connectivity

| Item | Value | Status |
|---|---|---|
| Sockets | 2 × UAE 13 A (BS 1363), or one plus our power strip | from the nomination |
| Power draw | under 300 W in total | **estimate, not measured** |
| Internet | **not required**; Wi-Fi off during the demo | measured: 0 requests leave the laptop (`eval/results/ui/network.json`) |
| Frame rate needs mains | on battery the graphics are throttled; keep laptop A charging | measured (`eval/results/ui/booth_windows/`) |

## Installation, safety, storage, people

- **Install** about 30 minutes, **dismantle** about 15; no tools; one person can do it (from the nomination).
- **Safety:** no moving parts, lasers or liquids; consumer batteries only; cables taped; screen wiped regularly.
- **Storage and transport:** hand-carried daily; nothing left on site overnight.
- **People:** two team members on the stand at all times (Krishna, Atharva, Yash on a rota); one presents using the
  90-second script, one hands the screen to visitors.
- **Wording:** "prototype", "simulated", "synthetic demand", "designed for RTA's priorities"; never "used by RTA".

## Printed material changed on 17 Nov

The poster, the two handouts and the 90-second script quoted planner figures from 12 Nov. They now carry today's
build: hot day **92 → 74 %** with the recommended plan (was 92 → 70 % with "guide 35 %"), downtown night **2.25 → 0**
(was 2.25 → 1.5), **132 of 132** plan options faithful (was 48 of 48), **0 of 53** injection attacks (was 0 of 15).
Rebuild the PDFs with `python scripts/build_exhibit_print.py` before printing; a poster already printed shows the old
figures, which the screen will no longer match.
