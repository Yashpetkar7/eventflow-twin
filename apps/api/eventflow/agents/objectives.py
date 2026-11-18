"""Seven objectives over the plans a mission simulated (decision #148).

A read-only view: it never changes the team's recommendation or the ranking that produced it. Given the plans the
mission tested (the options it offered and the ones it rejected), it

  1. removes any plan that breaks a hard constraint (a new hotspot, worse overall, or a constraint the planner set):
     no weight can buy those back;
  2. reads each objective's value from the simulator's output or from the plan's own parameters. An objective the
     twin cannot measure (emissions) is shown as "not measured" and is never scored;
  3. marks the Pareto set (plans no other plan beats on every measured objective);
  4. orders the rest by a transparent weighted sum for the chosen lens.

Every value comes from a simulation run that is named in the row (CLAUDE.md rule 2).
"""
from __future__ import annotations

from functools import lru_cache

import yaml

from ..config import ROOT, corridor
from . import planner
from .knowledge import parties

OBJECTIVES = ["safety", "crowd", "wait", "cost", "accessibility", "emissions", "resources"]
HARD = {"C2": "new_hotspot", "C3": "worse_overall", "C6": "planner_constraint"}


@lru_cache(maxsize=1)
def settings() -> dict:
    return yaml.safe_load((ROOT / "config/assistant.yaml").read_text(encoding="utf-8"))


def _walk_minutes(a: str | None, b: str | None) -> float:
    from ..travel import _km, settings as travel
    st = {s["id"]: s for s in corridor()["stations"]}
    if a not in st or b not in st:
        return 0.0
    return _km(st[a], st[b]) / float(travel()["walk_kmh"]) * 60


def redirect_walk(interventions: list[dict]) -> float:
    """Extra walking a plan asks of riders: share of riders sent to another station × the minutes it takes to walk there."""
    return round(sum(float(i["params"].get("share", 0)) * _walk_minutes(i["params"].get("from_station"), i["params"].get("to_station"))
                     for i in interventions if i.get("type") == "wayfinding_redirect"), 2)


def quantities(interventions: list[dict]) -> dict:
    """What a plan asks for, counted from its own parameters (no unit is invented)."""
    q = {"buses": 0, "vehicles": 0, "train_hours": 0, "metered_station_hours": 0}
    for i in interventions:
        p, hours = i.get("params", {}), len(i.get("params", {}).get("hours") or [])
        if i["type"] == "shuttle_bus":
            q["buses"] += int(p.get("buses", 0))
        elif i["type"] == "robotaxi_staging":
            q["vehicles"] += int(p.get("vehicles", 0))
        elif i["type"] in ("extra_trains", "extended_hours"):
            q["train_hours"] += hours
        elif i["type"] == "station_metering":
            q["metered_station_hours"] += hours
    return q


def candidates(mission: dict, locale: str = "en", applied_sig: str | None = None) -> list[dict]:
    """Every plan the mission simulated, with what the checks said about it."""
    plan = mission["plan"]
    base = plan["baseline_summary"]
    assess = {a["rank"]: a for a in mission.get("assessments", [])}
    verified = bool(plan.get("verify", {}).get("all_matched"))
    out = []
    for o in plan["options"]:
        a = assess.get(o["rank"], {})
        failed = [c["id"] for c in a.get("checks", []) if c.get("passed") is False]
        out.append({"id": f"option-{o['rank']}", "rank": o["rank"], "title": o["title"], "interventions": o["interventions"],
                    "summary": o["summary"], "cost_added": o["cost_added"], "failed": failed, "offered": True, "verified": verified,
                    "run_id": (o.get("sources") or [{}])[0].get("run_id"), "holds": a.get("holds"), "stress_total": a.get("total"),
                    "goal_met": bool(o.get("goal_met")), "reason": None})
    for n, r in enumerate(mission.get("rejected", []), 1):
        if not r.get("summary"):
            continue                                              # dropped before it was simulated (out of bounds)
        try:
            title = planner.bundle_title(r["interventions"], locale)
        except Exception:
            title = r.get("label") or f"plan {n}"
        out.append({"id": f"tested-{n}", "rank": None, "title": title, "interventions": r["interventions"], "summary": r["summary"],
                    "cost_added": round(r["summary"]["cost_proxy"] - base["cost_proxy"], 3), "failed": list(r.get("criteria") or []),
                    "offered": False, "verified": False, "run_id": r.get("run_id"), "holds": None, "stress_total": None,
                    "goal_met": "C1" not in (r.get("criteria") or []), "reason": r.get("reason")})
    for c in out:
        c["approved"] = applied_sig is not None and planner._sig(c["interventions"]) == applied_sig
    return out


