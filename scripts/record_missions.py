"""Record the agent team's language-model answers for the demo scenarios (docs/15), so the booth and the public site
replay real model runs offline. Only the model's words are stored (data/demo_cache/llm/); every simulation, check and
figure is recomputed when a mission is replayed.

    python tasks.py record-missions                    # needs OPENAI_API_KEY (or ANTHROPIC_API_KEY) in .env
    python scripts/record_missions.py --model gpt-5 --fast gpt-5-mini --only gitex2025_d1

Writes eval/results/live/missions_<ts>.json: time, model calls and tokens per mission and per agent. The key is read
from .env and never printed or stored.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load_env() -> None:
    """KEY=value lines from .env into the environment (values never printed)."""
    f = ROOT / ".env"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def check_models(models: list[str]) -> None:
    """Every model id must be one the key can use (verified with the provider, not guessed)."""
    from apps.api.eventflow.agents.llm import provider_for
    if all(provider_for(m) == "openai" for m in models):
        import openai
        have = {m.id for m in openai.OpenAI().models.list()}
        missing = [m for m in models if m not in have]
        if missing:
            near = sorted(x for x in have if x.startswith("gpt-5"))[:12]
            raise SystemExit(f"model id(s) not available to this key: {missing}. GPT-5 family on this key: {near}")


def main_() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None, help="LLM_MODEL (explainer, intake fallback); default from .env or gpt-5")
    ap.add_argument("--fast", default=None, help="LLM_MODEL_FAST (intake, specialists); default from .env or the main model")
    ap.add_argument("--only", default=None, help="comma-separated event ids")
    ap.add_argument("--priorities", default="balanced")
    a = ap.parse_args()
    load_env()
    if not (os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")):
        raise SystemExit("No OPENAI_API_KEY (or ANTHROPIC_API_KEY) in .env: nothing recorded.")
    os.environ["LLM_MODEL"] = a.model or os.environ.get("LLM_MODEL") or "gpt-5"
    if a.fast or os.environ.get("LLM_MODEL_FAST"):
        os.environ["LLM_MODEL_FAST"] = a.fast or os.environ["LLM_MODEL_FAST"]
    check_models(sorted({os.environ["LLM_MODEL"], os.environ.get("LLM_MODEL_FAST") or os.environ["LLM_MODEL"]}))
    os.environ.update({"DEMO_MODE": "live", "RECORD_AGENTS": "1"})

    from fastapi.testclient import TestClient
    from apps.api.eventflow import main
    from eval.common import RESULTS, git_sha

    c = TestClient(main.app)
    events = [e["id"] for e in c.get("/events").json()]
    if a.only:
        events = [e for e in events if e in a.only.split(",")]
    rows = []
    for ev in events:
        for weather in ("normal", "hot", "rain"):
            spec = {"event_id": ev, "weather": weather}
            fc = c.post("/forecast", json=spec).json()
            for priority in a.priorities.split(","):
                for locale in ("en", "ar"):                    # Arabic re-uses the English proposals (same prompts)
                    body = {"forecast_run_id": fc["run_id"], "forecast": spec, "locale": locale, "threshold": 0.85,
                            "scope": "corridor", "priority": priority, "applied": []}
                    t0 = time.perf_counter()
                    r = c.post("/agent/run", json=body)
                    dt_ = round(time.perf_counter() - t0, 1)
                    if r.status_code != 200:
                        print(f"{ev} {weather} {priority} {locale}: HTTP {r.status_code}")
                        continue
                    m = r.json()
                    per = {}
                    for e in m["events"]:
                        if e.get("llm"):
                            d = per.setdefault(e["agent"], {"calls": 0, "tokens": 0, "ms": 0})
                            d["calls"] += 1
                            d["tokens"] += e["llm"].get("tokens") or 0
                            d["ms"] += e["llm"].get("ms") or 0
                    rows.append({"event": ev, "weather": weather, "priority": priority, "locale": locale, "seconds": dt_,
                                 "status": m["status"], "model_calls": m["budget"]["model_calls"], "tokens": m["budget"]["tokens"],
                                 "recording": m["recording"], "per_agent": per, "options": len(m["plan"]["options"]),
                                 "all_matched": m["plan"]["verify"]["all_matched"]})
                    print(f"{ev:16} {weather:6} {priority:8} {locale}: {dt_:5.1f} s, {m['budget']['model_calls']} model calls, "
                          f"{m['budget']['tokens']} tokens, {m['status']}, numbers verified: {m['plan']['verify']['all_matched']}")
    out = RESULTS / "live"
    out.mkdir(parents=True, exist_ok=True)
    p = out / f"missions_{time.strftime('%Y%m%d-%H%M%S')}.json"
    secs = sorted(r["seconds"] for r in rows if r["model_calls"])
    p.write_text(json.dumps({"suite": "missions_recorded", "git_sha": git_sha(), "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                             "models": {"main": os.environ["LLM_MODEL"], "fast": os.environ.get("LLM_MODEL_FAST") or os.environ["LLM_MODEL"]},
                             "metrics": {"missions": len(rows), "p50_s": secs[len(secs) // 2] if secs else None,
                                         "p95_s": secs[min(len(secs) - 1, int(0.95 * len(secs)))] if secs else None,
                                         "tokens_total": sum(r["tokens"] for r in rows),
                                         "all_numbers_verified": all(r["all_matched"] for r in rows)},
                             "n": len(rows), "split": "demo scenarios", "rows": rows}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"recorded {len(rows)} missions → data/demo_cache/llm/ ; summary {p.relative_to(ROOT)}")


if __name__ == "__main__":
    main_()
