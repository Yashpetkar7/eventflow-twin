"""Agent planner suite → eval/results/agents_<ts>.json (docs/08).

Runs the 60 gold scenarios (eval/gold/agents_scenarios.jsonl, EN + AR) through POST /agent/plan — whichever planner
is active (offline deterministic today; an LLM proposer and explainer when DEMO_MODE=live and LLM_MODEL are set) — and
checks every option independently (eval/suites/plancheck.py):

  number_faithfulness  share of options whose summary re-simulates exactly AND whose text has only traceable numbers
  schema_validity      share of plans that validate and whose interventions pass the bounds check
  expectation_match    share of scenarios where "options" vs "no action" matches the gold file
  top_relieves         share of hotspot scenarios whose rank-1 option lowers riders above the threshold
  top_no_new_hotspot   share of hotspot scenarios whose rank-1 option creates no new hotspot
  arabic_text          share of AR options whose text is in Arabic
  critic_consistent    share of options whose `goal_met` flag equals what re-simulation shows
  trace_complete       share of plans whose trace is numbered in order and contains the simulation behind every option
  goal_met_rate        share of hotspot scenarios where an offered option clears every station (reported, not gated)
  replan_rate          share of hotspot scenarios that needed more than one planning round (reported, not gated)
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
    trace_ok = critic_ok = goal_any = replans = 0
    latencies, failures, planners = [], [], set()
    for g in gold:
        fc = c.post("/forecast", json=g["forecast"]).json()
        body = {"forecast_run_id": fc["run_id"], "forecast": g["forecast"], "scope": "corridor", "threshold": g["threshold"],
                "priority": g["priority"], "locale": "ar" if g["lang"] == "ar" else "en", "goal": g["goal"],
                "applied": g.get("applied", [])}
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
        trace = plan.get("trace", [])
        sim_ids = {e["run_id"] for e in trace if e["tool"] == "simulate"}
        t_ok = bool(trace) and [e["n"] for e in trace] == list(range(1, len(trace) + 1)) and all(
            o["sources"][0]["run_id"] in sim_ids for o in plan["options"])
        trace_ok += t_ok
        if not t_ok:
            failures.append({"id": g["id"], "trace": "incomplete"})
        for o in plan["options"]:
            n_opt += 1
            sim = c.post("/simulate", json={"forecast_run_id": fc["run_id"], "forecast": g["forecast"], "scope": "corridor",
                                            "threshold": g["threshold"],
                                            "interventions": [*g.get("applied", []), *o["interventions"]]}).json()
            cleared = sim["summary"]["overcap_station_hours"] == 0 and not o.get("new_hotspots")
            critic_ok += o.get("goal_met") == cleared
            if o.get("goal_met") != cleared:
                failures.append({"id": g["id"], "rank": o["rank"], "critic": "goal_met flag disagrees with re-simulation"})
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
            goal_any += any(o.get("goal_met") for o in plan["options"])
            replans += (plan.get("critic") or {}).get("rounds", 1) > 1
    lat = sorted(latencies)
    metrics = {
        "number_faithfulness": round(faithful / n_opt, 4) if n_opt else 0.0,
        "schema_validity": round(schema_good / len(gold), 4),
        "expectation_match": round(expect_ok / len(gold), 4),
        "top_relieves": round(relieves / hot, 4) if hot else None,
        "top_no_new_hotspot": round(no_new / hot, 4) if hot else None,
        "arabic_text": round(ar_ok / ar_opts, 4) if ar_opts else None,
        "critic_consistent": round(critic_ok / n_opt, 4) if n_opt else None,
        "trace_complete": round(trace_ok / len(gold), 4),
        "goal_met_rate": round(goal_any / hot, 4) if hot else None,
        "replan_rate": round(replans / hot, 4) if hot else None,
        "hotspot_scenarios": hot,
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
