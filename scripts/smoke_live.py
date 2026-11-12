"""End-to-end check of a deployed EventFlow Twin (standard library only).

    python scripts/smoke_live.py https://<deployment>.vercel.app
    python scripts/smoke_live.py http://localhost:3300          # `vercel dev --local`

Walks the demo flow through the public API exactly as a cold serverless instance sees it: forecast → simulate
(sending the forecast spec) → agent plan → re-simulate the top option → log a decision. Also checks the web page
and robots.txt. Exits non-zero on the first failure."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request


def fetch(url: str, body: dict | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "eventflow-smoke/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def call(base: str, path: str, body: dict | None = None) -> dict:
    status, data = fetch(base + path, body)
    if status != 200:
        raise SystemExit(f"FAIL {path}: HTTP {status} {data[:300]!r}")
    return json.loads(data)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    site = sys.argv[1].rstrip("/")
    api = site + "/api"
    status, page = fetch(site + "/")
    assert status == 200 and b"EventFlow Twin" in page, f"web page: HTTP {status}"
    status, robots = fetch(site + "/robots.txt")
    assert status == 200 and b"Disallow: /" in robots, "robots.txt must keep the demo out of search engines"
    health = call(api, "/healthz")
    assert health["ok"], health
    events = call(api, "/events")
    spec = {"event_id": events[0]["id"], "weather": "hot"}
    fc = call(api, "/forecast", spec)
    sim = call(api, "/simulate", {"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor", "detail": True})
    assert len(sim["hourly"]) == 6 * 24 and sim["source"]["tool"] == "simulate", "simulate shape"
    plan = call(api, "/agent/plan", {"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor"})
    assert plan["verify"]["all_matched"], "number verification failed"
    if plan["options"]:
        top = plan["options"][0]
        after = call(api, "/simulate", {"forecast_run_id": fc["run_id"], "forecast": spec, "scope": "corridor",
                                        "interventions": top["interventions"]})
        assert after["summary"] == top["summary"], "plan numbers differ from a fresh simulation"
        dec = call(api, "/decisions", {"plan_id": plan["plan_id"], "option_rank": 1, "decision": "reject",
                                       "user": "smoke-test", "option_title": top["title"], "forecast_run_id": fc["run_id"]})
        assert dec["logged"], dec
    print(f"OK {site}: contract {health['contract']}, storage {health.get('storage')}, {len(events)} events, "
          f"{len(plan['options'])} plan options, numbers verified, is_synthetic={fc['is_synthetic']}")


if __name__ == "__main__":
    main()
