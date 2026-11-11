"""Shared writer for eval results (contract in docs/08 + CLAUDE.md rule 8)."""
from __future__ import annotations

import datetime as dt
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "eval/results"


def git_sha() -> str:
    try:
        sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
        dirty = subprocess.run(["git", "diff", "--quiet"], cwd=ROOT).returncode != 0
        return sha + ("-dirty" if dirty else "")
    except Exception:
        return "nogit"


def write_result(suite: str, metrics: dict, *, n: int, split: str, models: dict, dataset_version: str,
                 is_synthetic: bool, **extra) -> Path:
    now = dt.datetime.now()
    out = {"suite": suite, "git_sha": git_sha(), "timestamp": now.isoformat(timespec="seconds"), "models": models,
           "dataset_version": dataset_version, "is_synthetic": is_synthetic, "metrics": metrics, "n": n,
           "split": split, **extra}
    RESULTS.mkdir(parents=True, exist_ok=True)
    p = RESULTS / f"{suite}_{now:%Y%m%d-%H%M%S}.json"
    p.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return p
