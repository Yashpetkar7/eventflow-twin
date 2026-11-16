"""Glue between the API and the standing agents (agents/standing.py): re-simulation, routing and model hooks."""
from __future__ import annotations

from types import SimpleNamespace

from . import planner
from .personas import ask_route_model, messenger_model
from .standing import INTENTS, answer, drafts, route


def message_for(req, run: dict, run_simulation) -> dict:
    applied = [i.model_dump() for i in req.applied]
    ivs = [i.model_dump() for i in req.interventions]
    base = run_simulation(run["run_id"], applied, False, req.threshold, req.scope)
    res = run_simulation(run["run_id"], planner.merge(applied, ivs), False, req.threshold, req.scope)
    hot = planner.diagnose(base)
    d = drafts({"interventions": ivs, "summary": res["summary"]}, base["summary"], run.get("event"), hot, None)
    d = messenger_model(d)
    d.pop("allowed", None)
    d.pop("event_names", None)
    return {**d, "sources": [res["source"], {"tool": "forecast", "run_id": run["run_id"]}], "is_synthetic": run["is_synthetic"]}


def ask_for(req, run: dict, run_simulation) -> dict:
    base = run_simulation(run["run_id"], [i.model_dump() for i in req.applied], False, req.threshold, req.scope)
    if req.intent:
        intent, how = req.intent, "chip"
    else:
        q = (req.question or "").strip()
        m = ask_route_model(q, INTENTS) if q else None
        if m is not None:
            intent, how = (None if m == "out_of_scope" else m), "model"
        else:
            intent, how = (route(q) if q else None), "code"
    if intent is None:
        return {"intent": None, "refused": True, "key": "ask.refuse", "params": {}, "sources": [], "routed_by": how,
                "is_synthetic": run["is_synthetic"]}

    def plan_fn() -> dict:
        r = SimpleNamespace(locale=req.locale, threshold=req.threshold, applied=req.applied, scope=req.scope, priority="balanced",
                            goal=None, notes=None)
        return planner.make_plan(run, r, run_simulation)
    a = answer(intent, run, req, base, run_simulation, plan_fn)
    return {"intent": intent, "refused": a["key"] == "ask.refuse", **a, "routed_by": how, "is_synthetic": run["is_synthetic"]}
