"""Booth mode in one command: API (DEMO_MODE=offline) + production web build, then print the kiosk URL.

    python tasks.py demo          (Ctrl+C stops both)
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps/web"
NPM = shutil.which("npm") or "npm"


def wait(url: str, seconds: int) -> bool:
    for _ in range(seconds * 2):
        try:
            with urllib.request.urlopen(url, timeout=2):
                return True
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    return False


def main() -> int:
    env = {**os.environ, "DEMO_MODE": "offline", "PYTHONPATH": str(ROOT), "PYTHONUTF8": "1"}
    if not (WEB / "public/geo/corridor_scene.json").exists():
        print("3D scene missing: run `python tasks.py osm` (once, online) and `python tasks.py scene`.", file=sys.stderr)
        return 2
    api = subprocess.Popen([sys.executable, "-m", "uvicorn", "apps.api.eventflow.main:app", "--port", "8000"], cwd=ROOT, env=env)
    web = None
    try:
        if not wait("http://localhost:8000/healthz", 30):
            print("API did not start", file=sys.stderr)
            return 1
        subprocess.check_call([NPM, "run", "snapshot"], cwd=WEB, env=env)        # API-down fallback, from the live API
        subprocess.check_call([NPM, "run", "build"], cwd=WEB, env=env)
        web = subprocess.Popen([NPM, "run", "start"], cwd=WEB, env=env)
        if not wait("http://localhost:3000", 60):
            print("web app did not start", file=sys.stderr)
            return 1
        print("\n  EventFlow Twin is running offline.\n  Kiosk:    http://localhost:3000/?kiosk=1\n  Arabic:   http://localhost:3000/?kiosk=1&lang=ar\n  Desktop:  http://localhost:3000/\n  Ctrl+C to stop.\n", flush=True)
        web.wait()
    except KeyboardInterrupt:
        pass
    finally:
        for p in (web, api):
            if p and p.poll() is None:
                p.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
