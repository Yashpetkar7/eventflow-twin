"""Booth pre-flight: everything the offline demo needs, checked before anything starts.

    python tasks.py doctor        (also runs first inside `python tasks.py demo`)

Exit code 0 = ready, 1 = a blocking problem (printed with the fix). Warnings never block.
Why it exists: on 16 Nov the booth laptop had no LangGraph installed, so the agent team silently ran its fallback
engine instead of the graph (decision row in docs/09). Nothing here needs the internet or an API key.
"""
from __future__ import annotations

import importlib.metadata as md
import os
import re
import shutil
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps/web"


def pinned(req: Path = ROOT / "requirements.txt") -> dict[str, str]:
    """Package → exact version for every `name==version` line of requirements.txt."""
    out = {}
    for line in req.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_.\-\[\]]+)==([^\s#;]+)", line)
        if m:
            out[re.sub(r"\[.*\]", "", m.group(1))] = m.group(2)
    return out


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def checks(ports: bool = True) -> tuple[list[str], list[str]]:
    """(blocking problems, warnings), each a sentence with the fix."""
    bad: list[str] = []
    warn: list[str] = []
    if sys.version_info < (3, 11):
        bad.append(f"Python {sys.version.split()[0]} is too old: use 3.11 or 3.12 (.venv).")
    for name, want in pinned().items():
        try:
            have = md.version(name)
        except md.PackageNotFoundError:
            bad.append(f"{name} is not installed: run `pip install -r requirements.txt` in .venv.")
            continue
        if have != want:
            (bad if name in ("langgraph", "fastapi", "pydantic", "lightgbm") else warn).append(
                f"{name} {have} installed, requirements.txt pins {want}: run `pip install -r requirements.txt`.")
    sys.path.insert(0, str(ROOT))
    try:
        from apps.api.eventflow.agents import engine
        engine._graph.cache_clear()
        want, have = engine.wanted_engine(), engine.available_engine()
        if want == "graph" and have != "graph":
            bad.append("The agent team would run its fallback engine, not LangGraph: run `pip install -r requirements.txt`.")
    except Exception as e:  # noqa: BLE001 - any import failure blocks the booth
        bad.append(f"The API code does not import ({type(e).__name__}: {e}).")
    mode = os.environ.get("DEMO_MODE", "offline")
    if mode != "offline":
        warn.append(f"DEMO_MODE={mode} in this shell; the booth forces offline anyway.")
    need = {
        "data/synthetic/station_hour_synthetic.parquet": "run `python tasks.py synth`",
        "apps/web/public/geo/corridor_scene.json": "run `python tasks.py scene` (after `python tasks.py osm`, once, online)",
        "apps/web/node_modules": "run `npm install` in apps/web (online, once)",
        "config/corridor.yaml": "the repository is incomplete: pull again",
    }
    for rel, fix in need.items():
        if not (ROOT / rel).exists():
            bad.append(f"{rel} is missing: {fix}.")
    if not list((ROOT / "data/demo_cache").glob("plan_*.json")):
        warn.append("data/demo_cache has no plans yet; `python tasks.py demo` builds them first.")
    if shutil.which("npm") is None:
        bad.append("npm is not on PATH: install Node.js 20 or newer.")
    if ports:
        for p in (8000, 3000):
            if not port_free(p):
                bad.append(f"Port {p} is already in use: stop the other server (an earlier demo or `npm run dev`).")
    return bad, warn


def main() -> int:
    bad, warn = checks(ports="--no-ports" not in sys.argv)
    for w in warn:
        print(f"  warn  {w}")
    for b in bad:
        print(f"  FAIL  {b}")
    print("Pre-flight: ready for the booth." if not bad else f"Pre-flight: {len(bad)} blocking problem(s).")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
