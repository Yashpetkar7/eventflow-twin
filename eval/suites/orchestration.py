"""Orchestration suite (docs/15): the agent team on the 60 gold planner scenarios.

  engines_agree         share of scenarios where the LangGraph engine, the sequential engine and the classic planner
                        offer identical options (same measures, same simulated figures, same texts)
  events_deterministic  share of scenarios where the graph and the sequential engine log the same agent events in the
                        same order (timings and the engine's own name aside)
  trace_complete        share of missions whose events are numbered 1…n, end with the hand-over (human or no action),
                        and contain the simulation behind every offered option
  budget_respected      share of missions inside every budget limit (steps, simulations, model calls, time)
  layers_covered        share of missions with options in which all five layers acted
  mission_p50_s / mission_p95_s   wall time of a graph mission (offline, no model)
Usage: python -m eval.suites.orchestration
"""
from __future__ import annotations

import json
import os
import statistics
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DEMO_MODE", "live")              # compute, never replay the plan cache
os.environ.pop("LLM_MODEL", None)

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from apps.api.eventflow.agents import engine as engine_mod  # noqa: E402
from apps.api.eventflow.agents import planner  # noqa: E402
from eval.common import write_result  # noqa: E402

GOLD = Path(__file__).resolve().parents[1] / "gold/agents_scenarios.jsonl"


def _events(m: dict) -> list[dict]:
    return [{**{k: v for k, v in e.items() if k != "t_ms"}, "params": {k: v for k, v in e["params"].items() if k != "engine"}}
            for e in m["events"]]


def _options(m: dict) -> list[dict]:
    return m["plan"]["options"]


def _recommend_independently(assessments: list[dict]) -> int | None:
    """WP3's rule written again from docs/17, without importing mission.recommend: the first option that passes every
    applicable check; else, among those passing C1–C3, the most checks; else the most checks; ties to the plan's order."""
    if not assessments:
        return None
    scored = []
    for a in sorted(assessments, key=lambda a: a["rank"]):
        verdicts = {c["id"]: c["passed"] for c in a["checks"] if c["passed"] is not None}
        n_ok = sum(1 for v in verdicts.values() if v)
        scored.append((a["rank"], n_ok, len(verdicts), all(verdicts.get(k, True) for k in ("C1", "C2", "C3"))))
    for rank, n_ok, n_app, _ in scored:
        if n_ok == n_app:
            return rank
    pool = [x for x in scored if x[3]] or scored
    best = max(x[1] for x in pool)
    return next(x[0] for x in pool if x[1] == best)


def _conversation_ok(m: dict, agents: set[str]) -> tuple[bool, int, int]:
    """Messages name real agents; every critic objection is answered by the agent it names, in the next round.
    Returns (ok, objections, answered)."""
    ev = m["events"]
    if any(t not in agents for e in ev for t in (e.get("to") or [])):
        return False, 0, 0
    obj = [(e["round"], e["to"][0]) for e in ev if e["key"] == "critic.objection"]
    answered = sum(1 for rnd, a in obj if any(e["agent"] == a and e["key"] == f"{a}.revised" and e["round"] == rnd + 1 for e in ev))
    return answered == len(obj), len(obj), answered


