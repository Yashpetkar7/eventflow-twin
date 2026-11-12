# A1 poster content (portrait 594 × 841 mm)

Updated 12 Nov 2026 (task K8). Every number below comes from the API or `eval/results/` / `docs/metrics.md`; the
source is in brackets — keep the brackets out of the printed poster, keep the words "simulated", "synthetic" and
"prototype" in. Re-check the numbers after the realism pass if anything in the simulator changes.

**Title:** EventFlow Twin — Predict the crowd before it arrives
**Arabic subtitle:** توأم رقمي بالذكاء الاصطناعي للتنقّل الذكي أثناء الفعاليات (have a native speaker verify — task C5)
**Strap:** Interactive digital twin demonstrator · Agentic AI for event-ready mobility on Dubai's busiest corridor · Try it on the touch screen · Research prototype · SP Jain School of Global Management, Dubai

1. **The challenge (40 words):** GITEX Global 2025 was expected to bring 200,000+ visitors to Dubai World Trade Centre over five days. Such events concentrate trips into a few hours at a few stations. Planners need to know where capacity breaks – before it happens.
2. **How it works (diagram):** RTA timetable (GTFS) + OpenStreetMap → Forecast (weekday profile + event surge) → Hotspots → Planning agent proposes → Simulator measures → Human approves → Before / after.
3. **What's new (3 bullets):** event-aware what-if planning · multimodal interventions (trains, wayfinding, shuttles, robotaxis, staggered exits) · auditable AI: every number comes from the simulator and is checked; nothing is applied without human approval.
4. **Evidence box** (all on synthetic demand until RTA ridership is ingested):
   | | |
   |---|---|
   | World Trade Centre, GITEX 2025 Day 1, 40,000 assumed visitors | peak load **78 %** of comfortable capacity [`/agent/plan`, gitex2025_d1] |
   | Crowd size at which it tips over (85 % line) | about **44,400** visitors; **14,900 – 44,400** depending on how full trains arrive [`/breakpoint`] |
   | Same day, hot weather (55 % take the metro) | **92 %** → **70 %** with the top plan (guide 35 % of riders to Emirates Towers on foot), simulated [`/agent/plan`, weather hot] |
   | Downtown celebration night (hypothetical) | over-threshold station-hours **2.25 → 1.25** with shuttles + robotaxi staging, simulated [`/agent/plan`, downtown_night] |
   | Every number in AI plan texts traced to the simulator | **48 of 48** options [`eval/results/agents_20261112-163846.json`] |
   | Prompt-injection attacks that changed a plan | **0 of 15** (English, Arabic, mixed) [`eval/results/redteam_20261112-163848.json`] |
   | Forecasting model backtest (synthetic data) | MASE **0.78** vs **0.97** seasonal baseline [`eval/results/forecast_20261112-0918.json`] |
   | 3D twin | **60 fps** at 1920×1080, runs fully offline, 0 requests outside the laptop [`docs/metrics.md`] |
5. **Built around RTA AI Strategy priorities (alignment, not endorsement):** ① Congestion reduction – measures over-capacity station-hours removed by each plan · ② Agentic AI – a planning agent proposes and compares plans, the simulator produces every number · ③ Human approval – nothing applied without a planner's OK; every decision logged.
6. **Data & limits:** RTA open data (official GTFS metro timetable), OpenStreetMap (© OpenStreetMap contributors); station demand is **synthetic and labelled** until RTA metro ridership (now listed as open on data.dubai) is ingested; attendance, metro share and train fullness are assumptions; research prototype, not an operational RTA system.
7. **Team + QR:** Krishna Mathur · Atharva Soundankar · Yash Petkar (MAIB, Sep 2025) · Supervisor: Dr. Rachit Garg (to confirm) · QR to the live demo link (only after the production link is approved — K7) or to the demo video.

Visual: hero screenshot `submission/images/final/1_overview_golden_hour.png` (top 40 %), pipeline diagram, evidence
box, `5_arabic_view.png` small, `6_break_point.png` next to the break-point row. Light background, one blue accent.
**No RTA logo.**
