"""Write (or compare against) a reference of /agent/plan answers for the 60 gold scenarios and the demo-cache grid.

Used to prove that a refactor of the planner or a new agent engine changes no plan:

    python scripts/plan_reference.py write <file.json>
    python scripts/plan_reference.py check <file.json> [/agent/plan|/agent/run]

Compared: everything in the plan except timings (`trace[].ms`), `cached` and, for /agent/run, the mission envelope.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["DEMO_MODE"] = "live"                      # compute, never replay a cache entry
os.environ.pop("LLM_MODEL", None)                     # the reference is the code path, without a language model

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from apps.api.eventflow.agents import planner  # noqa: E402

GOLD = ROOT / "eval/gold/agents_scenarios.jsonl"


def requests() -> list[tuple[str, dict]]:
    """(id, request body) for every gold scenario and every demo-cache plan."""
    out = []
    for line in GOLD.read_text(encoding="utf-8").splitlines():
        if line.strip():
            g = json.loads(line)
            out.append((g["id"], {"forecast": g["forecast"], "scope": "corridor", "threshold": g["threshold"],
                                  "priority": g["priority"], "locale": "ar" if g["lang"] == "ar" else "en", "goal": g["goal"],
                                  "applied": g.get("applied", [])}))
    for ev in ("gitex2025_d1", "dfw2026_d1", "downtown_night"):
        for weather in ("normal", "hot", "rain"):
            for locale in ("en", "ar"):
                for priority in ("balanced", "cost", "impact"):
                    out.append((f"grid-{ev}-{weather}-{locale}-{priority}", {
                        "forecast": {"event_id": ev, "weather": weather}, "scope": "corridor", "threshold": 0.85,
                        "priority": priority, "locale": locale, "applied": []}))
    return out


def strip(plan: dict) -> dict:
    p = {k: v for k, v in plan.items() if k != "cached"}
    p["trace"] = [{k: v for k, v in e.items() if k != "ms"} for e in p.get("trace", [])]
    return p


def answers(path: str = "/agent/plan") -> dict[str, dict]:
    planner.CACHE_WRITE = Path(tempfile.mkdtemp(prefix="eft_ref_"))
    main.DECISIONS_LOG = planner.CACHE_WRITE / "decisions.jsonl"
    c = TestClient(main.app)
    events = {e["id"] for e in c.get("/events").json()}
    out = {}
    for rid, body in requests():
        if body["forecast"].get("event_id") and body["forecast"]["event_id"] not in events:
            continue
        fc = c.post("/forecast", json=body["forecast"]).json()
        r = c.post(path, json={"forecast_run_id": fc["run_id"], **body})
        assert r.status_code == 200, (rid, r.status_code, r.text[:300])
        d = r.json()
        out[rid] = strip(d["plan"] if path == "/agent/run" else d)
    return out


def main_() -> None:
    mode, file = sys.argv[1], Path(sys.argv[2])
    if mode == "write":
        a = answers()
        file.write_text(json.dumps(a, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        print(f"reference: {len(a)} plans → {file}")
        return
    ref = json.loads(file.read_text(encoding="utf-8"))
    got = answers(sys.argv[3] if len(sys.argv) > 3 else "/agent/plan")
    bad = [k for k in ref if json.dumps(ref[k], sort_keys=True) != json.dumps(got.get(k), sort_keys=True)]
    print(f"{len(ref) - len(bad)}/{len(ref)} plans identical" + (f"; different: {bad[:10]}" if bad else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main_()
