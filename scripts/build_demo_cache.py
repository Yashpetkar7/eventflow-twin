"""Pre-build the offline agent cache (data/demo_cache/) for the demo scenarios × weather × locale, so the booth
replays identical plans with DEMO_MODE=offline. Deterministic: safe to run any time; old entries are replaced.

    python scripts/build_demo_cache.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["DEMO_MODE"] = "live"          # recompute instead of replaying an old cache entry

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from apps.api.eventflow.agents import planner  # noqa: E402


def run() -> None:
    c = TestClient(main.app)
    n = 0
    for ev in c.get("/events").json():
        for weather in ("normal", "hot", "rain"):
            fc = c.post("/forecast", json={"event_id": ev["id"], "weather": weather}).json()
            for locale in ("en", "ar"):
                for priority in ("balanced", "cost", "impact"):
                    r = c.post("/agent/plan", json={"forecast_run_id": fc["run_id"], "locale": locale, "threshold": 0.85,
                                                    "scope": "corridor", "priority": priority, "applied": []})
                    assert r.status_code == 200, r.text
                    assert r.json()["verify"]["all_matched"], "number verification failed"
                    n += 1
    print(f"demo cache: {n} plans in {planner.CACHE}")


if __name__ == "__main__":
    run()
