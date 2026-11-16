# GPU access request — what we would run, why, and what is already measured

Prepared 16 Nov 2026 by Yash for the faculty lead. Every figure below is measured and names its file; nothing is an
estimate unless it says so. Decision rows: `docs/09_DECISIONS.md` #135.

## 1. What we ask for

Access to one of the college's GPU machines to do two things the laptop cannot do well:

| | Workload | Why a GPU | Status of our code |
|---|---|---|---|
| **A** | **Host an open-weight language model on campus** for the 8 model agents (intake, the four specialists, explainer, messenger, ask-the-twin) | The agents then run with a real model, offline, with no external API, no key and no data leaving campus | **Ready**: `LLM_PROVIDER=local` talks to any OpenAI-compatible server (vLLM, Ollama, llama.cpp); tested against a stand-in server (`tests/test_local_llm.py`) |
| **B** | **Uncertainty sweeps**: every plan in the exhaustive grid against tens of thousands of what-if days (attendance, metro share, weather, incidents) | Thousands of independent simulator runs; a batched simulator on a GPU could run them together | **Measured on CPU** (below); the batched GPU simulator is not written yet and would be checked against the current one before any result is used |

A is the priority: it is the one change that turns "agents with code rules" into "agents with a model" at the booth
and in the product, while keeping every rule we have (numbers only from the simulator, a human approves).

## 2. Why — what we measured

| Measure | Result | File |
|---|---|---|
| Live GPT-5 through the external API, time per plan | **66 s typical, 96 s p95** — too slow for a visitor; needs an internet connection, a paid key and sends scenario data off campus | `docs/LIVE_AI_TEST.md`, `eval/results/live/agents_20261114-010408.json` |
| Live GPT-5, numbers in the model's text that match the simulator | **1.0** (48 options) — the verification design works with a real model | same |
| Agent team without a model (code rules), time per mission on this laptop | **0.45 s typical, 1.30 s p95** (20 scenarios, LangGraph engine; dev servers running beside it) | `eval/results/gpu_benchmark_20261116-204249.json` |
| Simulator, one CPU core | **41.6 runs per second** | same |
| Uncertainty sweep at that speed (48 grid plans per day) | **3.2 h** for 10,000 what-if days, **32 h** for 100,000 (one core) | same |

Laptop: Intel 64-bit, 14 logical cores, Windows, Python 3.11 (from the same file). The sweep figures are for one core;
spreading it over the laptop's cores would cut them roughly by the core count — a CPU cluster could also do B. That is
why A, not B, is the main reason for asking.

## 3. What happens on day one of access (all commands exist)

```bash
# on the GPU machine: serve an open-weight instruction model with JSON-schema output (vLLM shown; Ollama works too)
vllm serve <model-name> --port 8001 --max-model-len 16384

# on our side (laptop on the campus network, or the GPU machine itself)
export DEMO_MODE=live LLM_PROVIDER=local LLM_BASE_URL=http://<gpu-host>:8001/v1 LLM_MODEL=<model-name>
python -m eval.suites.gpu_benchmark --llm      # per-call latency, schema-valid answers, tokens per second
python -m eval.suites.agents                   # number faithfulness must stay 1.0
python -m eval.suites.redteam                  # 53 attacks: successful attacks must stay 0
python tasks.py record-missions                # record the answers so the booth replays them offline
```

**Acceptance before anything is shown to visitors** (the gate's existing rules): number faithfulness 1.0, red-team
0 successful attacks, every mission inside its budget, and the screen saying "AI answers recorded <date> · <model>".
If the open model fails any of these, the booth stays on code rules and we report the result as it is.

## 4. Size of the machine (general guidance, to be confirmed on the actual GPU)

| Model size | Memory for the weights (approximate) | Fits on |
|---|---|---|
| 7–8 billion parameters, 16-bit | about 16 GB | a 24 GB GPU |
| 7–8 billion, 4-bit quantised | about 5 GB | most GPUs |
| ~70 billion, 4-bit quantised | about 40 GB | a 48 GB or 80 GB GPU |

We would start with a 7–8B model (enough for structured JSON proposals and short bilingual texts) and only ask for a
larger one if the benchmark shows the small one fails the acceptance rules.

## 5. What we need to know from the lab

1. GPU model and memory (e.g. 24 / 48 / 80 GB), and how many.
2. How we get on: SSH, Slurm jobs, or JupyterHub — and whether a model server may keep running on a port during the
   exhibit week, or only in scheduled jobs (then we record answers in a job and replay them, which the code supports).
3. Storage for model weights (5–40 GB) and whether the machine can download them once.
4. Hours per week we may use.

## 6. What we do not claim

- No GPU speed-up is claimed until `gpu_benchmark --llm` has been run on the GPU; this page will be updated with that file.
- The batched GPU simulator for B does not exist yet.
- Demand is synthetic at the hourly level (labelled everywhere); a GPU does not change that — real hourly ridership does (docs/17 WP8).
