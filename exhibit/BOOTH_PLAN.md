# Booth plan

Updated 12 Nov 2026. Commands and recovery steps: `docs/BOOTH_RUNBOOK.md`. Every morning: `exhibit/MORNING_CHECKLIST.md`.
On Windows use `python tasks.py <task>` (or `py`) wherever `make <task>` appears in older notes.

## Kit list
- **Laptop A** (primary) + charger — set up and checked with `python3 scripts/setup_booth_laptop.py` (prints `OK`)
- **Laptop B** (backup) — same script, same `OK`; plus the backup video on its desktop
- **USB stick**: `exhibit/video/eventflow_backup_demo.mp4` (59 s; make it with `node apps/web/tests/backup_video.mjs`),
  the poster and handout PDFs, and a copy of the repo folder
- **24–27" touch monitor** (the visitor station) + HDMI/USB-C for picture **and** the USB cable for touch (task C4)
- Optional: venue screen ≥ 50" for the attract loop (guided demo plays by itself after 60 s idle)
- **A1 poster** (`exhibit/poster/EventFlow_Twin_A1_poster.pdf`) on an easel; **A4 handouts** in English and Arabic
  (`EventFlow_Twin_A4_handout_EN.pdf` / `_AR.pdf`, ~50 each) — print from `python scripts/build_exhibit_print.py`
  (add `--qr <link>` only after Dr. Rachit approves the public link)
- Power strip (UK type, BS 1363), cable tape, wireless mouse, microfibre cloth, water
- Printed `exhibit/MORNING_CHECKLIST.md`, `exhibit/DEMO_SCRIPT_90S.md`, `exhibit/JURY_QA.md`

## Layout (1.8 m × 0.8 m table)
Left: poster on easel facing the aisle. Centre: **touch screen facing the aisle** in kiosk mode — visitors pick an
event, drag the time bar, ask the AI agents and approve or reject a plan. Right: presenter laptop. Handouts at the
front edge. Stand beside, not behind, the table.

## People
Two of us on the stand at all times (rota agreed in the team chat). One presents (90-second script), one hands the
screen to visitors and answers questions (`JURY_QA.md`). Say "prototype", "simulated", "synthetic demand",
"designed for RTA" — never "used by RTA".

## Daily routine
- Arrive 30 min early: `exhibit/MORNING_CHECKLIST.md` (about 10 minutes).
- Every 2 hours: battery and charger; reload the kiosk page if the browser has run more than 2 hours.
- End of day: note how many visitors approved / rejected plans (`GET /decisions` or the Report tab; anonymous) —
  a nice "what visitors chose" line for the next day.

## Failure recovery (full commands in docs/BOOTH_RUNBOOK.md)
| Failure | Do this |
|---|---|
| Web page frozen | Reload (Ctrl/Cmd+R); if not, stop and restart `python tasks.py demo` (≤ 60 s) |
| API error banner | The app keeps showing saved results; restart `python tasks.py demo` |
| Touch stops working | Re-plug the touch USB cable; use the mouse meanwhile |
| Laptop A dies | Move the monitor to Laptop B (already set up), or play the backup video |
| Venue screen fails | Use our own monitor only |
