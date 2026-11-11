#!/usr/bin/env python
"""Cross-platform task runner (Windows / macOS / Linux). Mirrors the Makefile so every laptop runs
identical commands without needing `make`.

    python tasks.py <task> [extra args...]
    python tasks.py list

Uses the interpreter that runs this file, so activate .venv first (or call .venv's python directly).
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = sys.executable

TASKS: dict[str, tuple[str, list[list[str]]]] = {
    "synth": ("Generate labelled SYNTHETIC demo data", [[PY, "scripts/synth.py"]]),
    "ingest": ("Ingest real data from data/raw -> data/processed", [[PY, "scripts/ingest.py"]]),
    "baseline": ("Backtest seasonal-naive vs LightGBM, write eval/results", [[PY, "scripts/baseline.py"]]),
    "train": ("Same as baseline with the LightGBM model", [[PY, "scripts/baseline.py", "--model", "lgbm"]]),
    "eval-fast": ("Fast backtest (2 folds) + simulator suite", [[PY, "scripts/baseline.py", "--fast"], [PY, "-m", "eval.suites.simulator"]]),
    "eval": ("Full backtest + simulator suite + tests", [
        [PY, "scripts/baseline.py"],
        [PY, "-m", "eval.suites.simulator"],
        [PY, "-m", "pytest", "-q"],
    ]),
    "gate": ("Check latest eval results against eval/thresholds.yaml",
             [[PY, "-m", "eval.gate", "--thresholds", "eval/thresholds.yaml"]]),
    "test": ("Run pytest", [[PY, "-m", "pytest", "-q"]]),
    "api": ("Run FastAPI on :8000", [[PY, "-m", "uvicorn", "apps.api.eventflow.main:app", "--reload", "--port", "8000"]]),
    "web": ("Run Next.js on :3000", [["npm", "run", "dev"]]),
}


def run(name: str, extra: list[str]) -> int:
    if name in ("list", "help", "-h", "--help"):
        width = max(map(len, TASKS))
        for k, (desc, _) in TASKS.items():
            print(f"  {k:<{width}}  {desc}")
        return 0
    if name not in TASKS:
        print(f"unknown task: {name!r}. Try: python tasks.py list", file=sys.stderr)
        return 2
    _, cmds = TASKS[name]
    cwd = ROOT / "apps/web" if name == "web" else ROOT
    env = {**os.environ, "PYTHONPATH": str(ROOT), "PYTHONUTF8": "1"}
    for i, cmd in enumerate(cmds):
        full = cmd + (extra if i == len(cmds) - 1 else [])
        print("$", " ".join(full), flush=True)
        rc = subprocess.call(full, cwd=cwd, env=env, shell=(os.name == "nt" and cmd[0] == "npm"))
        if rc:
            return rc
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) > 1 else "list", sys.argv[2:]))
