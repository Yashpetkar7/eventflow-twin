"""The agents, one function each (docs/15_AGENT_ARCHITECTURE.md).

Every node takes the mission state and returns a partial update; both engines (LangGraph and the plain sequence in
engine.py) call these same functions, so the team behaves the same whichever runs it. Nodes that run in parallel
(the four specialists; explainer and stress) never write shared state directly: they return their proposals and
events, and the node after them merges those in roster order, so a mission is deterministic.

Numbers come only from planner.PlanRun's simulator calls and from the stress test (CLAUDE.md rule 2).
"""
from __future__ import annotations

import operator
import time
from typing import Annotated, Any, TypedDict

from ..breakpoint import break_points
from ..config import corridor
from . import planner
from .mission import MissionCtx, claim_violations, conclude, copy_texts, stress_test
from .roster import AGENT_IDS, SPECIALIST_TYPES, SPECIALISTS


class State(TypedDict, total=False):
    ctx: Any                                                   # MissionCtx (shared working state)
    proposals: Annotated[list, operator.add]                   # specialists → composer (round one)
    revisions: Annotated[list, operator.add]                   # specialists → composer (answers to the critic's objections)
    buffers: Annotated[list, operator.add]                     # events of agents that ran in parallel


def _order(agent: str) -> int:
    return AGENT_IDS.index(agent)


def _pct(lf: float | None) -> int | None:
    return None if lf is None else round(lf * 100)


