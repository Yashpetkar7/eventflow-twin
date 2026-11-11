# Booth plan

## Kit list
- Laptop A (primary) with `make demo` build + charger
- Laptop B or tablet (backup) with the same build, OR the MP4 backup video on USB
- **24–27" touch-screen monitor** (the visitor station; test touch with the kiosk UI) + HDMI/USB-C cables (touch needs the USB data cable too)
- Optional: venue screen ≥ 50" for the attract loop
- A1 poster (+ 2 spare A4 one-pagers with QR code to repo/demo video)
- Power strip (UK type, BS 1363), cable tape, wireless mouse, presenter clicker
- Business cards / QR stand, microfibre cloth, water

## Layout (1.8 m × 0.8 m table)
Left: poster on easel facing the aisle. Centre: **touch screen facing the aisle** in kiosk mode – visitors tap to pick an event, scrub time and approve AI plans. Right: laptop for the presenter (mirror or control view). Stand beside, not behind, the table.

## Daily routine
- Arrive 30 min early: power on, Wi-Fi OFF, `make demo`, open `?kiosk=1`, run the 90-s script once.
- Every 2 hours: check battery, restart the browser if > 2 h uptime.
- End of day: export decisions log (visitor-approved options make a nice "what visitors chose" stat — anonymous only).

## Failure recovery (BOOTH_RUNBOOK.md will have commands)
| Failure | Do this |
|---|---|
| Web freezes | Ctrl+R; if not, restart `make demo` (≤ 60 s) |
| API error | `make api` restart; offline cache still serves agent results |
| Laptop dies | Switch to Laptop B or play the MP4 |
| Venue screen fails | Use own 27" monitor |