def values(c: dict) -> dict:
    s = c["summary"]
    return {"safety": round(s["peak_lf"], 4), "crowd": round(s["excess_pax"], 1), "wait": round(s["max_wait_min"], 1),
            "cost": round(c["cost_added"], 2), "accessibility": redirect_walk(c["interventions"]), "emissions": None,
            "resources": len(parties(c["interventions"]))}


def compare(mission: dict, lens: str = "balanced", weights: dict | None = None, locale: str = "en", applied_sig: str | None = None,
            offered_only: bool = False) -> dict:
    """The plans under one lens. `weights` (objective → non-negative number) overrides the lens's own."""
    cfg = settings()
    lens = lens if lens in cfg["lenses"] else "balanced"
    raw = {k: float(v) for k, v in (weights or cfg["lenses"][lens]).items() if k in OBJECTIVES and float(v) > 0}
    measured = [o for o in OBJECTIVES if cfg["objectives"][o]["basis"] != "not_measured"]
    ignored = sorted(set(raw) - set(measured))
    used = {k: v for k, v in raw.items() if k in measured} or {k: 1.0 for k in measured}
    total = sum(used.values())
    used = {k: round(v / total, 4) for k, v in used.items()}

    rows = []
    for c in candidates(mission, locale, applied_sig):
        if offered_only and not c["offered"]:
            continue
        blocked = [HARD[f] for f in c["failed"] if f in HARD]
        rows.append({"id": c["id"], "rank": c["rank"], "title": c["title"], "offered": c["offered"], "eligible": not blocked,
                     "blocked_by": blocked, "goal_met": c["goal_met"], "values": values(c), "run_id": c["run_id"],
                     "parties": parties(c["interventions"]), "quantities": quantities(c["interventions"]),
                     "holds": c["holds"], "stress_total": c["stress_total"], "failed_checks": c["failed"],
                     "lifecycle": "approved" if c["approved"] else "validated" if (c["offered"] and c["verified"] and not blocked) else "simulated",
                     "interventions": c["interventions"], "pareto": False, "score": None, "parts": {}})
    ok = [r for r in rows if r["eligible"]]
    span = {o: (min(r["values"][o] for r in ok), max(r["values"][o] for r in ok)) for o in measured} if ok else {}
    for r in ok:                                                  # every measured objective: lower is better
        r["parts"] = {o: round(1.0 if span[o][1] == span[o][0] else 1 - (r["values"][o] - span[o][0]) / (span[o][1] - span[o][0]), 4)
                      for o in measured}
        r["score"] = round(sum(used.get(o, 0.0) * r["parts"][o] for o in measured), 4)
    for r in ok:
        r["pareto"] = not any(all(o2["values"][m] <= r["values"][m] for m in measured) and any(o2["values"][m] < r["values"][m] for m in measured)
                              for o2 in ok if o2 is not r)
    rows.sort(key=lambda r: (not r["eligible"], -(r["score"] or 0.0), not r["offered"], r["values"]["cost"], r["id"]))
    top = next((r for r in rows if r["eligible"]), None)
    rec = mission.get("recommended_rank")
    return {"lens": lens, "weights": used, "ignored": ignored, "measured": measured,
            "objectives": [{"id": o, **cfg["objectives"][o]} for o in OBJECTIVES],
            "rows": rows, "top": top["id"] if top else None, "recommended_rank": rec,
            "same_as_recommended": bool(top and top["rank"] is not None and top["rank"] == rec),
            "considered": len(rows), "blocked": sum(1 for r in rows if not r["eligible"]),
            "note": "A view over plans the mission simulated. It does not change the team's recommendation. Executed is never set: "
                    "the twin applies plans inside the simulation only."}
