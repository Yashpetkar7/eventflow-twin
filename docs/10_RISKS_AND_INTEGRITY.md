# 10 — Risks, mitigations, integrity

| Risk | Impact | Mitigation |
|---|---|---|
| Real data download slow / permission dialog | Blocks D1 | Start downloads today; synthetic fallback already works |
| Open data is historical (not 2026) | Credibility | State coverage dates; frame as "method validated on historical open data" |
| Few event days in data | Weak event metrics | Hybrid overlay + honest event-day reporting |
| Station renames / name mismatches | Wrong joins | Alias table + unit test listing unmatched names |
| LLM invents numbers | Trust | verify_numbers node + faithfulness eval = 1.0 |
| Venue Wi-Fi down | Demo fails | DEMO_MODE=offline, local tiles, cached agents, screen-recorded backup video |
| Laptop failure | Demo fails | Second device with the same build + MP4 backup on USB |
| Not selected for 18–21 Nov | — | Offer 23–25 Nov; reuse for portfolio, RTA hackathons, DAST NextGen award next cycle |

## Integrity rules
- Label synthetic data and assumptions everywhere (data, UI, poster, nomination).
- "Designed for / aligned with RTA priorities" — never "used by / approved by / partner of".
- Do not share the RTA template; Dr. Rachit submits.
- Credit data sources (Dubai Pulse / RTA open data, OpenStreetMap contributors).
- No personal data; aggregated station-hour only.
