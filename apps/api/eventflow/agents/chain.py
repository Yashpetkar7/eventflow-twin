"""The event chain — the agentic loop: agents triggered by each other's events, the human at every decision
(docs/15 §8 and §11, decisions #135 and #144).

An agent publishes an event on a topic; every agent subscribed to that topic is triggered by it and may publish the
next event. The chain runs by itself until an event reaches the human, and continues when the human's answer is
published. Since 1.16.0 the human is asked at more than the final approval:

    scenario.loaded ─► Watcher ─► alert.raised ─► Supervisor (the planning team on LangGraph)
          ▲                                          │            │
          │                                          │      checkpoint.asked ─► human ─► checkpoint.answered ─► Supervisor
          │                                     plan.ready ─► human (approval inbox)
          │                                                     │ approve · reject · reject with a reason
          │                           decision.made ◄───────────┘
          │                             ├─► Messenger ─► drafts.ready (EN + AR, never sent)          (after an approval)
          │                             ├─► Intake ─► feedback.read ─► Supervisor (replans the same alert)  (a reason)
          └─────────────── Watcher ◄────┘                                                              (otherwise)
    conditions.changed (human: rain, a train fault, a bigger crowd) ─► Watcher ─► plan.checked ─► alert.raised or day.ended
    Watcher, nothing left ─► day.ended ─► human (clear · residual · step_limit)

Rules kept from the rest of the system: every figure is a simulator's or a tool's (CLAUDE.md rule 2); nothing is
applied without the human's decision, which is logged before it takes effect (rule 3); a reason or an answer only
changes what the planner could set by hand (constraints, priority, which station, one more round). The chain's whole
state is a JSON document (store.py), so any API instance can continue it; the response always carries the full state.
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
    "checkpoint.asked": ["human"],
    "checkpoint.answered": ["supervisor"],
    "plan.ready": ["human"],
    "decision.made": ["messenger", "intake", "watcher"],
    "feedback.read": ["supervisor"],
    "drafts.ready": ["human"],
    "conditions.changed": ["watcher"],
    "plan.checked": ["human"],
    "day.ended": ["human"],
}
MAX_EVENTS = 400            # a chain that never reaches a human stops here (it cannot: every alert asks one)
EMPTY = {"forbid_types": [], "protect_stations": [], "cost_cap": None}


@dataclass
class Deps:
    """What the chain may call (main.py wires the real ones; tests can wire fakes)."""
    run: dict
    simulate: Callable[..., dict]                      # main.run_simulation
    mission: Callable[[dict], dict]                    # chain state → the agent team's mission (applied, constraints, answers, checkpoints)
    message: Callable[[list[dict], list[dict]], dict]  # (applied before, approved measures) → Messenger drafts
    log_decision: Callable[[dict], dict]               # DecisionRequest fields → POST /decisions answer
    feedback: Callable[[dict], dict] | None = None     # FeedbackRequest fields → FeedbackResponse (agents/loop.py)


def new_state(req: dict, run_id: str) -> dict:
    return {"chain_id": f"chain_{uuid.uuid4().hex[:12]}", "status": "running", "request": req, "forecast_run_id": run_id,
            "applied": [], "handled": [], "hour": 5, "events": [], "inbox": None, "drafts": [], "decisions": [],
            "started": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "ended_reason": None,
            "constraints": dict(req.get("constraints") or EMPTY), "priority": req.get("priority", "balanced"),
            "answers": [], "feedback_rounds": 0, "pause": None,
            "loop": {"plans": 0, "checkpoints": 0, "answers": 0, "feedback": 0, "changes": 0, "approvals": 0, "rejections": 0}}


def _loop(state: dict, key: str) -> None:
    state.setdefault("loop", {}).setdefault(key, 0)
    state["loop"][key] += 1


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
    out = []
    if state.pop("_changed", False):                   # conditions changed: does the approved plan still hold?
        holds = step["done"] and step["reason"] == "clear"
        out.append(publish(state, "plan.checked", "watcher", holds=holds, applied=len(state["applied"]), run_id=step["run_id"],
                           over=step["residual"]["overcap_station_hours"], excess=round(step["residual"]["excess_pax"]),
                           alerts=0 if step["done"] else len(step["alerts"]), ms=ms))
    if step["done"]:
        return out + [publish(state, "day.ended", "watcher", reason=step["reason"], residual=step["residual"], baseline=step["baseline"],
                              applied=len(state["applied"]), ms=ms, run_id=step["run_id"])]
    state["hour"] = step["hour"]
    return out + [publish(state, "alert.raised", "watcher", hour=step["hour"], ms=ms, run_id=step["run_id"],
                          alerts=[{k: a[k] for k in ("key", "station", "crosses_at", "raised_at", "lead_now_h", "peak_lf")} for a in step["alerts"]])]


def _supervisor(state: dict, deps: Deps) -> list[dict]:
    t0 = time.perf_counter()
    # the Watcher's step for the alert being planned; after a pause or a reason it is scanned again (deterministic:
    # the same clock, the same handled alerts and the same applied measures raise the same alert)
    step = state.pop("_step", None) or scan(deps.run, _scan_req(state), deps.simulate)
    mission = deps.mission(state)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    _loop(state, "plans")
    if mission.get("status") == "paused":
        state["pause"], state["inbox"] = mission["pause"], None
        state["_paused_mission"] = mission
        _loop(state, "checkpoints")
        return [publish(state, "checkpoint.asked", "supervisor", checkpoint=mission["pause"]["checkpoint"], actions=mission["pause"]["actions"],
                        params=mission["pause"]["params"], mission_id=mission["mission_id"], agent_events=len(mission["events"]), ms=ms)]
    step = with_plan(step, mission)
    state["pause"] = None
    state["inbox"] = {"mission": mission, "recommended_rank": step["recommended_rank"], "alerts": step["alerts"], "hour": step["hour"],
                      "residual": step["residual"], "baseline": step["baseline"]}
    rec = mission.get("recommendation")
    return [publish(state, "plan.ready", "supervisor", mission_id=mission["mission_id"], plan_id=mission["plan"]["plan_id"],
                    engine=mission["engine"], options=len(mission["plan"]["options"]), recommended_rank=step["recommended_rank"],
                    basis=rec["basis"] if rec else None, agent_events=len(mission["events"]), stop_reason=mission.get("stop_reason"),
                    round=state["feedback_rounds"] + 1, ms=ms)]


def _messenger(state: dict, deps: Deps, e: dict) -> list[dict]:
    if e["payload"]["decision"] != "approve":
        return []
    t0 = time.perf_counter()
    d = deps.message(e["payload"]["applied_before"], e["payload"]["interventions"])
    state["drafts"].append({"after_decision": e["seq"], **d})
    return [publish(state, "drafts.ready", "messenger", numbers_checked=d.get("numbers_checked"), sent=False,
                    ms=round((time.perf_counter() - t0) * 1000, 1))]


def _intake(state: dict, e: dict) -> list[dict]:
    """A rejection with a reason: the feedback was read in decide(); publish what it changed for the Supervisor."""
    fb = e["payload"].get("feedback")
    if not fb:
        return []
    return [publish(state, "feedback.read", "intake", changes=fb["changes"], constraints=state["constraints"], priority=state["priority"],
                    findings=len(fb.get("findings") or []), source=fb.get("source", "rules"), round=state["feedback_rounds"] + 1)]


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
                        state["ended_reason"] = "human_stop" if e["payload"].get("stop_reason") == "human_stop" else "no_option"
                elif e["topic"] == "checkpoint.asked":
                    state["status"] = "awaiting_human"
                elif e["topic"] == "day.ended":
                    state["status"], state["ended_reason"] = "ended", e["payload"]["reason"]
                continue
            if sub == "watcher":
                if e["topic"] == "decision.made" and e["payload"].get("feedback"):
                    continue                           # the team replans this alert first (feedback.read → Supervisor)
                queue += _watcher(state, deps)
            elif sub == "supervisor":
                queue += _supervisor(state, deps)
            elif sub == "messenger":
                queue += _messenger(state, deps, e)
            elif sub == "intake":
                queue += _intake(state, e)
    return state


def start(state: dict, deps: Deps) -> dict:
    e = publish(state, "scenario.loaded", "human", event_id=(deps.run.get("event") or {}).get("id"), run_id=deps.run["run_id"],
                incident=(state["request"].get("forecast") or {}).get("incident"))
    return drive(state, deps, e)


class ChainError(ValueError):
    pass


def decide(state: dict, deps: Deps, rank: int | None, decision: str, user: str = "duty-manager", reason: dict | None = None) -> dict:
    """The human's decision on the inbox: logged first (POST /decisions), then published; the chain continues.
    `reason` (a rejection's reason_codes / reason / avoid / protect) is read into constraints and the team replans the
    same alert, up to `max_feedback_rounds` times; after that a rejection sets the alert aside as before."""
    if state["status"] != "awaiting_human" or not state["inbox"]:
        raise ChainError(f"chain is {state['status']}, not waiting for a decision")
    mission = state["inbox"]["mission"]
    rank = rank or state["inbox"]["recommended_rank"]
    opt = next((o for o in mission["plan"]["options"] if o["rank"] == rank), None)
    if opt is None:
        raise ChainError(f"no option {rank} in the inbox")
    fb = None
    reason = reason if decision == "reject" and reason and (reason.get("reason_codes") or (reason.get("reason") or "").strip()) else None
    if reason and deps.feedback is not None and state["feedback_rounds"] < state["request"].get("max_feedback_rounds", 3):
        fb = deps.feedback({**reason, "interventions": opt["interventions"], "cost_proxy": opt.get("cost_added"),
                            "constraints": state["constraints"], "priority": state["priority"], "locale": state["request"].get("locale", "en")})
        if not fb.get("replan"):
            fb = None                                    # the reason changed nothing the team can act on: an ordinary rejection
    from .loop import reason_codes_for_log
    codes = reason_codes_for_log(SimpleNamespace(**{"reason_codes": [], "avoid": [], "protect": [], **(reason or {})})) if reason else []
    logged = deps.log_decision({"plan_id": mission["plan"]["plan_id"], "option_rank": rank, "decision": decision, "user": user,
                                "option_title": opt["title"][:200], "forecast_run_id": state["forecast_run_id"],
                                "interventions": opt["interventions"], "reason_codes": codes,
                                "reason": ((reason or {}).get("reason") or None)})
    before = list(state["applied"])
    _loop(state, "approvals" if decision == "approve" else "rejections")
    if decision == "approve":
        state["applied"] = planner.merge(state["applied"], opt["interventions"])
    if fb:                                               # replan the same alert with what the reason added
        state["constraints"], state["priority"] = fb["constraints"], fb["priority"]
        _loop(state, "feedback")
    else:
        state["handled"] = sorted(set(state["handled"]) | {a["key"] for a in state["inbox"]["alerts"]})
    state["decisions"].append({"rank": rank, "decision": decision, "decision_id": logged["decision_id"], "plan_id": mission["plan"]["plan_id"],
                               "title": opt["title"], "reason_codes": codes, "replanned": bool(fb)})
    # a replan keeps the hotspot answer (constraints do not change the diagnosis); a new alert starts with no answers
    state["inbox"], state["status"] = None, "running"
    state["answers"] = [a for a in state["answers"] if a["checkpoint"] == "hotspot"] if fb else []
    e = publish(state, "decision.made", "human", decision=decision, rank=rank, decision_id=logged["decision_id"],
                plan_id=mission["plan"]["plan_id"], interventions=opt["interventions"], applied_before=before,
                reason_codes=codes, feedback={"changes": fb["changes"], "findings": fb.get("findings", []), "source": fb.get("source")} if fb else None)
    if fb:
        state["feedback_rounds"] += 1
    else:
        state["feedback_rounds"] = 0
    return drive(state, deps, e)


def answer(state: dict, deps: Deps, ans: dict) -> dict:
    """The human's answer at a checkpoint. confirm / focus / stop / accept / more are replayed by the team; allow and
    raise_cap change the chain's constraints (the planner's own choice, now made at the moment it matters) and the
    team plans the alert again from the start with them."""
    p = state.get("pause")
    if state["status"] != "awaiting_human" or not p:
        raise ChainError(f"chain is {state['status']}, not waiting at a checkpoint")
    if ans["checkpoint"] != p["checkpoint"] or ans["action"] not in p["actions"]:
        raise ChainError(f"{ans['checkpoint']}:{ans['action']} does not answer this checkpoint ({p['checkpoint']}: {', '.join(p['actions'])})")
    if ans["action"] == "focus" and ans.get("station") not in {c["id"] for c in p["params"].get("candidates", [])}:
        raise ChainError("focus: choose one of the stations over the line")
    c = dict(state["constraints"])
    if ans["action"] == "allow":
        if ans.get("measure") not in (c.get("forbid_types") or []):
            raise ChainError("allow: name a measure that is ruled out")
        c["forbid_types"] = [t for t in c["forbid_types"] if t != ans["measure"]]
        state["constraints"] = c
        state["answers"] = [a for a in state["answers"] if a["checkpoint"] != "partial"]
    elif ans["action"] == "raise_cap":
        if ans.get("cost_cap") is None or (c.get("cost_cap") is not None and ans["cost_cap"] <= c["cost_cap"]):
            raise ChainError("raise_cap: give a cost cap above the current one")
        c["cost_cap"] = ans["cost_cap"]
        state["constraints"] = c
        state["answers"] = [a for a in state["answers"] if a["checkpoint"] != "partial"]
    else:
        state["answers"] = [*state["answers"], {k: ans.get(k) for k in ("checkpoint", "action", "station", "measure", "cost_cap")}]
    _loop(state, "answers")
    state["pause"], state["status"] = None, "running"
    state.pop("_paused_mission", None)
    e = publish(state, "checkpoint.answered", "human", checkpoint=ans["checkpoint"], action=ans["action"], station=ans.get("station"),
                measure=ans.get("measure"), cost_cap=ans.get("cost_cap"), constraints=state["constraints"])
    return drive(state, deps, e)


def change(state: dict, deps: Deps, what: dict) -> dict:
    """Conditions changed (the caller has already rebuilt the run with them): the Watcher re-checks the day from the
    current hour with every approved measure in place. Alerts already dealt with are looked at again, because the
    plan that dealt with them was made for the old conditions; a plan waiting in the inbox is withdrawn for the same reason."""
    if state["status"] == "running":
        raise ChainError("the chain is still working")
    state["handled"], state["answers"], state["pause"], state["inbox"] = [], [], None, None
    state["feedback_rounds"], state["status"], state["ended_reason"] = 0, "running", None
    state["_changed"] = True
    _loop(state, "changes")
    e = publish(state, "conditions.changed", "human", **what)
    return drive(state, deps, e)


def public(state: dict) -> dict:
    """The state as the API returns it (internal scratch keys removed)."""
    return {k: v for k, v in state.items() if not k.startswith("_")}
