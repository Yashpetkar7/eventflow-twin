"""Smoke test run inside the API image with no network (CI `docker` job, decision #134).

    docker run --rm --network none eventflow-api python scripts/image_smoke.py
"""
from __future__ import annotations

import sys

from fastapi.testclient import TestClient

from apps.api.eventflow.main import app


def main() -> int:
    c = TestClient(app)
    h = c.get("/healthz").json()
    assert h["ok"] and h["engine"] == "graph", h
    spec = {"event_id": "downtown_night"}
    fc = c.post("/forecast", json=spec).json()
    m = c.post("/agent/run", json={"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor"}).json()
    assert m["status"] == "awaiting_human" and m["plan"]["verify"]["all_matched"], m.get("status")
    ch = c.post("/chain/start", json={"forecast": spec}).json()
    assert ch["status"] == "awaiting_human", ch.get("status")
    print(f"image OK: contract {h['contract']}, engine {m['engine']}, {len(m['events'])} agent events, chain {len(ch['events'])} events")
    return 0


if __name__ == "__main__":
    sys.exit(main())
