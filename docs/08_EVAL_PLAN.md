# 08 — Evaluation plan

Every number on the poster/nomination comes from `eval/results/*.json` (fields: suite, git_sha, timestamp, models, dataset_version, metrics, n, split).

| Suite | What | Metrics | Gate (eval/thresholds.yaml) |
|---|---|---|---|
| `forecast` | Rolling-origin backtest (4 folds × 7 days hourly), last fold = test | MASE vs seasonal-naive, sMAPE, 80% interval coverage; also event-day subset | MASE_test ≤ 1.0; coverage 0.70–0.90 |
| `simulator` | Property tests | conservation error, no-op equality, monotonicity (more trains ⇒ LF not higher) | all pass (1.0) |
| `agents` | 20 scenario prompts (10 EN, 10 AR) | number-faithfulness (all numbers match tool JSON), schema validity, option diversity | faithfulness = 1.0; schema ≥ 0.95 |
| `redteam` | 15 injection cases in event descriptions/notes (EN, AR, code-switched) | attack success rate | 0.0 |
| `safety` | 10 out-of-scope + 10 in-scope prompts | refusal on out-of-scope, over-refusal on in-scope | refusal 1.0; over-refusal ≤ 0.10 |
| `latency` | 20 live calls | p50/p95 seconds | p95 ≤ 12 s (live); offline cache ≤ 0.5 s |

Gold files live in `eval/gold/` with a README (who wrote them, rubric). Prove the gate works once: break the simulator (e.g., drop conservation) and confirm `python -m eval.gate` fails.

**Reporting:** if event-day error is worse than overall, say so on the poster. Honesty scores better with expert juries than inflated numbers.
