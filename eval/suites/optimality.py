"""Optimality and critic suites (docs/15), on every distinct hotspot scenario of the gold set.

An exhaustive grid over the menu (eval/suites/menu_grid.py: every measure at several settings around the hotspot,
then every pair of different kinds among the eight most effective) is simulated and compared with what the agent
team offers.

optimality (written as eval/results/optimality_*.json)
  goal_coverage        where the grid finds a plan that clears every station without moving the hotspot, the share
                       of scenarios in which the agents also offer one
  relief_gap_mean/max  (riders relieved by the grid's best acceptable plan − by the agents' best offered plan)
                       ÷ riders over the threshold at baseline; 0 = the agents found the grid's best
  top_score_ratio_mean the agents' first option's score ÷ the grid's best score (score = relieved − λ·cost)
critic (written as eval/results/critic_*.json): the critic's verdicts on every grid plan that relieves someone,
against an independent re-check from the simulator's hourly rows
  critic_recall        share of plans that truly fail C1, C2 or C3 that the critic flags with exactly those criteria
  critic_precision     share of the critic's flags that are true
  critic_agreement     share of plans whose flag set equals the independent one
Usage: python -m eval.suites.optimality
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("DEMO_MODE", "live")
os.environ.pop("LLM_MODEL", None)

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from apps.api.eventflow.agents import planner  # noqa: E402
from apps.api.eventflow.agents.mission import failing  # noqa: E402
from eval.common import write_result  # noqa: E402
from eval.suites.menu_grid import pairs, singles  # noqa: E402

GOLD = Path(__file__).resolve().parents[1] / "gold/agents_scenarios.jsonl"
TOP_SINGLES = 8


def _acceptable(o: dict) -> bool:
    return not o["new_hot"] and not o["demote"]


def _truth(base: dict, res: dict) -> list[str]:
    """C1–C3 recomputed from the simulator's hourly rows, independently of the critic's code."""
    base_hot = {r["station_id"] for r in base["hourly"] if r["overcap_bins"] > 0}
    res_hot = {r["station_id"] for r in res["hourly"] if r["overcap_bins"] > 0}
    out = []
    if sum(r["overcap_bins"] for r in res["hourly"]) > 0:
        out.append("C1")
    if res_hot - base_hot:
        out.append("C2")
    if res["summary"]["overcap_station_hours"] > base["summary"]["overcap_station_hours"]:
        out.append("C3")
    return out


def run() -> tuple[dict, dict]:
    planner.CACHE_WRITE = Path(tempfile.mkdtemp(prefix="eft_opt_"))
    main.DECISIONS_LOG = planner.CACHE_WRITE / "decisions.jsonl"
    c = TestClient(main.app)
    os.environ["AGENTS_ENGINE"] = "graph"
    gold = [json.loads(line) for line in GOLD.read_text(encoding="utf-8").splitlines() if line.strip()]
    seen, scen = set(), []
    for g in gold:
        k = json.dumps([g["forecast"], g["threshold"], g["priority"], g.get("applied", [])], sort_keys=True)
        if g["expect"] == "options" and k not in seen:
            seen.add(k)
            scen.append(g)
    have_goal = covered = 0
    gaps, ratios, sizes = [], [], []
    tp = fp = fn = agree = judged = 0
    rows, failures = [], []
    for g in scen:
        fc = c.post("/forecast", json=g["forecast"]).json()
        run = main.get_run(fc["run_id"])
        req = SimpleNamespace(locale="en", threshold=g["threshold"], applied=g.get("applied", []), scope="corridor",
                              priority=g["priority"], goal=None, notes=None)
        p = planner.PlanRun(run, req, main.run_simulation)
        p.start(use_factory=False)
        hot = p.diagnose()
        if hot is None:
            continue
        p.begin_testing()
        single = [{"key": "grid", "ivs": ivs, "ctx": {}} for ivs in singles(hot, p.scope_ids, bool(run.get("event")), p.thr)]
        scored = [(c_, p.score_one(c_, 1)) for c_ in single]
        best = [c_["ivs"] for c_, o in sorted(((c_, o) for c_, o in scored if o), key=lambda t: planner._effect(t[1]))[:TOP_SINGLES]]
        combo = [{"key": "grid", "ivs": ivs, "ctx": {}} for ivs in pairs(best)]
        scored += [(c_, p.score_one(c_, 1)) for c_ in combo]
        entries = [o for _, o in scored if o]
        sizes.append(len(scored))
        base_ex = p.base["summary"]["excess_pax"]
        # ---- critic: its flags on every useful grid plan against the independent re-check
        for o in entries:
            truth, flags = set(_truth(p.base, o["res"])), set(failing(o, p.base["summary"]))
            judged += 1
            agree += truth == flags
            tp += len(truth & flags)
            fp += len(flags - truth)
            fn += len(truth - flags)
        # ---- optimality: the grid's best against the agents' offer
        acc = [o for o in entries if _acceptable(o)]
        grid_goal = any(planner.goal_met(o) for o in entries)
        grid_relief = max((base_ex - o["res"]["summary"]["excess_pax"] for o in acc), default=0.0)
        grid_score = max((o["score"] for o in acc), default=0.0)
        m = c.post("/agent/run", json={"forecast_run_id": fc["run_id"], "forecast": g["forecast"], "scope": "corridor",
                                       "threshold": g["threshold"], "priority": g["priority"], "applied": g.get("applied", [])}).json()
        opts = m["plan"]["options"]
        agents_goal = any(o["goal_met"] for o in opts)
        agents_relief = max((base_ex - o["summary"]["excess_pax"] for o in opts if not o["new_hotspots"]), default=0.0)
        if grid_goal:
            have_goal += 1
            covered += agents_goal
            if not agents_goal:
                failures.append({"id": g["id"], "check": "goal_coverage"})
        gap = max(0.0, grid_relief - agents_relief) / base_ex if base_ex > 0 else 0.0
        gaps.append(gap)
        if grid_score > 0 and opts:
            ratios.append(min(1.0, opts[0]["score"] / grid_score))
        rows.append({"id": g["id"], "grid_plans": len(scored), "grid_goal": grid_goal, "agents_goal": agents_goal,
                     "relief_gap": round(gap, 4), "grid_best_relief": round(grid_relief, 1), "agents_best_relief": round(agents_relief, 1)})
    os.environ.pop("AGENTS_ENGINE", None)
    opt = {"goal_coverage": round(covered / have_goal, 4) if have_goal else None, "scenarios": len(rows),
           "scenarios_where_grid_meets_goal": have_goal,
           "relief_gap_mean": round(sum(gaps) / len(gaps), 4) if gaps else None, "relief_gap_max": round(max(gaps), 4) if gaps else None,
           "top_score_ratio_mean": round(sum(ratios) / len(ratios), 4) if ratios else None,
           "grid_plans_mean": round(sum(sizes) / len(sizes), 1) if sizes else None}
    crit = {"critic_recall": round(tp / (tp + fn), 4) if tp + fn else 1.0, "critic_precision": round(tp / (tp + fp), 4) if tp + fp else 1.0,
            "critic_agreement": round(agree / judged, 4) if judged else None, "plans_judged": judged}
    fc0 = c.post("/forecast", json=gold[0]["forecast"]).json()
    common = dict(split="hotspot scenarios of the gold set", dataset_version=fc0["dataset_version"], is_synthetic=fc0["is_synthetic"],
                  gold_file=str(GOLD.relative_to(GOLD.parents[2])))
    p1 = write_result("optimality", opt, n=len(rows), models={"planner": "agent team (graph)", "yardstick": "exhaustive menu grid"},
                      rows=rows, failures=failures[:50], **common)
    p2 = write_result("critic", crit, n=judged, models={"critic": "code (planner.goal_met, mission.failing)", "oracle": "simulator hourly rows"},
                      **common)
    print(f"optimality: goal coverage {opt['goal_coverage']}, relief gap mean {opt['relief_gap_mean']} max {opt['relief_gap_max']}, "
          f"score ratio {opt['top_score_ratio_mean']} -> {p1.name}")
    print(f"critic: recall {crit['critic_recall']}, precision {crit['critic_precision']}, agreement {crit['critic_agreement']} "
          f"over {judged} plans -> {p2.name}")
    return opt, crit


if __name__ == "__main__":
    run()
