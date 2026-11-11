#!/usr/bin/env python3
"""Collect verifiable project facts into docs/metrics.md and docs/metrics.json.

Only reports what it can read or run. Missing data is reported as missing, never estimated.
Usage: python scripts/report_metrics.py --repo . --out docs/metrics.md --json docs/metrics.json
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone

EXT_LANG = {".py": "Python", ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript",
            ".jsx": "JavaScript", ".sql": "SQL", ".cypher": "Cypher", ".css": "CSS", ".bicep": "Bicep"}


def sh(cmd: list[str], cwd: str) -> str | None:
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=300, check=False).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None


def latest_results(repo: str) -> dict:
    by_suite: dict[str, str] = {}
    for f in sorted(glob.glob(os.path.join(repo, "eval", "results", "*.json"))):
        suite = os.path.basename(f).rsplit("_", 1)[0]
        by_suite[suite] = f  # sorted ascending, so last wins = latest
    out = {}
    for suite, f in by_suite.items():
        try:
            data = json.load(open(f))
        except (OSError, json.JSONDecodeError):
            continue
        out[suite] = {"file": os.path.relpath(f, repo), "metrics": data.get("metrics", {}), "n": data.get("n"),
                      "split": data.get("split"), "git_sha": data.get("git_sha"), "timestamp": data.get("timestamp")}
    return out


def pytest_count(repo: str) -> int | None:
    out = sh([sys.executable, "-m", "pytest", "--collect-only", "-q"], repo)
    if not out:
        return None
    m = re.search(r"(\d+) tests? collected", out) or re.search(r"(\d+) tests?", out.splitlines()[-1] if out.splitlines() else "")
    return int(m.group(1)) if m else None


def code_stats(repo: str) -> dict:
    files = (sh(["git", "ls-files"], repo) or "").splitlines()
    lines = Counter()
    for f in files:
        lang = EXT_LANG.get(os.path.splitext(f)[1])
        if not lang:
            continue
        try:
            with open(os.path.join(repo, f), errors="ignore") as fh:
                lines[lang] += sum(1 for ln in fh if ln.strip())
        except OSError:
            pass
    log = (sh(["git", "log", "--format=%cI"], repo) or "").split()
    return {"loc_by_language": dict(lines.most_common()), "commits": len(log),
            "first_commit": log[-1] if log else None, "last_commit": log[0] if log else None}


def deployments(repo: str) -> list[str]:
    p = os.path.join(repo, "DEPLOYMENTS.md")
    if not os.path.exists(p):
        return []
    return re.findall(r"https?://[^\s)>\]]+", open(p).read())


def to_markdown(facts: dict) -> str:
    rows = ["| Suite | Metric | Value | n | Split | Source |", "|---|---|---|---|---|---|"]
    for suite, r in facts["eval"].items():
        for k, v in r["metrics"].items():
            val = f"{v:.3f}" if isinstance(v, float) else str(v)
            rows.append(f"| {suite} | {k} | {val} | {r['n'] or 'n/a'} | {r['split'] or 'n/a'} | `{r['file']}` |")
    if len(rows) == 2:
        rows.append("| (none) | no eval results found | | | | |")
    tests = facts["tests"]["pytest"]
    code = facts["code"]
    parts = [
        f"<!-- generated {facts['generated_at']} by report_metrics.py; do not edit by hand -->",
        "### Evaluation results", "", *rows, "",
        "### Engineering facts", "",
        f"- Backend tests collected: {tests if tests is not None else 'not available'}",
        f"- Commits: {code['commits']} ({code['first_commit'] or 'n/a'} to {code['last_commit'] or 'n/a'})",
        "- Non-blank lines of code: " + (", ".join(f"{k} {v:,}" for k, v in code["loc_by_language"].items()) or "n/a"),
    ]
    if facts["deployments"]:
        parts.append("- Live: " + ", ".join(facts["deployments"]))
    return "\n".join(parts) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--out", default="docs/metrics.md")
    ap.add_argument("--json", default="docs/metrics.json")
    ap.add_argument("--skip-tests", action="store_true")
    a = ap.parse_args()
    repo = os.path.abspath(a.repo)
    facts = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "eval": latest_results(repo),
        "tests": {"pytest": None if a.skip_tests else pytest_count(repo)},
        "code": code_stats(repo),
        "deployments": deployments(repo),
    }
    for path, content in ((a.out, to_markdown(facts)), (a.json, json.dumps(facts, indent=2))):
        full = os.path.join(repo, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as fh:
            fh.write(content)
    print(to_markdown(facts))


if __name__ == "__main__":
    main()
