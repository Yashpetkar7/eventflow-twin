"""Load check → eval/results/latency_<ts>.json (the `latency` rule of eval/gate.py).

Sends a realistic mix of requests to a running API from several clients at once: the kiosk's own sequence
(forecast → simulate → agent plan → break point) across the events, weather and crowd sizes. Reports throughput,
error rate and latency percentiles overall and per endpoint. `p95_seconds` is the agent plan's 95th percentile,
the slowest thing a visitor waits for.

    python scripts/load_test.py [http://localhost:8000] [--clients 8] [--rounds 12]
Start the API with DEMO_MODE=live to measure the planner itself rather than the offline cache replay.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from eval.common import write_result  # noqa: E402


def call(base: str, path: str, body: dict | None = None) -> tuple[int, float, dict | None]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"}, method="POST" if data else "GET")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read())
            return r.status, time.perf_counter() - t0, out
    except urllib.error.HTTPError as e:
        return e.code, time.perf_counter() - t0, None
    except Exception:
        return 0, time.perf_counter() - t0, None


def pct(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * len(xs)))], 4) if xs else 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", default="http://localhost:8000")
    ap.add_argument("--clients", type=int, default=8)
    ap.add_argument("--rounds", type=int, default=12)
    a = ap.parse_args()
    base = a.base.rstrip("/")
    status, _, events = call(base, "/events")
    if status != 200 or not events:
        raise SystemExit(f"API not reachable at {base}")
    health = call(base, "/healthz")[2] or {}
    specs = [{"event_id": e["id"], "weather": w, **({"attendance": int(e["attendance"] * m)} if m != 1 else {})}
             for e in events for w in ("normal", "hot", "rain") for m in (1, 1.5, 2)]

    def visitor(k: int) -> list[tuple[str, int, float]]:
        out = []
        for r in range(a.rounds):
            spec = specs[(k * 7 + r * 3) % len(specs)]
            s, t, fc = call(base, "/forecast", spec)
            out.append(("/forecast", s, t))
            if not fc:
                continue
            common = {"forecast_run_id": fc["run_id"], "forecast": spec}
            for path, body in (("/simulate", {**common, "scope": "corridor", "detail": True}),
                               ("/agent/plan", {**common, "scope": "corridor", "locale": "ar" if (k + r) % 2 else "en",
                                                "priority": ("balanced", "cost", "impact")[(k + r) % 3]}),
                               ("/breakpoint", common)):
                s, t, _ = call(base, path, body)
                out.append((path, s, t))
        return out

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=a.clients) as ex:
        rows = [x for part in ex.map(visitor, range(a.clients)) for x in part]
    wall = time.perf_counter() - t0
    by: dict[str, list[float]] = {}
    for path, _, t in rows:
        by.setdefault(path, []).append(t)
    errors = [r for r in rows if r[1] != 200]
    plan = by.get("/agent/plan", [])
    metrics = {"p95_seconds": pct(plan, 0.95), "plan_p50_seconds": round(statistics.median(plan), 4) if plan else None,
               "requests": len(rows), "errors": len(errors), "error_rate": round(len(errors) / len(rows), 4),
               "requests_per_second": round(len(rows) / wall, 1), "clients": a.clients, "wall_seconds": round(wall, 2),
               "by_endpoint": {p: {"n": len(v), "p50_s": pct(v, 0.5), "p95_s": pct(v, 0.95), "max_s": round(max(v), 4)} for p, v in sorted(by.items())},
               "error_statuses": sorted({r[1] for r in errors})}
    fc0 = call(base, "/forecast", specs[0])[2] or {}
    p = write_result("latency", metrics, n=len(rows), split="load", models={"planner": "as served", "target": base},
                     dataset_version=fc0.get("dataset_version", "?"), is_synthetic=bool(fc0.get("is_synthetic", True)),
                     contract=health.get("contract"), storage=health.get("storage"))
    print(f"load check: {len(rows)} requests from {a.clients} clients in {wall:.1f} s ({metrics['requests_per_second']}/s), "
          f"{len(errors)} errors, plan p95 {metrics['p95_seconds']} s -> {p.name}")


if __name__ == "__main__":
    main()
