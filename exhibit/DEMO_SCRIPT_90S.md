# 90-second demo script (EN) — rehearse 3× on 17 Nov

Updated 12 Nov 2026 (task K8): numbers filled from the API and `eval/results/` (sources in `exhibit/POSTER_CONTENT.md`
§4), button names match the current app. Backup: `exhibit/video/eventflow_backup_demo.mp4` (made by
`apps/web/tests/backup_video.mjs`; on the USB stick, not in git).

| Time | Say | Do / on screen |
|---|---|---|
| 0–10 s | "In October 2025, GITEX was expected to bring upwards of 200,000 visitors to Dubai World Trade Centre. Which metro station breaks first – and what should planners do about it?" | Kiosk on the overview; tap **GITEX Global 2025 – Day 1** |
| 10–25 s | "This twin replays GITEX Day 1. It uses RTA's official metro timetable and an event-surge model – the station demand is synthetic until we get RTA's ridership data. With 40,000 visitors that day, World Trade Centre peaks at 78 % of comfortable capacity." | Play the timeline to the afternoon; World Trade Centre turns amber |
| 25–35 s | "Whether it breaks depends on how full trains already are. The twin shows the crowd size where it tips over: about 44,400 visitors – or about 14,900 if trains arrive nearly full." | **Station** tab → Break point card |
| 35–55 s | "Now a hot day: more people take the metro, and it goes to 92 %. I ask the AI agents for a plan. They propose options from a fixed menu, and a simulator measures each one – the AI can't invent numbers; every figure is checked." | Tap **Hot day** → **AI plan** → **Plan with AI agents**; point at the checklist and "All 7 figures match" |
| 55–75 s | "A human stays in charge. I approve option 1 – guide 35 % of riders to Emirates Towers on foot – and the peak drops from 92 to 70 %, simulated." | **Approve** on option 1 → before/after in the **Report** tab |
| 75–90 s | "It works in Arabic and English, and runs completely offline. Your turn – pick an event, or tap a landmark, and try approving a plan yourself." | Tap **عربي** and back; hand over the touch screen |

**If asked about the AI:** "Offline it uses a deterministic plan search with template explanations; with a key it can
also ask OpenAI GPT-5 for extra plans and wording – the same simulator and number check apply either way."
**If asked about accuracy:** "Our ML forecaster beat a seasonal baseline in a backtest (MASE 0.78 vs 0.97), but on
synthetic data. We have checked the demand against RTA's open ridership: the real numbers are higher at five of six
stations, and during GITEX 2025 metro arrivals at World Trade Centre were about 1.65 times a normal day. The 2025 data
has no time of day yet, so the hourly calibration uses 2024 next."

**Arabic opener (have it checked by a native speaker):** "كم عدد الركّاب الذين سيغادرون هذا المبنى في الوقت نفسه؟ دعنا نتوقّع الزحام قبل وصوله."

**Rules:** only quote numbers from `docs/metrics.md`, `exhibit/POSTER_CONTENT.md` §4 or `eval/results/`; say
"simulated" for simulator results and "synthetic" for demand; say "prototype"; "designed for / aligned with RTA",
never "used by". GITEX visitor numbers are the organiser's *expected* figure ("upwards of 200,000") – say
"expected"; the 40,000 for Day 1 is our assumption.
