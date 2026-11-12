"""Agent planner suite → eval/results/agents_<ts>.json (docs/08).

Runs the 20 gold scenarios (eval/gold/agents_scenarios.jsonl, EN + AR) through POST /agent/plan — whichever planner
is active (offline deterministic today; the Claude planner when LLM_MODEL and ANTHROPIC_API_KEY are set) — and
checks every option independently (eval/suites/plancheck.py):

  number_faithfulness  share of options whose summary re-simulates exactly AND whose text has only traceable numbers
  schema_validity      share of plans that validate and whose interventions pass the bounds check
  expectation_match    share of scenarios where "options" vs "no action" matches the gold file
  top_relieves         share of hotspot scenarios whose rank-1 option lowers riders above the threshold
  top_no_new_hotspot   share of hotspot scenarios whose rank-1 option creates no new hotspot
  arabic_text          share of AR options whose text is in Arabic
Usage: python -m eval.suites.agents
"""
from __future__ import annotations

import json
import os
import statistics
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DEMO_MODE", "live")              # measure the pipeline, not a cache replay

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from apps.api.eventflow.agents import planner  # noqa: E402
from eval.common import write_result  # noqa: E402
from eval.suites.plancheck import schema_ok, unfaithful_numbers  # noqa: E402

GOLD = Path(__file__).resolve().parents[1] / "gold/agents_scenarios.jsonl"


def run() -> dict:
    planner.CACHE_WRITE = Path(tempfile.mkdtemp(prefix="eft_agents_"))
    main.DECISIONS_LOG = planner.CACHE_WRITE / "decisions.jsonl"
    c = TestClient(main.app)
    gold = [json.loads(line) for line in GOLD.read_text(encoding="utf-8").splitlines() if line.strip()]
    n_opt = faithful = schema_good = expect_ok = hot = relieves = no_new = ar_opts = ar_ok = 0
    latencies, failures, planners = [], [], set()
    for g in gold:
        fc = c.post("/forecast", json=g["forecast"]).json()
        body = {"forecast_run_id": fc["run_id"], "forecast": g["forecast"], "scope": "corridor", "threshold": g["threshold"],
                "priority": g["priority"], "locale": "ar" if g["lang"] == "ar" else "en", "goal": g["goal"]}
        t0 = time.perf_counter()
        r = c.post("/agent/plan", json=body)
        latencies.append(time.perf_counter() - t0)
        if r.status_code != 200:
            failures.append({"id": g["id"], "error": f"HTTP {r.status_code}"})
            continue
        plan = r.json()
        planners.add(plan.get("planner", "?"))
        ok, why = schema_ok(plan)
        schema_good += ok
        if not ok:
            failures.append({"id": g["id"], "schema": why})
        got = "options" if plan["options"] else "no_action"
        expect_ok += got == g["expect"]
        if got != g["expect"]:
            failures.append({"id": g["id"], "expected": g["expect"], "got": got})
        base = plan["baseline_summary"]
        for o in plan["options"]:
            n_opt += 1
            sim = c.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": g["forecast"], "scope": "corridor",
                                            "threshold": g["threshold"], "interventions": o["interventions"]}).json()
            bad = unfaithful_numbers(base, o, g["threshold"])
            same = sim["summary"] == o["summary"]
            faithful += same and not bad
            if not same or bad:
                failures.append({"id": g["id"], "rank": o["rank"], "resim_matches": same, "untraceable_numbers": bad})
            if g["lang"] == "ar":
                ar_opts += 1
                ar_ok += any("؀" <= ch <= "ۿ" for ch in o["rationale"])
        if g["expect"] == "options" and plan["options"]:
            hot += 1
            top = plan["options"][0]
            relieves += top["summary"]["excess_pax"] < base["excess_pax"]
            no_new += not top.get("new_hotspots")
    lat = sorted(latencies)
    metrics = {
        "number_faithfulness": round(faithful / n_opt, 4) if n_opt else 0.0,
        "schema_validity": round(schema_good / len(gold), 4),
        "expectation_match": round(expect_ok / len(gold), 4),
        "top_relieves": round(relieves / hot, 4) if hot else None,
        "top_no_new_hotspot": round(no_new / hot, 4) if hot else None,
        "arabic_text": round(ar_ok / ar_opts, 4) if ar_opts else None,
        "options_checked": n_opt,
        "plan_latency_p50_s": round(statistics.median(lat), 3),
        "plan_latency_p95_s": round(lat[min(len(lat) - 1, int(0.95 * len(lat)))], 3),
    }
    fc0 = c.post("/forecast", json=gold[0]["forecast"]).json()
    p = write_result("agents", metrics, n=len(gold), split="all (dev+test)",
                     models={"planner": ",".join(sorted(planners)), "llm_model": os.environ.get("LLM_MODEL") or None},
                     dataset_version=fc0["dataset_version"], is_synthetic=fc0["is_synthetic"], failures=failures[:50],
                     gold_file=str(GOLD.relative_to(GOLD.parents[2])))
    print(f"agents suite: faithfulness {metrics['number_faithfulness']} over {n_opt} options, schema {metrics['schema_validity']}, "
          f"expectations {metrics['expectation_match']} -> {p.name}")
    return metrics


if __name__ == "__main__":
    run()
