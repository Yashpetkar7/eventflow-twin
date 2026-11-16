"""Compute benchmark for the GPU request (docs/GPU_REQUEST.md, decision #138). A report, not a gated suite.

    python -m eval.suites.gpu_benchmark            CPU baseline on this machine (offline, no key)
    python -m eval.suites.gpu_benchmark --llm      + the model agents against the configured model
                                                   (LLM_PROVIDER=local + LLM_BASE_URL for a GPU-hosted open model)

Measures, on whatever machine runs it:
  1. mission_*        the whole agent team (LangGraph, code policies) on the gold scenarios: p50 / p95 seconds
  2. simulator_*      single-core simulator throughput (runs per second) on a crowded scenario
  3. sweep_hours_*    what an uncertainty sweep would cost on this CPU: scenarios × 48 grid plans ÷ throughput
  4. llm_*            (with --llm) per-call latency p50 / p95, schema-valid answers, output tokens per second
Every figure is measured here and written to eval/results/gpu_benchmark_<timestamp>.json; the request document
quotes that file. No speed-up on a GPU is claimed until this is run on one.
"""
from __future__ import annotations

import json
import os
import platform
import statistics
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DEMO_MODE", "live" if "--llm" in sys.argv else "offline")
if "--llm" not in sys.argv:
    os.environ.pop("LLM_MODEL", None)

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from apps.api.eventflow.agents import llm as llm_mod, planner  # noqa: E402
from apps.api.eventflow.simulate import simulate  # noqa: E402
from eval.common import ROOT, write_result  # noqa: E402

GOLD = ROOT / "eval/gold/agents_scenarios.jsonl"
GRID_PLANS = 48                       # plans per scenario in the exhaustive grid (optimality suite, grid_plans_mean)


def _pct(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * len(xs)))], 4) if xs else 0.0


def cpu_info() -> dict:
    return {"machine": platform.machine(), "processor": platform.processor() or platform.machine(), "cores": os.cpu_count(),
            "python": platform.python_version(), "os": f"{platform.system()} {platform.release()}"}


def missions(c: TestClient, n: int) -> dict:
    gold = [json.loads(x) for x in GOLD.read_text(encoding="utf-8").splitlines() if x.strip()][:n]
    lat = []
    for g in gold:
        fc = c.post("/forecast", json=g["forecast"]).json()
        t0 = time.perf_counter()
        r = c.post("/agent/run", json={"forecast_run_id": fc["run_id"], "forecast": g["forecast"], "scope": "corridor",
                                       "threshold": g["threshold"], "priority": g["priority"]})
        lat.append(time.perf_counter() - t0)
        assert r.status_code == 200, r.text
    return {"mission_n": len(lat), "mission_p50_s": _pct(lat, 0.5), "mission_p95_s": _pct(lat, 0.95)}


def simulator(c: TestClient, seconds: float = 8.0) -> dict:
    spec = {"event_id": "downtown_night", "attendance": 50000}
    fc = c.post("/forecast", json=spec).json()
    run = main.get_run(fc["run_id"])
    variants = [[], [{"type": "staggered_exit", "params": {"spread_minutes": 60}}],
                [{"type": "extra_trains", "params": {"headway_min": 3, "hours": [20, 21, 22, 23], "line": "Red"}}]]
    n, t0 = 0, time.perf_counter()
    while time.perf_counter() - t0 < seconds:
        simulate(run["demand"], variants[n % len(variants)], weekday=run["weekday"], service=run.get("service"))
        n += 1
    rate = n / (time.perf_counter() - t0)
    return {"simulator_runs": n, "simulator_runs_per_s": round(rate, 1),
            "sweep_hours_10k_scenarios": round(10_000 * GRID_PLANS / rate / 3600, 2),
            "sweep_hours_100k_scenarios": round(100_000 * GRID_PLANS / rate / 3600, 2)}


def model_calls(c: TestClient, n: int) -> dict:
    model = os.environ.get("LLM_MODEL", "").strip()
    client = llm_mod.make_client(model) if model else None
    if client is None:
        return {"llm": "not configured (set LLM_MODEL, and LLM_PROVIDER=local + LLM_BASE_URL for a self-hosted model)"}
    spec = {"event_id": "downtown_night"}
    fc = c.post("/forecast", json=spec).json()
    run = main.get_run(fc["run_id"])
    req = type("R", (), {"locale": "en", "threshold": None, "applied": [], "scope": "corridor", "priority": "balanced",
                         "goal": None, "notes": None})()
    p = planner.PlanRun(run, req, main.run_simulation)
    p.start(use_factory=False)
    hot = p.diagnose()
    cands = planner.recipe_bundles(p.target) if hot else []          # the menu bundles the proposer is told are already tested
    prompt = llm_mod.proposer_prompt(hot, p.scope_ids, cands, p.base["summary"], "balanced", planner.DEFAULT_GOAL, None,
                                     bool(run.get("event")), None) if hot else "{}"
    lat, ok, out_tok = [], 0, 0
    for _ in range(n):
        t0 = time.perf_counter()
        try:
            client.complete_json(system=llm_mod.PROPOSER_SYSTEM, user=prompt, schema=llm_mod.PROPOSER_SCHEMA, effort="low", max_tokens=2000)
            ok += 1
        except llm_mod.LLMUnavailable:
            pass
        lat.append(time.perf_counter() - t0)
        out_tok += int((getattr(client, "last_usage", {}) or {}).get("output_tokens", 0))
    return {"llm_model": llm_mod.display_name(client), "llm_calls": n, "llm_p50_s": _pct(lat, 0.5), "llm_p95_s": _pct(lat, 0.95),
            "llm_schema_valid": round(ok / n, 3), "llm_output_tokens_per_s": round(out_tok / sum(lat), 1) if sum(lat) else None}


def run() -> Path:
    planner.CACHE_WRITE = Path(tempfile.mkdtemp(prefix="eft_bench_"))
    main.DECISIONS_LOG = planner.CACHE_WRITE / "decisions.jsonl"
    c = TestClient(main.app)
    metrics = {**missions(c, 20), **simulator(c)}
    if "--llm" in sys.argv:
        metrics.update(model_calls(c, int(os.environ.get("BENCH_LLM_CALLS", "5"))))
    fc = c.post("/forecast", json={"event_id": "downtown_night"}).json()
    p = write_result("gpu_benchmark", metrics, n=metrics["mission_n"], split="gold scenarios 1-20 + simulator loop",
                     models={"engine": "graph", "llm_model": metrics.get("llm_model")}, dataset_version=fc["dataset_version"],
                     is_synthetic=fc["is_synthetic"], hardware=cpu_info(), grid_plans=GRID_PLANS)
    print(f"gpu_benchmark: mission p95 {metrics['mission_p95_s']} s, simulator {metrics['simulator_runs_per_s']} runs/s, "
          f"100k-scenario sweep ≈ {metrics['sweep_hours_100k_scenarios']} h on this CPU -> {p.name}")
    return p


if __name__ == "__main__":
    run()