# ---------------------------------------------------------------- layer 1–2
def intake(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("intake")
    b = getattr(ctx.req, "brief", None)
    if b is not None:                                      # the planner's confirmed brief: the human speaks first (1.16.0)
        ctx.event("human", "message", "human.brief", rnd=1, to=["intake"], summary=b.summary[:300], source=b.source,
                  kept=list(b.fields), removed=list(b.removed))
    ctx.event("supervisor", "start", "supervisor.start", rnd=1, engine=ctx.engine)
    o = ctx.build_objective()
    c = o["constraints"]
    ctx.event("intake", "decision", "intake.objective", rnd=1, threshold_pct=_pct(o["threshold"]), priority=o["priority"],
              forbid=c.get("forbid_types", []), protect=c.get("protect_stations", []), cost_cap=c.get("cost_cap"))
    from .personas import intake_model                     # the intake's model, if any: suggestions, never applied
    intake_model(ctx)
    for f in ctx.findings:
        ctx.event("intake", "finding", "intake.finding", rnd=1, field=f["field"])
    return {}


def forecast(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("forecast")
    run = ctx.run
    ev = run.get("event") or {}
    ctx.event("forecast", "tool", "forecast.run", rnd=1, run_id=run["run_id"], event=ev.get("id"), attendance=run.get("attendance_used"),
              metro_share_pct=_pct(run.get("metro_share_used")), weather=run.get("weather"), demand_level=run.get("demand_level"),
              is_synthetic=run["is_synthetic"])
    return {}


def diagnosis(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("diagnosis")
    p = ctx.p
    p.start(llm=None, use_factory=False)            # the planner's own model is not used by the team: each agent has its own
    b = p.base["summary"]
    ctx.event("diagnosis", "tool", "diagnosis.baseline", rnd=1, run_id=p.base["run_id"], over=b["overcap_station_hours"],
              excess=round(b["excess_pax"]), peak_pct=_pct(b["peak_lf"]))
    hot = p.diagnose()
    if hot is None:
        ctx.event("diagnosis", "decision", "diagnosis.none", rnd=1, threshold_pct=_pct(p.thr))
        if "calm" in ctx.checkpoints and _calm_gate(ctx):
            return {}                                    # paused: the team tested the scenario harder and asks what to plan for
        ctx.event("critic", "decision", "critic.no_action", rnd=1)
        return {}
    bins: dict[str, dict] = {}
    for r in p.base["hourly"]:
        if r["overcap_bins"]:
            d = bins.setdefault(r["station_id"], {"id": r["station_id"], "bins": 0, "peak_pct": 0})
            d["bins"] += r["overcap_bins"]
            d["peak_pct"] = max(d["peak_pct"], _pct(r["peak_lf"]))
    ctx.event("diagnosis", "decision", "diagnosis.hotspots", rnd=1, run_id=p.base["run_id"], worst=hot["station"], hours=hot["hours"],
              stations=sorted(bins.values(), key=lambda d: (-d["bins"], d["id"])))
    if "hotspot" in ctx.checkpoints and _hotspot_gate(ctx, bins):
        return {}                                    # paused for the human, or the human stopped the mission
    t = p.target
    ctx.event("supervisor", "message", "supervisor.brief", rnd=1, run_id=p.base["run_id"], to=list(SPECIALISTS), station=t["worst"],
              hours=t["hrs"], gap=t["size"]["why"]["gap"], nb=t["nb"], far=t["far"], threshold_pct=_pct(p.thr))
    try:
        ids = [s["id"] for s in corridor()["stations"] if s.get("in_corridor")]
        bp = break_points(ctx.run, ctx.req.threshold, ids)
        ctx.event("diagnosis", "tool", "diagnosis.breakpoint", rnd=1, run_id=bp["run_id"], attendance=bp["corridor_break_attendance"],
                  station=bp["corridor_break_station"])
    except Exception:                                # a scenario without an event has no break point; never fail a mission on it
        pass
    road = p.base.get("road")
    if road:
        ctx.event("diagnosis", "tool", "diagnosis.road", rnd=1, run_id=p.base["run_id"], peak_veh=round(road["peak_veh_per_hour"]),
                  pressure_pct=_pct(road["pressure"]), hour=road["peak_hour"])
    return {}


def _calm_gate(ctx: MissionCtx) -> bool:
    """Checkpoint 0 (1.18.0, decision #154): no station is over the line. Instead of ending in silence, the stress agent
    tests the scenario harder by itself (mission.calm_probes) and the supervisor asks the human which of those harder
    scenarios to plan for, or to leave it. A harder scenario is a change of scenario: the caller applies it and runs the
    team again (as with `allow` and `raise_cap`). True when the mission stops here to ask."""
    p = ctx.p
    ans = ctx.next_answer("calm")
    if ans is not None:
        ctx.event("human", "message", "checkpoint.answer", rnd=1, to=["supervisor"], checkpoint="calm", action=ans["action"])
        return False                                     # "accept": nothing needs a plan; the mission ends as before
    from .mission import calm_probes
    probes = calm_probes(ctx)
    for q in probes:
        ctx.event("stress", "tool", "stress.probe", rnd=1, to=["supervisor"], run_id=q["run_id"], case=q["id"], peak_pct=_pct(q["peak_lf"]),
                  over=q["overcap_station_hours"], station=q["station"], crosses=q["crosses"], attendance=q.get("attendance"),
                  threshold_pct=_pct(q.get("threshold")))
    offered = [q for q in probes if q["crosses"]]
    if not offered:
        return False                                     # nothing the team could test breaks it: say so and end
    w = max(p.base["hourly"], key=lambda r: (r["peak_lf"], -r["hour"]))
    ctx.pause = {"checkpoint": "calm", "asked_by": "supervisor", "actions": [q["action"] for q in offered] + ["accept"],
                 "params": {"station": w["station_id"], "hour": w["hour"], "peak_pct": _pct(w["peak_lf"]), "threshold_pct": _pct(p.thr),
                            "probes": probes, "run_id": p.base["run_id"]}}
    ctx.event("supervisor", "message", "checkpoint.ask", rnd=1, to=["human"], run_id=p.base["run_id"], checkpoint="calm",
              station=w["station_id"], peak_pct=_pct(w["peak_lf"]), probes=len(offered))
    return True


def _hotspot_gate(ctx: MissionCtx, bins: dict) -> bool:
    """Checkpoint 1 (1.16.0, decision #145): the supervisor asks the human whether to plan for the station the diagnosis
    found, another over-threshold station, or nothing. True when the mission does not go on to the specialists."""
    p = ctx.p
    cands = sorted(bins.values(), key=lambda d: (-d["bins"], d["id"]))
    ans = ctx.next_answer("hotspot")
    if ans is None:
        gap = round(p.target["size"]["why"]["gap"])
        ctx.pause = {"checkpoint": "hotspot", "asked_by": "supervisor", "actions": ["confirm", "focus", "stop"] if len(cands) > 1 else ["confirm", "stop"],
                     "params": {"station": p.hot["station"], "hours": p.hot["hours"], "gap": gap, "candidates": cands, "run_id": p.base["run_id"]}}
        ctx.event("supervisor", "message", "checkpoint.ask", rnd=1, to=["human"], run_id=p.base["run_id"], checkpoint="hotspot",
                  station=p.hot["station"], hours=p.hot["hours"], gap=gap, candidates=len(cands))
        return True
    ctx.event("human", "message", "checkpoint.answer", rnd=1, to=["supervisor"], checkpoint="hotspot", action=ans["action"],
              station=ans.get("station"))
    if ans["action"] == "stop":
        p.hot = None
        ctx.stop_reason = "human_stop"
        return True
    if ans["action"] == "focus" and ans.get("station") in bins and ans["station"] != p.hot["station"]:
        p.focus = ans["station"]
        hot = p.diagnose()
        ctx.event("diagnosis", "decision", "diagnosis.focus", rnd=1, run_id=p.base["run_id"], worst=hot["station"], hours=hot["hours"])
    return False


def route_after_diagnosis(state: State) -> list[str] | str:
    ctx = state["ctx"]
    if ctx.pause is not None:
        return "pause"
    return list(SPECIALISTS) if ctx.p.hot is not None else "conclude"


# ---------------------------------------------------------------- layer 3: specialists (parallel)
def _specialist(agent: str):
    def node(state: State) -> dict:
        ctx: MissionCtx = state["ctx"]
        if ctx.composed:                             # a replan round: answer the critic's objection, if it named this agent
            return _revise(ctx, agent)
        ctx.step(agent)
        p, buf = ctx.p, []
        t = p.target
        if agent == "venue":                         # the venue owns one measure; the composer pairs it with others
            probe = p.size_stagger()                 # its own search: exit spreads tested in the simulator
            ctx.event(agent, "decision", "venue.stagger", into=buf, to=["composer"], available=t["can_stag"], spread=t["spread"],
                      tried=[x["spread"] for x in (probe or {}).get("tried", [])],
                      clears=(probe or {}).get("clears"), run_ids=[x["run_id"] for x in (probe or {}).get("tried", [])])
        own = planner.recipe_bundles(t, {agent})
        if agent != "venue":
            ctx.event(agent, "proposal", f"{agent}.proposed", into=buf, to=["composer"], n=len(own), keys=[c["key"] for c in own],
                      types=sorted({i["type"] for c in own for i in c["ivs"]}), station=t["worst"], **sizing_reason(agent, t))
        props = [{**c, "source": "menu"} for c in own]
        props += model_proposals(ctx, agent, buf)
        return {"proposals": props, "buffers": [{"group": "specialists", "order": _order(agent), "events": buf}]}
    node.__name__ = agent
    return node


def _revise(ctx: MissionCtx, agent: str) -> dict:
    """A specialist's answer to the critic: its own measures resized from the residual gap and its measures for the
    station still over the line (planner.PlanRun.revisions_for). Silent when the objection did not name it."""
    if agent not in {o["to"] for o in ctx.objections}:
        return {}
    ctx.step(agent)
    p, buf = ctx.p, []
    mine = p.revisions_for(agent)
    changes = [{"type": r["iv"]["type"], **_change(r["was"], r["iv"])} for r in mine if r["kind"] == "resize"]
    ctx.event(agent, "proposal", f"{agent}.revised", into=buf, to=["composer"], rnd=p.rounds + 1, resized=changes,
              added=len([r for r in mine if r["kind"] == "combo"]), station=(ctx.objections and next(o for o in ctx.objections if o["to"] == agent)["station"]))
    return {"revisions": [{**r, "round": p.rounds + 1} for r in mine],
            "buffers": [{"group": f"revisions{p.rounds + 1}", "order": _order(agent), "events": buf}]}


_SIZE_KEYS = ("headway_min", "share", "buses", "vehicles", "spread_minutes", "max_load")


def _change(was: dict, now: dict) -> dict:
    """What a revision changed, for the message: {setting, before, after} for the first setting that moved."""
    for k in _SIZE_KEYS:
        if k in was["params"] and was["params"][k] != now["params"].get(k):
            return {"setting": k, "before": was["params"][k], "after": now["params"][k]}
    return {"setting": "hours", "before": len(was["params"].get("hours", [])), "after": len(now["params"].get("hours", []))}


def sizing_reason(agent: str, t: dict) -> dict:
    """The figures a specialist sized its measure with (planner.size_measures), for its message to the composer."""
    z, w = t["size"], t["size"]["why"]
    if agent == "rail":
        return {"headway": z["hw"], "tph_now": w["tph_now"], "need_tph": w["need_tph"], "gap": w["gap"]}
    if agent == "station_crowd":
        return {"share_pct": round(z["share"] * 100), "gap": w["gap"], "room": w["room_nb"], "toward": t["nb"]}
    if agent == "last_mile":
        return {"buses": z["buses"], "vehicles": z["veh"], "gap": w["gap"], "room": w["room_far"], "per_bus": w["per_bus"], "toward": t["far"]}
    return {}


def model_proposals(ctx: MissionCtx, agent: str, buf: list) -> list[dict]:
    """Bundles this specialist's language model adds inside its own measures (S4); none without a model."""
    from .personas import specialist_bundles               # imported lazily: the offline path never needs it
    return specialist_bundles(ctx, agent, buf)


SPECIALIST_NODES = {a: _specialist(a) for a in SPECIALISTS}


# ---------------------------------------------------------------- layer 3: composer
def composer(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("composer")
    p = ctx.p
    forbid = set(ctx.constraints.get("forbid_types") or [])
    if not ctx.composed:                             # round 1: merge the specialists' work
        ctx.composed = True
        ctx.flush(state.get("buffers") or [], "specialists")
        t0 = time.perf_counter()
        props = state.get("proposals") or []
        menu = sorted([c for c in props if c.get("source") == "menu"] + [{**c, "source": "menu"} for c in planner.recipe_bundles(p.target, {"composer"})],
                      key=lambda c: c["ord"])
        allowed = []
        for c in menu:
            bad = sorted({i["type"] for i in c["ivs"]} & forbid)
            if bad:
                ctx.rejected.append({"label": c["key"], "interventions": c["ivs"], "round": 1, "criteria": ["C6"],
                                     "reason": "forbidden", "run_id": None, "summary": None})
                ctx.event("critic", "reject", "critic.forbidden", rnd=1, label=c["key"], types=bad)
                continue
            allowed.append(c)
        p.set_candidates(allowed, t0)
        model = [c for c in sorted(props, key=lambda c: (_order(c["agent"]), c.get("i", 0))) if c.get("source") == "model"]
        added = 0
        for c in model:
            sig = planner._sig(c["ivs"])
            if sig in p.seen or ({i["type"] for i in c["ivs"]} & forbid):
                continue
            p.seen.add(sig)
            p.cands.append({"key": "llm", "ivs": c["ivs"], "ctx": {}, "label": c.get("label", "")})
            added += 1
        if added:                                     # the plan names the model behind its extra bundles
            p.llm_used.append("propose")
            p.llm_added = added
            if p.llm is None and ctx.spec_llm is not None:
                p.llm = ctx.spec_llm
                p.llm_name = planner.llm_mod.display_name(p.llm)
        cross = sum(c["agent"] == "composer" for c in allowed)
        ctx.event("composer", "decision", "composer.bundles", rnd=1, to=["simulation"], menu=len(allowed) - cross, cross=cross, model=added,
                  forbidden=len(menu) - len(allowed))
        ctx.pending = list(p.cands)
        return {}
    # a replanning round: the specialists answered the critic; assemble their revisions in the planner's order
    rnd = p.rounds + 1
    ctx.flush(state.get("buffers") or [], f"revisions{rnd}")
    parts = [r for r in sorted(state.get("revisions") or [], key=lambda r: _order(r["agent"])) if r["round"] == rnd]
    variants = p.compose_replan(parts)
    seeds = [sd["seed"] for sd in p.seeds]
    keep = [v for v in variants if not ({i["type"] for i in v["ivs"]} & forbid)]
    ctx.pending = keep[:planner.MAX_SIMS_PER_ROUND]
    ctx.event("composer", "decision", "composer.replan", rnd=p.rounds, to=["simulation"], seeds=[s["key"] for s in seeds],
              variants=len(ctx.pending), revised=sum(v["key"] == "revised" for v in ctx.pending),
              station=(planner.diagnose(seeds[0]["res"]) or {}).get("station") if seeds else None)
    return {}


def route_after_composer(state: State) -> str:
    return "simulation" if state["ctx"].pending else "ranker"


# ---------------------------------------------------------------- layer 4
def simulation(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("simulation")
    p, rnd = ctx.p, ctx.p.rounds
    cands, ctx.pending = ctx.pending, []
    n_trace = len(p.trace)
    if rnd == 1:
        p.begin_testing()
        p.test(cands, 1)
        p.n_cand = len(p.cands)
    else:
        p.test(cands, rnd)
    for e in p.trace[n_trace:]:
        if e["tool"] == "simulate":
            d = e["data"]
            ctx.event("simulation", "tool", "simulation.result", rnd=rnd, run_id=e["run_id"], label=d["label"], types=d["types"],
                      over=d["over"], excess=round(d["excess"]), peak_pct=_pct(d["peak_lf"]), cost=d["cost_added"], new_hotspots=d["new_hotspots"])
    return {}


def critic(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("critic")
    p = ctx.p
    met = p.critic(p.rounds)
    v = p.last_verdict
    ctx.event("critic", "decision", "critic.verdict", rnd=p.rounds, to=["supervisor"], verdict=v["verdict"], meeting=v["meeting"],
              tested=v["tested"], station=v.get("station"), excess=round(v["excess"]) if v.get("excess") is not None else None,
              best=v.get("best"))
    ctx.critic_met = met
    ctx.objections = []
    if p.can_replan(met):                            # say what fell short, and to whom
        ctx.objections = p.prepare_replan()
        for o in ctx.objections:
            ctx.event("critic", "message", "critic.objection", rnd=p.rounds, to=[o["to"]], station=o["station"], hours=o["hours"],
                      excess=o["excess"], gap=o["gap"], plan=o["plan"], own=o["own"])
    return {}


def supervisor(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("supervisor")
    p = ctx.p
    over = ctx.over_budget()
    if over:
        ctx.exceeded += over
    if p.can_replan(ctx.critic_met) and not over:
        ctx.route = "specialists"
        ctx.event("supervisor", "decision", "supervisor.replan", rnd=p.rounds, next_round=p.rounds + 1,
                  to=[o["to"] for o in ctx.objections] or ["composer"],
                  station=p.last_verdict.get("station"), excess=round(p.last_verdict["excess"]) if p.last_verdict.get("excess") is not None else None)
    else:
        why = ("goal_met" if ctx.critic_met else "budget" if over else "no_relief" if not p.pool else "max_rounds")
        if why == "max_rounds" and "partial" in ctx.checkpoints and _partial_gate(ctx):
            return {}                                # paused for the human, or one more round the human allowed
        ctx.route = "ranker"
        ctx.stop_reason = why
        ctx.event("supervisor", "decision", "supervisor.rank", rnd=p.rounds, reason=why, budget=over)
    return {}


MAX_EXTRA_ROUNDS = 2


def _partial_gate(ctx: MissionCtx) -> bool:
    """Checkpoint 2 (1.16.0, decision #145): no plan meets the goal and the rounds are used up. The supervisor asks the
    human: accept the best plan so far, allow one more round, or change a constraint (allow a measure, raise the cost
    cap; the caller applies those and runs the team again). True when the supervisor does not rank now."""
    p = ctx.p
    ans = ctx.next_answer("partial")
    if ans is None:
        best = sorted(p.pool, key=planner._effect)[0]
        v = p.last_verdict
        acts = ["accept"] + (["more"] if p.extra_rounds < MAX_EXTRA_ROUNDS else [])
        acts += (["allow"] if ctx.constraints.get("forbid_types") else []) + (["raise_cap"] if ctx.constraints.get("cost_cap") is not None else [])
        ctx.pause = {"checkpoint": "partial", "asked_by": "supervisor", "actions": acts,
                     "params": {"rounds": p.rounds, "station": v.get("station"), "excess": round(v["excess"]) if v.get("excess") is not None else None,
                                "best": {"interventions": best["ivs"], "over": best["res"]["summary"]["overcap_station_hours"],
                                         "excess": round(best["res"]["summary"]["excess_pax"]), "run_id": best["res"]["run_id"]},
                                "forbidden": list(ctx.constraints.get("forbid_types") or []), "cost_cap": ctx.constraints.get("cost_cap")}}
        ctx.event("supervisor", "message", "checkpoint.ask", rnd=p.rounds, to=["human"], run_id=best["res"]["run_id"], checkpoint="partial",
                  station=v.get("station"), excess=ctx.pause["params"]["excess"], rounds=p.rounds)
        return True
    ctx.event("human", "message", "checkpoint.answer", rnd=p.rounds, to=["supervisor"], checkpoint="partial", action=ans["action"])
    if ans["action"] == "more" and p.extra_rounds < MAX_EXTRA_ROUNDS:
        p.extra_rounds += 1
        ctx.objections = p.prepare_replan()              # what the critic would have said had a round been left
        for o in ctx.objections:
            ctx.event("critic", "message", "critic.objection", rnd=p.rounds, to=[o["to"]], station=o["station"], hours=o["hours"],
                      excess=o["excess"], gap=o["gap"], plan=o["plan"], own=o["own"])
        ctx.route = "specialists"
        ctx.event("supervisor", "decision", "supervisor.replan", rnd=p.rounds, next_round=p.rounds + 1,
                  to=[o["to"] for o in ctx.objections] or ["composer"], station=p.last_verdict.get("station"),
                  excess=round(p.last_verdict["excess"]) if p.last_verdict.get("excess") is not None else None, human=True)
        return True
    return False                                     # accept (or an answer that cannot apply here): rank what there is


def route_after_supervisor(state: State) -> list[str] | str:
    """Replan: back to the specialists (each one checks whether the critic's objection names it), else rank."""
    ctx = state["ctx"]
    if ctx.pause is not None:
        return "pause"
    return list(SPECIALISTS) if ctx.route == "specialists" else "ranker"


def pause_node(state: State) -> dict:
    """The team stops at a checkpoint and hands the question to the human (the mission's status is 'paused')."""
    ctx: MissionCtx = state["ctx"]
    ctx.step("pause")
    ctx.stop_reason = "paused"
    ctx.explain_t0 = time.perf_counter()
    ctx.result = conclude(ctx)
    return {}


def ranker(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("ranker")
    p = ctx.p
    if not ctx.stop_reason:
        ctx.stop_reason = "no_variants"
    top = p.rank()
    ctx.event("ranker", "decision", "ranker.kept", rnd=p.rounds, to=["explainer", "stress"], kept=len(top), tested=len(p.pool),
              order=[o["key"] for o in top],
              run_ids=[o["res"]["run_id"] for o in top])
    return {}


def explainer(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("explainer")
    p, buf = ctx.p, []
    p.render()
    ctx.templates = copy_texts(p.options)
    from .personas import explain_options                     # S4: the explainer's model, if any (recorded answers offline)
    ctx.explain_t0 = explain_options(ctx, buf)
    ctx.event("explainer", "tool", "explainer.wrote", into=buf, options=len(p.options),
              source=p.llm_name if "explain" in p.llm_used else "template", template_fallback=sorted(p.template_used))
    return {"buffers": [{"group": "finalists", "order": 0, "events": buf}]}


def stress(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("stress")
    buf = []
    opts = [{"rank": i + 1, "interventions": o["ivs"]} for i, o in enumerate(ctx.p.top)]
    ctx.assessments = stress_test(ctx, opts)
    for rank, a in sorted(ctx.assessments.items()):
        ctx.event("stress", "tool", "stress.result", into=buf, rank=rank, holds=a["holds"], total=a["total"],
                  failed=[c["case"] for c in a["cases"] if not c["holds"]])
    return {"buffers": [{"group": "finalists", "order": 1, "events": buf}]}


def verifier(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("verifier")
    p = ctx.p
    ctx.flush(state.get("buffers") or [], "finalists")
    for o, tmpl in zip(p.options, ctx.templates):
        if claim_violations(o):                       # a model text that claims endorsement: back to the verified template
            o.update(tmpl)
            ctx.claims_blocked.append(o["rank"])
    p.log_explain_verify(ctx.explain_t0)
    ctx.event("verifier", "decision", "verifier.checked", rnd=p.rounds, checked=p.checked, all_matched=p.all_ok,
              claims_blocked=ctx.claims_blocked)
    return {}


def conclude_node(state: State) -> dict:
    ctx: MissionCtx = state["ctx"]
    ctx.step("conclude")
    if ctx.p.hot is None and ctx.stop_reason != "human_stop":
        ctx.stop_reason = "no_action"
        ctx.explain_t0 = time.perf_counter()
    ctx.result = conclude(ctx)
    return {}
