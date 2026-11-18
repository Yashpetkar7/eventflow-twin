"""The agentic loop's human parts (decision #145): a rejection's reason read into constraints, and the planner's memory.

    reject with a reason ("too expensive", "no buses", "not enough relief", or own words)
        → read_feedback → the constraints and priority for the next round → the team replans the same alert
    the decision log (tamper-evident, append-only) → memory → suggestions the planner may add; never applied

What a reason can do is exactly what the planner could already do by hand with the typed constraints: forbid a measure,
protect a station, cap the cost, change the priority. It can never add a measure, change a forecast or approve anything.
Free words go through the brief reader (agents/brief.py): the same word rules offline, the same model with the same
quote check when a model is available, the same screening of instruction-like text.
"""
from __future__ import annotations

import datetime as dt
import json
import math
from collections import defaultdict
from pathlib import Path

from .brief import corridor_stations, read_brief, screen
from .llm import MENU

COST_CUT = 0.8          # "too costly": the next plans must cost at most 80 % of the rejected one


def _as_dict(x) -> dict:
    return x.model_dump() if hasattr(x, "model_dump") else dict(x or {})


def read_feedback(req) -> dict:
    """FeedbackResponse for one rejection. Pure apart from the optional model call inside the brief reader."""
    c = _as_dict(req.constraints)
    forbid, protect, cap = list(c.get("forbid_types") or []), list(c.get("protect_stations") or []), c.get("cost_cap")
    priority, changes = req.priority, []
    ids = {s["id"] for s in corridor_stations()}
    types = [(_as_dict(iv).get("type")) for iv in req.interventions]

    def add_forbid(t: str, via: str) -> None:
        if t in MENU and t not in forbid:
            forbid.append(t)
            changes.append({"field": "forbid", "value": t, "via": via})

    def add_protect(s: str, via: str) -> None:
        if s in ids and s not in protect:
            protect.append(s)
            changes.append({"field": "protect", "value": s, "via": via})

    codes = list(dict.fromkeys(req.reason_codes))
    if "too_costly" in codes:
        if priority != "cost":
            priority = "cost"
            changes.append({"field": "priority", "value": "cost", "via": "reason"})
        if req.cost_proxy:
            new = math.floor(req.cost_proxy * COST_CUT)
            if new > 0 and (cap is None or new < cap):
                cap = float(new)
                changes.append({"field": "cost_cap", "value": cap, "via": "reason"})
    if "not_enough" in codes and priority != "impact":
        priority = "impact"
        changes.append({"field": "priority", "value": "impact", "via": "reason"})
    if "avoid_measure" in codes:
        for t in (req.avoid or [t for t in types if t]):
            add_forbid(t, "reason")
    if "protect_station" in codes:
        for s in req.protect:
            add_protect(s, "reason")
    findings, source = [], "rules"
    words = (req.reason or "").strip()
    if words:
        findings = screen(words)
        b = read_brief(words, req.locale)
        source = b["source"]
        for t in b["constraints"]["forbid_types"]:
            add_forbid(t, "words")
        for s in b["constraints"]["protect_stations"] + ([b["event"]["near_station"]] if b["event"]["near_station"] and "protect" in words.lower() else []):
            add_protect(s, "words")
        if b["constraints"]["cost_cap"] and (cap is None or b["constraints"]["cost_cap"] < cap):
            cap = float(b["constraints"]["cost_cap"])
            changes.append({"field": "cost_cap", "value": cap, "via": "words"})
        if b["priority"] and b["priority"] != priority:
            priority = b["priority"]
            changes.append({"field": "priority", "value": priority, "via": "words"})
        findings += [f for f in b["findings"] if f not in findings]
    return {"constraints": {"forbid_types": forbid, "protect_stations": protect, "cost_cap": cap}, "priority": priority,
            "changes": changes, "findings": findings, "source": source, "replan": bool(changes)}


def reason_codes_for_log(req) -> list[str]:
    """The reason as it is written into the decision log: too_costly · not_enough · avoid:<measure> · protect:<station> · other."""
    out = [c for c in req.reason_codes if c in ("too_costly", "not_enough", "other")]
    if "avoid_measure" in req.reason_codes:
        out += [f"avoid:{t}" for t in (req.avoid or [])]
    if "protect_station" in req.reason_codes:
        out += [f"protect:{s}" for s in (req.protect or [])]
    return out[:8]


def memory(log: Path, user: str, today: dt.date | None = None, days: int = 1) -> dict:
    """MemoryResponse: what this planner's logged rejections (today, by default) say about their preferences."""
    since = (today or dt.date.today()) - dt.timedelta(days=days - 1)
    agg: dict[tuple[str, str], dict] = defaultdict(lambda: {"count": 0, "last": ""})
    n = 0
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("user") != user or r.get("decision") != "reject" or not r.get("reason_codes"):
                continue
            try:
                if dt.date.fromisoformat(str(r.get("timestamp", ""))[:10]) < since:
                    continue
            except ValueError:
                continue
            n += 1
            for code in r["reason_codes"]:
                k = (("avoid", code.split(":", 1)[1]) if code.startswith("avoid:") else ("protect", code.split(":", 1)[1]) if code.startswith("protect:")
                     else ("priority", "cost") if code == "too_costly" else ("priority", "impact") if code == "not_enough" else None)
                if k is None:
                    continue
                agg[k]["count"] += 1
                agg[k]["last"] = max(agg[k]["last"], r.get("timestamp", ""))
    items = [{"kind": k[0], "value": k[1], "count": v["count"], "last": v["last"]} for k, v in agg.items()]
    items.sort(key=lambda i: (-i["count"], i["kind"], i["value"]))
    return {"user": user, "items": items, "decisions_read": n,
            "note": "Read from the decision log (append-only, hash-chained). Suggestions only: nothing here is applied until you add it."}
