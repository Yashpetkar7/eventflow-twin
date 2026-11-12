# CLAUDE.md — EventFlow Twin

You are helping a team of three MAIB students (Krishna Mathur – lead, Atharva Soundankar, Yash Petkar; SP Jain School of Global Management, Dubai, Sep 2025 batch) build an exhibit-ready prototype in ~6 days for the RTA R&D & Innovation Zone (18–21 Nov 2026 Emirates Towers; 23–25 Nov 2026 RTA HQ).

## Product in one sentence
An agentic-AI digital twin that forecasts hourly metro-station crowding (and a road-pressure proxy) around big events on the Sheikh Zayed Road / Trade Centre corridor and proposes interventions that a human planner approves, showing predicted before/after impact.

## Read these first (in order)
docs/02_PRD.md → docs/03_ARCHITECTURE.md → docs/05_MODELING_SPEC.md → docs/06_AGENTS_SPEC.md → docs/07_UI_SPEC.md → docs/08_EVAL_PLAN.md → docs/10_RISKS_AND_INTEGRITY.md

## Hard rules
1. **Demo must run fully offline** (no venue Wi-Fi). LLM calls must have a cached/recorded fallback (`DEMO_MODE=offline` replays `data/demo_cache/*.json`).
2. **Numbers come from deterministic code, never from the LLM.** Agents call tools (forecast, simulate, rank). The LLM only plans, selects and explains. Every number shown in the UI has a `source` field (tool name + run id).
3. **Human-in-the-loop:** no intervention is "applied" without an explicit Approve click. Log approvals to `data/processed/decisions_log.jsonl`. Principle: "human leads, AI enables".
4. **Synthetic data is labelled.** Any table derived from `data/synthetic/` carries `is_synthetic=true`; the UI shows a "SYNTHETIC" badge.
5. **No claims of RTA endorsement or partnership.** Use "designed for" / "aligned with".
6. **Never commit** `.env`, API keys, raw RTA template PDF, or files > 50 MB (raw data stays in `data/raw/`, git-ignored).
7. Scope discipline: build MUST items in docs/02_PRD.md before any SHOULD item. If a phase overruns, cut scope, not quality.
8. Every eval writes `eval/results/<suite>_<YYYYMMDD-HHMM>.json` with: suite, git_sha, timestamp, models, dataset_version, metrics{}, n, split.
9. Record non-trivial choices in docs/09_DECISIONS.md (one short entry each).

## Stack
- Python 3.11+, uv (or pip), Polars + DuckDB, GeoPandas, LightGBM, scikit-learn, statsmodels (baseline), FastAPI, Pydantic v2, LangGraph + Anthropic SDK, NetworkX (graph), pytest.
- Web: Next.js (App Router, TypeScript), Tailwind + `apps/web/src/app/tokens.css`, react-three-fiber + drei + postprocessing (3D twin on a baked OpenStreetMap scene, see apps/web/README.md), zustand, next-intl (en/ar, RTL), Playwright.
- LLM (optional, `DEMO_MODE=live`): OpenAI via `OPENAI_API_KEY` (the team's key, e.g. `LLM_MODEL=gpt-5`) or Anthropic Claude via `ANTHROPIC_API_KEY`; provider from the model id or `LLM_PROVIDER` (apps/api/eventflow/agents/llm.py). Verify current model ids with the provider before setting. Keep a provider interface so Jais/Core42 Compass could be swapped in later (mention only as "portable to", do not claim it is integrated).
- Optional deploy: Vercel (web) + Azure Container Apps (API, scale-to-zero). Local/offline build is the priority.

## Commands (keep these working)
- `make synth` — generate labelled synthetic data
- `make ingest` — ingest real Dubai Pulse / GTFS files from data/raw → data/processed (parquet)
- `make features` — build hourly station panel + event features
- `make baseline` / `make train` — train + backtest forecasters, write eval results
- `make api` — run FastAPI (port 8000)
- `make web` — run Next.js (port 3000)
- `make eval` / `make eval-fast` — run eval suites; `python -m eval.gate` checks thresholds
- `make demo` — build offline demo cache + start everything in booth mode
- `make osm` (once, online) / `make scene` — fetch OpenStreetMap + bake the offline 3D scene
- `make ui-test` — Playwright UI tests, screenshots and fps → eval/results/ui/
- `make test`

## Repo map
```
apps/api/eventflow/   FastAPI app, domain logic (forecast, simulate, agents)
apps/web/             Next.js UI
config/               corridor.yaml (stations, capacities), events.yaml (event calendar)
data/raw|interim|processed|synthetic|demo_cache
eval/                 gold/, suites/, results/, gate.py, thresholds.yaml
scripts/              synth, ingest, features, report_metrics.py
docs/ submission/ exhibit/
```

## Style
Small, typed, tested functions. Prefer clarity over cleverness. UI copy in British English plus Arabic. Timezone Asia/Dubai. UAE weekend is Sat–Sun from 2022; Fri–Sat before 2022 (this matters for features and backtests).
