# 00 — Timeline (today = Wed 11 Nov 2026)

| Day | Date | Goal | Done when |
|---|---|---|---|
| D0 | Wed 11 Nov | Decide + tell Dr. Rachit | Email sent (submission/EMAIL_TO_DR_RACHIT.md) |
| D1 | Thu 12 Nov | Data in, baseline numbers, nomination draft | `make ingest && make baseline` run on real data; first MASE/sMAPE in eval/results; NOMINATION_CONTENT.md filled |
| D2 | Fri 13 Nov | **Nomination handed to Dr. Rachit** (he submits "within this week") | Filled content + 3–5 images sent to him |
| D3 | Sat 14 Nov | Simulator + agents (API) | `/simulate` and `/agent/plan` return correct JSON; tests green |
| D4 | Sun 15 Nov | Web UI core (map, timeline, inspector) | Full demo flow works end-to-end on laptop |
| D5 | Mon 16 Nov | Eval suites, Arabic/RTL, booth mode, offline cache | `make eval` + gate pass; `DEMO_MODE=offline` works with Wi-Fi off |
| D6 | Tue 17 Nov | Polish, poster, rehearsal, packing | 3 clean rehearsals of the 90-s script; poster PDF ready |
| — | 18–21 Nov | Exhibit (Dubai Future Week) if selected | — |
| — | 23–25 Nov | Exhibit (UAE Innovates, RTA HQ) | — |

**If you are short on time:** apply for 23–25 Nov only (gives 5 more build days). Say so in the nomination "preferred dates" field.

**Cut order if behind (cut from the bottom first):** react-three-fiber hero → SUMO → Arabic voice → "Ask the twin" chat → Arabic UI (keep Arabic poster) → never cut: forecast + simulator + approve flow + offline mode.
