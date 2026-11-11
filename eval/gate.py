"""eval/gate.py: compare latest results per suite against thresholds.yaml; exit 1 on breach."""
import argparse, glob, json, os, sys
import yaml

RULES = {  # threshold key -> (suite, metric, comparison)
    "forecast.lgbm_mase_max": ("forecast", "lgbm_mase", "max"),
    "forecast.lgbm_coverage80_min": ("forecast", "lgbm_coverage80", "min"),
    "simulator.property_pass_rate_min": ("simulator", "property_pass_rate", "min"),
    "agents.number_faithfulness_min": ("agents", "number_faithfulness", "min"),
    "agents.schema_validity_min": ("agents", "schema_validity", "min"),
    "safety.disallowed_refusal_rate_min": ("safety", "disallowed_refusal_rate", "min"),
    "safety.allowed_over_refusal_max": ("safety", "allowed_over_refusal", "max"),
    "redteam.attack_success_rate_max": ("redteam", "attack_success_rate", "max"),
    "latency.p95_seconds_max": ("latency", "p95_seconds", "max"),
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def latest(suite):
    files = sorted(glob.glob(os.path.join(ROOT, "eval", "results", f"{suite}_*.json")))
    return json.load(open(files[-1], encoding="utf-8")) if files else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--thresholds", default="eval/thresholds.yaml")
    ap.add_argument("--summary", default=None)
    a = ap.parse_args()
    th = yaml.safe_load(open(a.thresholds, encoding="utf-8"))
    required = set(th.get("required_suites", []))
    rows, failed = [], False
    for key, (suite, metric, kind) in RULES.items():
        section, name = key.split(".")
        if section not in th or name not in th[section]:
            continue
        limit = th[section][name]
        res = latest(suite)
        if res is None or metric not in res.get("metrics", {}):
            # A required suite with no result is a failure, not a pass: "no evidence" must never look green.
            status = "FAIL (missing)" if suite in required else "SKIP"
            failed |= suite in required
            rows.append((key, "missing", limit, status)); continue
        val = res["metrics"][metric]
        ok = val >= limit if kind == "min" else val <= limit
        failed |= not ok
        rows.append((key, f"{val:.3f}", limit, "PASS" if ok else "FAIL"))
    table = "| check | value | limit | status |\n|---|---|---|---|\n" + "\n".join(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |" for r in rows)
    print(table)
    if a.summary:
        with open(a.summary, "a", encoding="utf-8") as f: f.write("## Eval gate\n\n" + table + "\n")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
