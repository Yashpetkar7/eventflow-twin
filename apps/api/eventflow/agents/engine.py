"""Engines that run the agent team (docs/15_AGENT_ARCHITECTURE.md).

    graph    LangGraph StateGraph: conditional edges for the supervisor, the four specialists in parallel, the
             explainer and the stress test in parallel, a step budget (recursion limit). The default.
    seq      the same agents (nodes.py) walked in a plain loop, with the same routing functions. Used when LangGraph
             is not installed (an offline booth laptop never fails on a missing package) and as a test oracle.
    classic  the original single-function planner (planner.make_plan), wrapped as a mission.

Engine choice: AGENTS_ENGINE, else config/agents.yaml `engine`. All three give identical plans without a model.
"""
from __future__ import annotations

import os
from functools import lru_cache

from . import planner
from .mission import MissionCtx, conclude, roster_view, stress_test
from .nodes import (SPECIALIST_NODES, State, composer, conclude_node, critic, diagnosis, explainer, forecast, intake, ranker,
                    route_after_composer, route_after_diagnosis, route_after_supervisor, simulation, stress, supervisor, verifier)
from .roster import SPECIALISTS, settings

# Tracing to an outside service must never switch itself on (the booth is offline; nothing leaves the machine).
for _k in ("LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2", "LANGCHAIN_TRACING"):
    os.environ[_k] = "false"


def wanted_engine() -> str:
    e = (os.environ.get("AGENTS_ENGINE") or settings().get("engine") or "graph").strip().lower()
    return e if e in ("graph", "seq", "classic") else "graph"


@lru_cache(maxsize=1)
def _graph():
    """The compiled LangGraph, or None when LangGraph cannot be imported (the seq engine then runs)."""
    try:
        from langgraph.graph import END, START, StateGraph
    except Exception:                                   # not installed, or broken: never take the booth down
        return None
    g = StateGraph(State)
    for name, fn in (("intake", intake), ("forecast", forecast), ("diagnosis", diagnosis), ("composer", composer),
                     ("simulation", simulation), ("critic", critic), ("supervisor", supervisor), ("ranker", ranker),
                     ("explainer", explainer), ("stress", stress), ("verifier", verifier), ("conclude", conclude_node)):
        g.add_node(name, fn)
    for a in SPECIALISTS:
        g.add_node(a, SPECIALIST_NODES[a])
    g.add_edge(START, "intake")
    g.add_edge("intake", "forecast")
    g.add_edge("forecast", "diagnosis")
    g.add_conditional_edges("diagnosis", route_after_diagnosis, [*SPECIALISTS, "conclude"])
    g.add_edge(list(SPECIALISTS), "composer")           # fan-in: the composer waits for all four specialists
    g.add_conditional_edges("composer", route_after_composer, ["simulation", "ranker"])
    g.add_edge("simulation", "critic")
    g.add_edge("critic", "supervisor")
    g.add_conditional_edges("supervisor", route_after_supervisor, [*SPECIALISTS, "ranker"])   # replan: the critic's objections go to the specialists
    g.add_edge("ranker", "explainer")
    g.add_edge("ranker", "stress")                      # explainer and stress test run side by side
    g.add_edge(["explainer", "stress"], "verifier")
    g.add_edge("verifier", "conclude")
    g.add_edge("conclude", END)
    return g.compile()


def available_engine() -> str:
    e = wanted_engine()
    return "seq" if e == "graph" and _graph() is None else e


def mermaid() -> str:
    """The graph as Mermaid, generated from the compiled LangGraph (empty when it is not available)."""
    g = _graph()
    try:
        return g.get_graph().draw_mermaid() if g is not None else ""
    except Exception:
        return ""


def roster() -> dict:
    return roster_view(available_engine(), mermaid())


def _apply(state: dict, update: dict) -> None:
    for k in ("proposals", "revisions", "buffers"):
        if update.get(k):
            state[k] = state.get(k, []) + update[k]


def _run_seq(ctx: MissionCtx) -> None:
    """The graph's path, walked one agent at a time (same nodes, same routing functions)."""
    st: dict = {"ctx": ctx, "proposals": [], "revisions": [], "buffers": []}
    for node in (intake, forecast, diagnosis):
        _apply(st, node(st))
    if route_after_diagnosis(st) != "conclude":
        for a in SPECIALISTS:
            _apply(st, SPECIALIST_NODES[a](st))
        _apply(st, composer(st))
        while route_after_composer(st) == "simulation":
            for node in (simulation, critic, supervisor):
                _apply(st, node(st))
            if route_after_supervisor(st) == "ranker":
                break
            for a in SPECIALISTS:                       # the critic's objections, answered by the specialists it named
                _apply(st, SPECIALIST_NODES[a](st))
            _apply(st, composer(st))
        for node in (ranker, explainer, stress, verifier):
            _apply(st, node(st))
    _apply(st, conclude_node(st))


def _classic(run: dict, req, run_simulation) -> dict:
    """The original planner as a mission: its trace becomes the events (roles mapped onto the roster)."""
    ctx = MissionCtx(run, req, run_simulation, "classic")
    ctx.build_objective()
    plan = planner.make_plan(run, req, run_simulation)
    role = {"planner": "supervisor", "proposer": "composer", "simulator": "simulation", "critic": "critic",
            "explainer": "explainer", "verifier": "verifier"}
    for e in plan["trace"]:
        ctx.event(role[e["role"]], "tool", f"classic.{e['tool']}", rnd=e["round"], run_id=e["run_id"], **e["data"])
    opts = [{"rank": o["rank"], "interventions": o["interventions"]} for o in plan["options"]]
    ctx.assessments = stress_test(ctx, opts)
    # the classic planner keeps no pool: assessments from its options only, no rejected plans listed
    ctx.p.assemble = lambda write_cache=True: plan      # conclude() reuses the plan the classic planner returned
    ctx.p.base = {"summary": plan["baseline_summary"], "road": plan.get("baseline_road"), "hourly": []}
    ctx.stop_reason = "classic"
    return conclude(ctx)


def run_mission(run: dict, req, run_simulation, engine: str | None = None, on_event=None) -> dict:
    """One mission. `engine` overrides the configured one (tests and the orchestration eval use it); `on_event` is
    called with every agent event as it is logged (the live stream)."""
    e = engine or available_engine()
    if e == "graph" and _graph() is None:
        e = "seq"
    if e == "classic":
        return _classic(run, req, run_simulation)
    ctx = MissionCtx(run, req, run_simulation, e)
    ctx.on_event = on_event
    if e == "graph":
        _graph().invoke({"ctx": ctx, "proposals": [], "revisions": [], "buffers": []}, {"recursion_limit": settings()["budget"]["steps_max"]})
    else:
        _run_seq(ctx)
    return ctx.result
