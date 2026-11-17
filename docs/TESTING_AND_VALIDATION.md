# Testing and validation

Every figure here is copied from a result file in `eval/results/` (CLAUDE.md rule 8: each file records suite, git
sha, timestamp, dataset version, metrics and n). Latest runs are from 16 Nov 2026 at `ff66d81` unless stated. Demand
is **synthetic** in every suite except the ridership check.

## 1. How it is checked

- `python tasks.py eval-fast && python -m eval.gate` — every suite, then every threshold in
  `eval/thresholds.yaml` (the gate fails on a threshold it has no rule for, decision #139).
- CI on every pull request: eval gate, a Postgres job, the Docker image with an offline smoke test, and the Playwright
  UI job (blocking since #52).
- 260 pytest tests and 59 Playwright tests (`pytest --collect-only`, `playwright test --list`, 17 Nov).

## 2. Results

| Area asked for | Metric | Result | File |
|---|---|---|---|
| Individual agents | plan options with every number traced to the simulator | **132 of 132** (60 scenarios, EN + AR) | `agents_20261116-204539.json` |
| | top plan relieves the hotspot / never pushes another station over | 1.0 / 1.0 | same |
| | plan latency p50 / p95 | 0.26 s / 0.55 s | same |
| Orchestration and delegation | graph and sequential engines produce identical events | 1.0 over 60 missions | `orchestration_20261116-204754.json` |
| Dynamic planning | missions that replanned; objections answered | 4; 12 of 12 | same |
| | budget respected; trace complete | 1.0; 1.0 | same |
| Evaluation agent | critic precision and recall against an independent check | 1.0 / 1.0 over 1,007 plans | `critic_20261116-204831.json` |
| Plan quality vs a baseline | goal met where an exhaustive grid meets it; relief gap to the grid's best | 22 of 22; 0.0 | `optimality_20261116-204831.json` |
| Tool execution | simulator property checks; rider conservation error | 139 pass (1.0); 0 | `simulator_20261116-204519.json` |
| Forecast | MASE, LightGBM vs seasonal naive; 80 % interval coverage | 0.78 vs 0.97; 0.81 (n = 8,904) | `forecast_20261116-2045.json` |
| Multi-step autonomy | duty shifts that end honestly; never apply without a human | 15 of 15; 1.0 | `incidents_20261116-204848.json` |
| Invalid and hostile input | prompt-injection cases that changed a plan | **0 of 53** (EN, AR, mixed; 10 OWASP categories) | `redteam_20261116-204631.json` |
| | injection detection recall; false positives | 0.93; 0.0 | same |
| Privacy and safety | harmful or off-topic questions refused; over-refusal | 1.0; 0.0 (40 questions) | `safety_20261116-204835.json` |
| Performance | missions p50 / p95 on the benchmark laptop; simulator runs per second | 0.56 s / 1.28 s; 36.3 | `gpu_benchmark_20261116-204908.json` |
| Load | 384 requests from 8 clients: errors; p95 | 0; 2.17 s (13 Nov, earlier build) | `latency_20261113-094309.json` |
| Kiosk on the booth laptop | frame rate on mains, Chrome held at about 56 Hz | 55.9 fps average, lowest second 52.2, full quality (tier 0) | `eval/results/ui/booth_windows/kiosk_default_mains.json` |
| Offline | requests leaving the laptop during a demo | 0 | `eval/results/ui/network.json` |

## 3. What is measured versus simulated

- **Measured:** the system's own behaviour above (correctness, faithfulness, latency, safety, frame rate).
- **Simulated:** every crowd and relief figure on screen; they are outputs of the simulator on synthetic demand,
  not observations of Dubai Metro.
- **Not measured yet:** accuracy against real hourly ridership (blocked, `ridership_check_20261112-1947.json`); the
  booth's own touch monitor; recovery when a live model fails mid-mission (the code path exists, there is no suite).

## 4. Known test issues

None open on `main` on Windows since #131 (17 Nov). Arabic strings are drafts until the native review (#43).
