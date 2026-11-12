"""Set up a booth laptop (the primary or the backup "laptop B") in one command, then prove it works offline.

    python3 scripts/setup_booth_laptop.py            # macOS / Linux   (Windows: py scripts\\setup_booth_laptop.py)
    python3 scripts/setup_booth_laptop.py --check    # skip installing; only run the offline self-check

Run it at home, online, once (installs take ~10 minutes). It:
  1. creates .venv and installs requirements.txt; installs the web app's packages (npm ci)
  2. generates the labelled synthetic data if data/synthetic is empty
  3. builds the offline agent cache (data/demo_cache) and the production web build
  4. self-check, as at the booth: starts the API (DEMO_MODE=offline) and the production web server, then checks the
     health endpoint, the three events, one AI plan with verified numbers, and the kiosk page — and prints OK / FAIL.
Then turn Wi-Fi off and run `python tasks.py demo` to confirm it still starts (docs/BOOTH_RUNBOOK.md).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps/web"
WIN = os.name == "nt"
VPY = ROOT / (".venv/Scripts/python.exe" if WIN else ".venv/bin/python")
NPM = shutil.which("npm") or "npm"
API_PORT, WEB_PORT = 8000, 3000


def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


def run(cmd: list, cwd: Path = ROOT, env: dict | None = None) -> None:
    print("   $", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def get(url: str, body: dict | None = None, timeout: float = 60) -> dict | str:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8", "replace")
    return json.loads(raw) if r.headers.get_content_type() == "application/json" else raw


def wait(url: str, seconds: int) -> bool:
    t0 = time.time()
    while time.time() - t0 < seconds:
        try:
            get(url, timeout=3)
            return True
        except Exception:
            time.sleep(1)
    return False


def install() -> None:
    if sys.version_info < (3, 11):
        sys.exit("Python 3.11 or newer is needed (python.org).")
    if not shutil.which("node"):
        sys.exit("Node.js 20 or newer is needed (nodejs.org).")
    step("Python environment (.venv) and packages")
    if not VPY.exists():
        run([sys.executable, "-m", "venv", ".venv"])
    run([VPY, "-m", "pip", "install", "-q", "--upgrade", "pip"])
    run([VPY, "-m", "pip", "install", "-q", "-r", "requirements.txt"])
    step("Web app packages")
    run([NPM, "ci" if (WEB / "package-lock.json").exists() else "install"], cwd=WEB)
    if not any((ROOT / "data/synthetic").glob("*")):
        step("Labelled synthetic data")
        run([VPY, "tasks.py", "synth"])
    step("Offline agent cache")
    run([VPY, "tasks.py", "cache"])
    step("Production web build")
    run([NPM, "run", "build"], cwd=WEB, env={**os.environ, "NEXT_TELEMETRY_DISABLED": "1"})


def check() -> bool:
    step("Self-check, offline mode")
    API = f"http://localhost:{API_PORT}"
    env = {**os.environ, "DEMO_MODE": "offline", "NEXT_TELEMETRY_DISABLED": "1"}
    env.pop("OPENAI_API_KEY", None)
    env.pop("ANTHROPIC_API_KEY", None)
    api = subprocess.Popen([VPY, "-m", "uvicorn", "apps.api.eventflow.main:app", "--port", str(API_PORT)], cwd=ROOT, env=env)
    web = subprocess.Popen([NPM, "run", "start", "--", "-p", str(WEB_PORT)], cwd=WEB, env=env, shell=WIN)
    ok = True
    try:
        assert wait(f"{API}/healthz", 60), f"API did not start on :{API_PORT} (is another program using the port?)"
        h = get(f"{API}/healthz")
        print(f"   API ok, contract {h['contract']}")
        events = get(f"{API}/events")
        assert len(events) >= 3, f"expected 3 events, got {len(events)}"
        spec = {"event_id": "gitex2025_d1", "weather": "hot"}
        fc = get(f"{API}/forecast", spec)
        plan = get(f"{API}/agent/plan", {"forecast_run_id": fc["run_id"], "forecast": spec})
        assert plan["options"] and plan["verify"]["all_matched"], "AI plan missing or numbers not verified"
        print(f"   AI plan ok: {len(plan['options'])} options, numbers verified, mode {plan['mode']}")
        assert wait(f"http://localhost:{WEB_PORT}/", 90), f"web app did not start on :{WEB_PORT}"
        page = get(f"http://localhost:{WEB_PORT}/?kiosk=1")
        assert "EventFlow" in page, "kiosk page did not render"
        print(f"   kiosk page ok: http://localhost:{WEB_PORT}/?kiosk=1")
    except Exception as e:                                   # noqa: BLE001 — report any failure plainly
        ok = False
        print(f"\nFAIL: {e}")
    finally:
        for p in (web, api):
            p.terminate()
        for p in (web, api):
            try:
                p.wait(10)
            except subprocess.TimeoutExpired:
                p.kill()
    print("\nOK — this laptop is ready. Next: Wi-Fi off, `python tasks.py demo`, Chrome in kiosk mode (docs/BOOTH_RUNBOOK.md)."
          if ok else "\nNot ready — fix the error above, then run with --check again.")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description="Set up and check a booth laptop.")
    ap.add_argument("--check", action="store_true", help="only run the offline self-check")
    ap.add_argument("--api-port", type=int, default=8000)
    ap.add_argument("--web-port", type=int, default=3000)
    a = ap.parse_args()
    global API_PORT, WEB_PORT
    API_PORT, WEB_PORT = a.api_port, a.web_port
    if not a.check:
        install()
    return 0 if check() else 1


if __name__ == "__main__":
    sys.exit(main())
