# 90-second demo script (EN) — rehearse 3× on 17 Nov

| Time | Say | Do / on screen |
|---|---|---|
| 0–10 s | "In October 2025, GITEX was expected to bring upwards of 200,000 visitors to Dubai World Trade Centre. Which metro station breaks first – and what should planners have done about it?" | Attract screen → Start demo |
| 10–25 s | "EventFlow Twin replays GITEX 2025, Day 1. It forecasts crowding for every station on this corridor using RTA's open data and the official metro timetable, plus an event-surge model." | Load "GITEX Global 2025 – Day 1"; scrub timeline to the afternoon; World Trade Centre turns amber at [METRIC: WTC peak load, default assumptions] |
| (+10 s, optional) | "Whether it breaks depends on how full trains already are when they arrive. If they arrive with [METRIC: free space at which WTC breaks] free space or less, World Trade Centre tips over – that's what the ridership data will settle." | Evidence drawer → break-point chart (eval/results/sensitivity_*.json); or drag the attendance slider to [METRIC: break attendance, default] → WTC turns red |
| 25–55 s | "I ask the AI agents for a plan. They propose options – extra trains, a shuttle to the next station, staggered exits – and a simulator measures each one. The AI can't invent numbers; every figure comes from the simulation." | Click Plan interventions; 3 cards appear; point at Δ metrics + sources |
| 55–75 s | "A human stays in charge: I approve two. Overcapacity station-hours drop by [METRIC]. And the forecast beats a seasonal baseline with MASE [METRIC] on held-out weeks." | Approve 2 → before/after scoreboard; open Evidence drawer |
| 75–90 s | "It's built on RTA open data, works in Arabic and English, and runs offline. Next week's scenario is Dubai Future Week, right here. Your turn – tap any station and try approving a plan yourself." | Toggle AR briefly; switch to "Dubai Future Week 2026"; invite the visitor to use the touch screen |

**Arabic opener (have it checked by a native speaker):** "كم عدد الركّاب الذين سيغادرون هذا المبنى في الوقت نفسه؟ دعنا نتوقّع الزحام قبل وصوله."

**Rules:** only quote numbers from docs/metrics.json; say "simulated" for simulator results; say "prototype". GITEX visitor numbers are the organiser's *expected* figure ("upwards of 200,000", Dubai Media Office) – say "expected", and say daily attendance is our estimate (÷ 5 days).
