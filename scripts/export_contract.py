"""Export API contract v1: OpenAPI schema + fixture JSON for every endpoint (contract/).

The web app builds against these fixtures until the live API is wired in, so front end and back end can be
built in parallel. Fixtures are produced by the REAL code paths (no hand-typed numbers). The agent-plan fixture
is assembled deterministically from real /simulate results and is labelled as a fixture, not agent output. It uses the attendance-40000 what-if of the DFW scenario because at
the assumed 15000 the real (GTFS) timetable shows no crowding, which would make an empty plan.

    python scripts/export_contract.py
    npx -y openapi-typescript@7 contract/openapi.json -o contract/api-types.ts
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from apps.api.eventflow.forecast import make_run_id  # noqa: E402
from apps.api.eventflow.schemas import CONTRACT_VERSION, AgentPlanResponse  # noqa: E402
from apps.api.eventflow.simulate import score  # noqa: E402

OUT = ROOT / "contract"
FIX = OUT / "fixtures"
EXIT = [17, 18, 19]
CANDIDATES = [
    ("Stagger the exit and run a feeder shuttle",
     [{"type": "staggered_exit", "params": {"spread_minutes": 45}},
      {"type": "shuttle_bus", "params": {"from_station": "EMT", "to_station": "BBY", "buses": 10, "hours": EXIT}}]),
    ("Run trains every 3 minutes during the exit peak",
     [{"type": "extra_trains", "params": {"headway_min": 3, "hours": EXIT}}]),
    ("Guide visitors to Financial Centre on foot",
     [{"type": "wayfinding_redirect", "params": {"from_station": "EMT", "to_station": "FIC", "share": 0.3, "hours": EXIT}}]),
]


def dump(name: str, data) -> None:
    (FIX / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def template_rationale(title: str, s: dict, base: dict) -> str:
    return (f"{title}. Simulated over-capacity station-hours go from {base['overcap_station_hours']} to "
            f"{s['overcap_station_hours']}, passengers above the comfort level from {base['excess_pax']} to "
            f"{s['excess_pax']}, and peak load factor from {base['peak_lf']} to {s['peak_lf']}. "
            f"Cost proxy {s['cost_proxy']}. [FIXTURE: deterministic template, not agent output]")


def main_() -> None:
    FIX.mkdir(parents=True, exist_ok=True)
    c = TestClient(main.app)
    (OUT / "openapi.json").write_text(json.dumps(main.app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    dump("stations.json", c.get("/stations").json())
    dump("events.json", c.get("/events").json())
    fc = c.post("/forecast", json={"event_id": "dfw2026_d1"}).json()
    dump("forecast_dfw2026_d1.json", fc)
    dump("simulate_baseline.json", c.post("/simulate", json={"forecast_run_id": fc["run_id"]}).json())
    fc = c.post("/forecast", json={"event_id": "dfw2026_d1", "attendance": 40000}).json()
    dump("forecast_dfw2026_d1_attendance40000.json", fc)
    dump("simulate_baseline_attendance40000.json", c.post("/simulate", json={"forecast_run_id": fc["run_id"]}).json())

    sims = []
    for title, ivs in CANDIDATES:
        r = c.post("/simulate", json={"forecast_run_id": fc["run_id"], "interventions": ivs})
        assert r.status_code == 200, r.text
        sims.append((title, ivs, r.json()))
    dump("simulate_option.json", sims[0][2])

    run = main.get_run(fc["run_id"])
    from apps.api.eventflow.simulate import simulate
    base_res = simulate(run["demand"], weekday=run["weekday"])
    scored = sorted(((score(base_res, simulate(run["demand"], ivs, weekday=run["weekday"])), t, ivs, s)
                     for t, ivs, s in sims),
                    key=lambda x: (-x[0], x[3]["summary"]["overcap_station_hours"]))
    base = sims[0][2]["baseline_summary"]
    options = [{"rank": i, "title": t, "interventions": ivs, "summary": s["summary"], "delta": s["delta"],
                "score": round(sc, 1), "rationale": template_rationale(t, s["summary"], base),
                "sources": [s["source"], fc["source"]]} for i, (sc, t, ivs, s) in enumerate(scored, 1)]
    plan = {"plan_id": make_run_id("plan", {"fc": fc["run_id"], "fixture": True}), "forecast_run_id": fc["run_id"],
            "mode": "offline", "is_synthetic": fc["is_synthetic"], "baseline_summary": base, "options": options,
            "verify": {"numbers_checked": 0, "all_matched": True, "fallback_used": True}}
    AgentPlanResponse.model_validate(plan)        # fixture must satisfy the frozen contract
    dump("agent_plan.json", plan)
    dump("decision_response.json", {"logged": True, "decision_id": "dec_fixture01", "timestamp": "2026-11-18T18:05:00+04:00",
                                    "plan_known": True})
    dump("evidence.json", c.get("/evidence").json())
    (OUT / "VERSION").write_text(CONTRACT_VERSION + "\n", encoding="utf-8")
    print(f"contract {CONTRACT_VERSION}: openapi.json + {len(list(FIX.glob('*.json')))} fixtures in {OUT}")


if __name__ == "__main__":
    main_()
