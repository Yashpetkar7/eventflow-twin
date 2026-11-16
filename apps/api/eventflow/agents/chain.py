"""The event chain: agents triggered by each other's events, not by button presses (docs/15 §8, decision #132).

An agent publishes an event on a topic; every agent subscribed to that topic is triggered by it and may publish the
next event. The chain runs by itself until an event reaches the human (the approval inbox, or the end of the day),
and continues when the human's decision is published.

    scenario.loaded ─► Watcher ─► alert.raised ─► Supervisor (runs the planning team on LangGraph)
                          ▲                                  │
                          │                              plan.ready ─► human (approval inbox) ── waits
                          │                                                     │ approve / reject
                          └─────── Watcher ◄── decision.made ◄──────────────────┘
                                                   └──► Messenger ─► drafts.ready (EN + AR, never sent)
    Watcher, nothing left ─► day.ended ─► human (clear · residual · step_limit)

Rules kept from the rest of the system: every figure is a simulator's or a tool's (CLAUDE.md rule 2); nothing is
applied without the human's decision, which is logged before it takes effect (rule 3). The chain's whole state is a
JSON document (store.py), so any API instance can continue it; the response always carries the full state too.
"""
from __future__ import annotations

import datetime as dt
import time
import uuid
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Callable

from . import planner
from .shift import scan, with_plan

# Who is triggered by what. The order of subscribers is the order they act in.
SUBSCRIBERS: dict[str, list[str]] = {
    "scenario.loaded": ["watcher"],
    "alert.raised": ["supervisor"],
    "plan.ready": ["human"],
    "decision.made": ["messenger", "watcher"],
    "drafts.ready": ["human"],
    "day.ended": ["human"],
}
MAX_EVENTS = 400            # a chain that never reaches a human stops here (it cannot: every alert asks one)


@dataclass
class Deps:
    """What the chain may call (main.py wires the real ones; tests can wire fakes)."""
    run: dict
    simulate: Callable[..., dict]                      # main.run_simulation
    mission: Callable[[list[dict]], dict]              # applied measures → the agent team's mission
    message: Callable[[list[dict], list[dict]], dict]  # (applied before, approved measures) → Messenger drafts
    log_decision: Callable[[dict], dict]               # DecisionRequest fields → POST /decisions answer


def new_state(req: dict, run_id: str) -> dict:
    return {"chain_id": f"chain_{uuid.uuid4().hex[:12]}", "status": "running", "request": req, "forecast_run_id": run_id,
            "applied": [], "handled": [], "hour": 5, "events": [], "inbox": None, "drafts": [], "decisions": [],
            "started": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "ended_reason": None}


def publish(state: dict, topic: str, publisher: str, **payload) -> dict:
    e = {"seq": len(state["events"]) + 1, "topic": topic, "publisher": publisher, "subscribers": SUBSCRIBERS[topic],
         "at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds"), "payload": payload}
    state["events"].append(e)
    return e


def _scan_req(state: dict):
    r = state["request"]
    return SimpleNamespace(applied=state["applied"], threshold=r.get("threshold"), scope=r.get("scope", "corridor"),
                           horizon_h=r.get("horizon_h", 3), handled=state["handled"], from_hour=state["hour"])


# ---------------------------------------------------------------- the subscribers
def _watcher(state: dict, deps: Deps) -> list[dict]:
    t0 = time.perf_counter()
    step = scan(deps.run, _scan_req(state), deps.simulate)
    state["_step"] = step
    ms = round((time.perf_counter() - t0) * 1000, 1)
    if step["done"]:
        return [publish(state, "day.ended", "watcher", reason=step["reason"], residual=step["residual"], baseline=step["baseline"],
                        applied=len(state["applied"]), ms=ms, run_id=step["run_id"])]
    state["hour"] = step["hour"]
    return [publish(state, "alert.raised", "watcher", hour=step["hour"], ms=ms, run_id=step["run_id"],
                    alerts=[{k: a[k] for k in ("key", "station", "crosses_at", "raised_at", "lead_now_h", "peak_lf")} for a in step["alerts"]])]