def run() -> dict:
    planner.CACHE_WRITE = Path(tempfile.mkdtemp(prefix="eft_orch_"))
    main.DECISIONS_LOG = planner.CACHE_WRITE / "decisions.jsonl"
    c = TestClient(main.app)
    gold = [json.loads(line) for line in GOLD.read_text(encoding="utf-8").splitlines() if line.strip()]
    agree = determ = complete = within = layered = with_opts = 0
    rec_ok = rec_all = conv_ok = n_obj = n_ans = replans = 0
    roster = {a["id"] for a in c.get("/agent/roster").json()["agents"]}
    lat, failures = [], []
    for g in gold:
        fc = c.post("/forecast", json=g["forecast"]).json()
        body = {"forecast_run_id": fc["run_id"], "forecast": g["forecast"], "scope": "corridor", "threshold": g["threshold"],
                "priority": g["priority"], "locale": "ar" if g["lang"] == "ar" else "en", "goal": g["goal"], "applied": g.get("applied", [])}
        got = {}
        for e in ("graph", "seq", "classic"):
            os.environ["AGENTS_ENGINE"] = e
            t0 = time.perf_counter()
            r = c.post("/agent/run", json=body)
            if e == "graph":
                lat.append(time.perf_counter() - t0)
            if r.status_code != 200:
                failures.append({"id": g["id"], "engine": e, "error": f"HTTP {r.status_code}"})
                break
            got[e] = r.json()
        if len(got) < 3:
            continue
        gm = got["graph"]
        ok = _options(gm) == _options(got["seq"]) == _options(got["classic"])
        agree += ok
        if not ok:
            failures.append({"id": g["id"], "check": "engines_agree"})
        d = _events(gm) == _events(got["seq"])
        determ += d
        if not d:
            failures.append({"id": g["id"], "check": "events_deterministic"})
        ev = gm["events"]
        sims = {e["run_id"] for e in ev if e["key"] == "simulation.result"}
        t_ok = ([e["seq"] for e in ev] == list(range(1, len(ev) + 1)) and ev[-1]["key"] in ("human.awaiting", "supervisor.no_action")
                and all(o["sources"][0]["run_id"] in sims for o in _options(gm)))
        complete += t_ok
        if not t_ok:
            failures.append({"id": g["id"], "check": "trace_complete"})
        b = gm["budget"]
        w = (b["steps"] <= b["steps_max"] and b["simulations"] <= b["simulations_max"] and b["model_calls"] <= b["model_calls_max"]
             and b["wall_ms"] <= b["wall_ms_max"])
        within += w
        if _options(gm):
            with_opts += 1
            layered += {e["layer"] for e in ev} >= {1, 2, 3, 4, 5}
            want = _recommend_independently(gm["assessments"])
            r_ok = gm.get("recommended_rank") == want
            rec_ok += r_ok
            rec_all += bool(gm.get("recommendation")) and gm["recommendation"]["basis"] == "all_checks"
            if not r_ok:
                failures.append({"id": g["id"], "check": "recommendation_consistent", "got": gm.get("recommended_rank"), "want": want})
        cv, no, na = _conversation_ok(gm, roster)
        conv_ok += cv
        n_obj, n_ans = n_obj + no, n_ans + na
        replans += no > 0
        if not cv:
            failures.append({"id": g["id"], "check": "objections_answered"})
    os.environ.pop("AGENTS_ENGINE", None)
    n = len(gold)
    lat.sort()
    metrics = {
        "engines_agree": round(agree / n, 4), "events_deterministic": round(determ / n, 4), "trace_complete": round(complete / n, 4),
        "budget_respected": round(within / n, 4), "layers_covered": round(layered / with_opts, 4) if with_opts else None,
        "missions_with_options": with_opts,
        "recommendation_consistent": round(rec_ok / with_opts, 4) if with_opts else None,
        "recommended_all_checks_rate": round(rec_all / with_opts, 4) if with_opts else None,
        "objections_answered": round(conv_ok / n, 4), "objections": n_obj, "objections_with_answer": n_ans,
        "missions_with_replan": replans,
        "mission_p50_s": round(statistics.median(lat), 3), "mission_p95_s": round(lat[min(len(lat) - 1, int(0.95 * len(lat)))], 3),
        "engine_default": engine_mod.available_engine(),
    }
    fc0 = c.post("/forecast", json=gold[0]["forecast"]).json()
    p = write_result("orchestration", metrics, n=n, split="all (dev+test)", models={"engines": "graph,seq,classic", "llm_model": None},
                     dataset_version=fc0["dataset_version"], is_synthetic=fc0["is_synthetic"], failures=failures[:50],
                     gold_file=str(GOLD.relative_to(GOLD.parents[2])))
    print(f"orchestration suite: engines agree {metrics['engines_agree']}, deterministic {metrics['events_deterministic']}, "
          f"complete {metrics['trace_complete']}, p95 {metrics['mission_p95_s']} s -> {p.name}")
    return metrics


if __name__ == "__main__":
    run()
