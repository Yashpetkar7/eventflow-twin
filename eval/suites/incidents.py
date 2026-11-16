"""Incident and duty-shift suite → eval/results/incidents_<ts>.json (docs/08, decision #128).

Every demo event × every incident type (train fault, rain, heat, crowd surge) at the hour before the event ends, plus
the plain day: the duty shift (POST /shift/next) is worked to its end with every proposal approved.

  incident_deterministic   the same request gives the same run id and the same simulation, twice
  incident_never_easier    an incident never lowers the peak load or the over-threshold station-hours
  shift_figures_match      each proposal's figures equal an independent POST /simulate of the measures in place
  shift_terminates         every shift ends, inside the step limit
  shift_honest_end         "clear" only when nothing is over the line; otherwise the leftover is reported
  shift_no_autonomous_apply  the shift writes nothing to the decision log (a human approves, CLAUDE.md rule 3)
  shift_cleared            share of the shifts with crowding that end with nothing over the line (reported, not gated)
Usage: python -m eval.suites.incidents
"""
from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

os.environ.setdefault("DEMO_MODE", "offline")

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from apps.api.eventflow.agents import planner  # noqa: E402
from apps.api.eventflow.config import events  # noqa: E402
from eval.common import write_result  # noqa: E402

TYPES = [None, "train_fault", "rain", "heat", "crowd_surge"]
LIMIT = 30


def run() -> dict:
    log = Path(tempfile.mkdtemp()) / "decisions.jsonl"
    main.DECISIONS_LOG = log                                # nothing may be written here by a shift
    c = TestClient(main.app)
    rows, fc0 = [], None
    det = easier = match = term = honest = total = crowded = cleared = proposals = 0
    seconds = []
    for ev in events():
        base = {"event_id": ev["id"], "weather": "normal"}
        plain = c.post("/forecast", json=base).json()
        fc0 = fc0 or plain
        hour = max(5, min(23, int(plain["end_used"][:2]) - 1))
        ref0 = {"forecast_run_id": plain["run_id"], "forecast": base, "scope": "corridor", "threshold": 0.85}
        s0 = c.post("/simulate", json=ref0).json()["summary"]
        for kind in TYPES:
            spec = {**base, **({"incident": {"type": kind, "hour": hour}} if kind else {})}
            a, b = c.post("/forecast", json=spec).json(), c.post("/forecast", json=spec).json()
            ref = {"forecast_run_id": a["run_id"], "forecast": spec, "scope": "corridor", "threshold": 0.85}
            s1, s2 = c.post("/simulate", json=ref).json()["summary"], c.post("/simulate", json=ref).json()["summary"]
            total += 1
            det += a["run_id"] == b["run_id"] and s1 == s2 and (kind is None) == (a["run_id"] == plain["run_id"])
            easier += s1["peak_lf"] >= s0["peak_lf"] - 1e-9 and s1["overcap_station_hours"] >= s0["overcap_station_hours"]
            applied, handled, at, ok, n, t0 = [], [], hour if kind else 5, True, 0, time.perf_counter()
            last = None
            for _ in range(LIMIT):
                last = c.post("/shift/next", json={**ref, "applied": applied, "handled": handled, "from_hour": at}).json()
                if last["done"]:
                    break
                n += 1
                handled += [x["key"] for x in last["alerts"]]
                top = next((o for o in last["mission"]["plan"]["options"] if o["rank"] == last["recommended_rank"]), None)
                if top:
                    proposals += 1
                    merged = planner.merge(applied, top["interventions"])
                    check = c.post("/simulate", json={**ref, "interventions": merged}).json()
                    ok = ok and check["summary"] == top["summary"]
                    applied = merged
                at = last["hour"]
            seconds.append(time.perf_counter() - t0)
            match += ok
            term += bool(last and last["done"])
            over = last["residual"]["overcap_station_hours"] if last else None
            honest += bool(last and last["done"] and ((last["reason"] == "clear") == (over == 0)))
            if s1["overcap_station_hours"] > 0:
                crowded += 1
                cleared += over == 0
            rows.append({"event": ev["id"], "incident": kind, "hour": hour if kind else None, "over_before": s1["overcap_station_hours"],
                         "over_after": over, "decisions_asked": n, "end": last["reason"] if last else None})
    metrics = {"incident_deterministic": round(det / total, 4), "incident_never_easier": round(easier / total, 4),
               "shift_figures_match": round(match / total, 4), "shift_terminates": round(term / total, 4),
               "shift_honest_end": round(honest / total, 4), "shift_no_autonomous_apply": float(not log.exists()),
               "shift_cleared": round(cleared / crowded, 4) if crowded else None, "shifts": total, "shifts_with_crowding": crowded,
               "proposals_checked": proposals, "decisions_asked_max": max(r["decisions_asked"] for r in rows),
               "shift_p95_s": round(sorted(seconds)[int(0.95 * (len(seconds) - 1))], 3)}
    p = write_result("incidents", metrics, n=total, split="all", models={"planner": "agent team, code policies (no model)"},
                     dataset_version=fc0["dataset_version"], is_synthetic=fc0["is_synthetic"], rows=rows)
    print(f"incidents suite: {total} shifts, figures match {metrics['shift_figures_match']}, honest end {metrics['shift_honest_end']}, "
          f"cleared {metrics['shift_cleared']} of {crowded} crowded -> {p.name}")
    return metrics


if __name__ == "__main__":
    run()