def _supervisor(state: dict, deps: Deps) -> list[dict]:
    t0 = time.perf_counter()
    mission = deps.mission(state["applied"])
    step = with_plan(state.pop("_step"), mission)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    state["inbox"] = {"mission": mission, "recommended_rank": step["recommended_rank"], "alerts": step["alerts"], "hour": step["hour"],
                      "residual": step["residual"], "baseline": step["baseline"]}
    rec = mission.get("recommendation")
    return [publish(state, "plan.ready", "supervisor", mission_id=mission["mission_id"], plan_id=mission["plan"]["plan_id"],
                    engine=mission["engine"], options=len(mission["plan"]["options"]), recommended_rank=step["recommended_rank"],
                    basis=rec["basis"] if rec else None, agent_events=len(mission["events"]), ms=ms)]


def _messenger(state: dict, deps: Deps, e: dict) -> list[dict]:
    if e["payload"]["decision"] != "approve":
        return []
    t0 = time.perf_counter()
    d = deps.message(e["payload"]["applied_before"], e["payload"]["interventions"])
    state["drafts"].append({"after_decision": e["seq"], **d})
    return [publish(state, "drafts.ready", "messenger", numbers_checked=d.get("numbers_checked"), sent=False,
                    ms=round((time.perf_counter() - t0) * 1000, 1))]


def drive(state: dict, deps: Deps, start: dict) -> dict:
    """Deliver events to their subscribers until one reaches the human."""
    queue = [start]
    while queue:
        if len(state["events"]) >= MAX_EVENTS:
            state["status"], state["ended_reason"] = "ended", "event_limit"
            break
        e = queue.pop(0)
        for sub in SUBSCRIBERS[e["topic"]]:
            if sub == "human":
                if e["topic"] == "plan.ready":
                    state["status"] = "awaiting_human" if e["payload"]["options"] else "ended"
                    if not e["payload"]["options"]:
                        state["ended_reason"] = "no_option"
                elif e["topic"] == "day.ended":
                    state["status"], state["ended_reason"] = "ended", e["payload"]["reason"]
                continue
            if sub == "watcher":
                queue += _watcher(state, deps)
            elif sub == "supervisor":
                queue += _supervisor(state, deps)
            elif sub == "messenger":
                queue += _messenger(state, deps, e)
    return state


def start(state: dict, deps: Deps) -> dict:
    e = publish(state, "scenario.loaded", "human", event_id=(deps.run.get("event") or {}).get("id"), run_id=deps.run["run_id"],
                incident=(state["request"].get("forecast") or {}).get("incident"))
    return drive(state, deps, e)


class ChainError(ValueError):
    pass


def decide(state: dict, deps: Deps, rank: int | None, decision: str, user: str = "duty-manager") -> dict:
    """The human's decision on the inbox: logged first (POST /decisions), then published; the chain continues."""
    if state["status"] != "awaiting_human" or not state["inbox"]:
        raise ChainError(f"chain is {state['status']}, not waiting for a decision")
    mission = state["inbox"]["mission"]
    rank = rank or state["inbox"]["recommended_rank"]
    opt = next((o for o in mission["plan"]["options"] if o["rank"] == rank), None)
    if opt is None:
        raise ChainError(f"no option {rank} in the inbox")
    logged = deps.log_decision({"plan_id": mission["plan"]["plan_id"], "option_rank": rank, "decision": decision, "user": user,
                                "option_title": opt["title"][:200], "forecast_run_id": state["forecast_run_id"],
                                "interventions": opt["interventions"]})
    before = list(state["applied"])
    if decision == "approve":
        state["applied"] = planner.merge(state["applied"], opt["interventions"])
    state["handled"] = sorted(set(state["handled"]) | {a["key"] for a in state["inbox"]["alerts"]})
    state["decisions"].append({"rank": rank, "decision": decision, "decision_id": logged["decision_id"], "plan_id": mission["plan"]["plan_id"],
                               "title": opt["title"]})
    state["inbox"], state["status"] = None, "running"
    e = publish(state, "decision.made", "human", decision=decision, rank=rank, decision_id=logged["decision_id"],
                plan_id=mission["plan"]["plan_id"], interventions=opt["interventions"], applied_before=before)
    return drive(state, deps, e)


def public(state: dict) -> dict:
    """The state as the API returns it (internal scratch keys removed)."""
    return {k: v for k, v in state.items() if not k.startswith("_")}
