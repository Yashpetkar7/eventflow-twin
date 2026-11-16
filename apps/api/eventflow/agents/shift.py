"""The duty shift on autopilot (docs/15, decision #128): the standing Watcher and the planning team working a scenario
day by themselves, stopping whenever a human decision is needed.

One call is one step. The clock runs from `from_hour` to the next alert the Watcher raises (three hours ahead of a
crossing; an incident cannot be seen before its hour), the team plans on top of the measures already approved, and
the step returns with the option the critic's checks recommend waiting in the approval inbox. Nothing is applied here: the client
logs the human's decision (POST /decisions), adds an approved option's measures to `applied`, marks the alerts as
handled and asks for the next step. The API keeps no shift state, so any instance can serve any step.

Every figure is the simulator's or the Watcher's (CLAUDE.md rule 2); this module only orders the work.
"""
from __future__ import annotations

from typing import Callable

from ..forecast import make_run_id
from .standing import watch

MAX_HANDLED = 40       # alerts a shift deals with before the rest goes to the duty manager (it cannot ask a human for ever)


def alert_key(a: dict, applied: int) -> str:
    """How an alert is marked as dealt with. The number of approved measures is part of it: after an approval a
    station that is still over the line is a new alert (the team plans again on top of what is in place); after a
    rejection nothing has changed, so the same alert is not raised twice."""
    return f"{a['station']}@{a['crosses_at']}#{applied}"


def scan(run: dict, req, simulate: Callable[..., dict]) -> dict:
    """The Watcher's half of a step: the day with the measures approved so far, and either the end of the day
    (`done`) or the alerts it raises at the next hour that needs a decision. No planning, nothing applied."""
    applied = [i.model_dump() if hasattr(i, "model_dump") else i for i in req.applied]
    now = simulate(run["run_id"], applied, False, req.threshold, req.scope)
    w = watch(run, now, req.horizon_h)
    handled = set(req.handled)
    # an alert whose crossing lies before the shift's clock is still an alert ("already over the line"): a what-if
    # incident changes the whole scenario day, and a shift that hid it would report a clear day that is not clear
    pending = [a for a in w["alerts"] if alert_key(a, len(applied)) not in handled]
    out = {"watch": w, "residual": now["summary"], "baseline": now["baseline_summary"], "applied_count": len(applied),
           "handled_count": len(handled), "is_synthetic": run["is_synthetic"], "mission": None, "alerts": [], "recommended_rank": None,
           "run_id": make_run_id("shift", {"sim": now["run_id"], "from": req.from_hour, "handled": sorted(handled)})}
    if not pending:                                   # every alert has been dealt with; "clear" only if nothing is over the line
        clear = now["summary"]["overcap_station_hours"] == 0
        return {**out, "done": True, "reason": "clear" if clear else "residual", "hour": 23}
    if len(handled) >= MAX_HANDLED:
        return {**out, "done": True, "reason": "step_limit", "hour": req.from_hour,
                "alerts": [_seen(a, max(req.from_hour, a["raised_at"]), len(applied)) for a in pending]}
    hour = min(max(req.from_hour, a["raised_at"]) for a in pending)
    raised = [_seen(a, hour, len(applied)) for a in pending if max(req.from_hour, a["raised_at"]) <= hour]
    return {**out, "done": False, "reason": "alert", "hour": hour, "alerts": raised}


def with_plan(step: dict, mission: dict) -> dict:
    """The planning team's half: the mission, and the option the critic's checks recommend (mission.recommend)."""
    options = mission["plan"]["options"]
    return {**step, "reason": "awaiting_human" if options else "no_option", "mission": mission,
            "recommended_rank": mission.get("recommended_rank") if options else None}


def next_step(run: dict, req, simulate: Callable[..., dict], plan: Callable[[], dict]) -> dict:
    """`simulate`: main.run_simulation; `plan`: runs the agent team on this scenario with the measures applied so far."""
    step = scan(run, req, simulate)
    return step if step["done"] else with_plan(step, plan())


def _seen(a: dict, hour: int, applied: int) -> dict:
    return {**a, "key": alert_key(a, applied), "seen_at": hour, "lead_now_h": a["crosses_at"] - hour}
