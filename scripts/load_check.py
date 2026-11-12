"""Load and abuse check for the public demo (or the booth laptop).

    python scripts/load_check.py https://eventflow-twin.vercel.app        → eval/results/load_<YYYYMMDD-HHMM>.json

Three phases, all light enough to run against our own site (≈ 200 requests in under a minute):
  A  page and static API reads, 30 at once × 3 rounds         → latency p50 / p95, errors
  B  20 visitors at once, each forecast → AI plan (2 POSTs)     → latency of the real work, errors
  C  70 POSTs in a row from one client                          → the courtesy rate limit answers 429 (per instance)
  D  abuse: 25 interventions in one request, a 2,000-char note  → refused with 422, nothing simulated
Only uses the public API; no keys. Do not point it at someone else's site.
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import json
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UA = {"user-agent": "eventflow-load-check/1.0", "content-type": "application/json"}


def fetch(url: str, body: dict | None = None, timeout: float = 60) -> tuple[int, float, bytes]:
    data = json.dumps(body).encode() if body is not None else None
    t0 = time.perf_counter()
    raw = b""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=UA), timeout=timeout) as r:
            raw = r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:                                        # noqa: BLE001 — timeouts and resets count as errors
        code = 0
    return code, time.perf_counter() - t0, raw


def call(url: str, body: dict | None = None, timeout: float = 60) -> tuple[int, float]:
    code, t, _ = fetch(url, body, timeout)
    return code, t


def stats(rows: list[tuple[int, float]]) -> dict:
    lat = sorted(t for _, t in rows)
    codes: dict[str, int] = {}
    for c, _ in rows:
        codes[str(c)] = codes.get(str(c), 0) + 1
    q = lambda p: round(lat[min(len(lat) - 1, int(p * len(lat)))], 3) if lat else None   # noqa: E731
    return {"n": len(rows), "codes": codes, "p50_s": q(0.5), "p95_s": q(0.95), "max_s": round(lat[-1], 3) if lat else None,
            "mean_s": round(statistics.mean(lat), 3) if lat else None}


def visitor(api: str, i: int) -> list[tuple[int, float]]:
    spec = {"event_id": ["gitex2025_d1", "dfw2026_d1", "downtown_night"][i % 3], "weather": ["normal", "hot", "rain"][i % 3]}
    code, t, raw = fetch(f"{api}/forecast", spec)
    out = [(code, t)]
    if code == 200:
        out.append(call(f"{api}/agent/plan", {"forecast_run_id": json.loads(raw)["run_id"], "forecast": spec, "scope": "corridor"}))
    return out


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
    api = base + "/api" if not base.endswith(":8000") else base
    res: dict = {"target": base}
    with cf.ThreadPoolExecutor(30) as ex:
        reads = []
        for _ in range(3):
            reads += list(ex.map(lambda u: call(u), [base + "/"] * 10 + [api + "/healthz"] * 10 + [api + "/events"] * 10))
        res["A_reads_30_concurrent"] = stats(reads)
    with cf.ThreadPoolExecutor(20) as ex:
        flows = [r for rows in ex.map(lambda i: visitor(api, i), range(20)) for r in rows]
    res["B_visitor_flows_20_concurrent"] = stats(flows)
    burst = [call(f"{api}/forecast", {"event_id": "gitex2025_d1"}) for _ in range(70)]
    res["C_rate_limit_70_in_a_row"] = stats(burst) | {"first_429_at": next((i + 1 for i, (c, _) in enumerate(burst) if c == 429), None)}
    time.sleep(1)
    iv = {"type": "robotaxi_staging", "params": {"station": "WTC", "vehicles": 10, "hours": [15]}}
    abuse = [call(f"{api}/simulate", {"forecast_run_id": "fc_x", "interventions": [iv] * 25}),
             call(f"{api}/agent/plan", {"forecast_run_id": "fc_x", "notes": "x" * 2000})]
    res["D_abuse_refused"] = {"codes": [c for c, _ in abuse], "expected": [422, 422]}
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    rep = {"suite": "load_check", "git_sha": sha, "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
           "models": None, "dataset_version": None, "metrics": res, "n": sum(v.get("n", 0) for v in res.values() if isinstance(v, dict)),
           "split": "live"}
    out = ROOT / f"eval/results/load_{dt.datetime.now():%Y%m%d-%H%M}.json"
    out.write_text(json.dumps(rep, indent=1), encoding="utf-8")
    print(json.dumps(res, indent=1))
    print("→", out.relative_to(ROOT))
    errors = sum(v["codes"].get("0", 0) + sum(n for c, n in v["codes"].items() if c.startswith("5"))
                 for k, v in res.items() if k[0] in "AB")
    return 0 if errors == 0 and res["D_abuse_refused"]["codes"] == [422, 422] else 1


if __name__ == "__main__":
    sys.exit(main())
