"""eval/gate.py: compare latest results per suite against thresholds.yaml; exit 1 on breach."""
import argparse, glob, json, os, sys
import yaml

RULES = {  # threshold key -> (suite, metric, comparison)
    "forecast.lgbm_mase_max": ("forecast", "lgbm_mase", "max"),
    "forecast.lgbm_coverage80_min": ("forecast", "lgbm_coverage80", "min"),
    "simulator.property_pass_rate_min": ("simulator", "property_pass_rate", "min"),
    "agents.number_faithfulness_min": ("agents", "number_faithfulness", "min"),
    "agents.schema_validity_min": ("agents", "schema_validity", "min"),
    "agents.expectation_match_min": ("agents", "expectation_match", "min"),
    "agents.top_no_new_hotspot_min": ("agents", "top_no_new_hotspot", "min"),
    "agents.critic_consistent_min": ("agents", "critic_consistent", "min"),
    "agents.trace_complete_min": ("agents", "trace_complete", "min"),
    "safety.disallowed_refusal_rate_min": ("safety", "disallowed_refusal_rate", "min"),
    "safety.allowed_over_refusal_max": ("safety", "allowed_over_refusal", "max"),
    "redteam.attack_success_rate_max": ("redteam", "attack_success_rate", "max"),
    "latency.p95_seconds_max": ("latency", "p95_seconds", "max"),
    # agent team (docs/15, decision #122)
    "orchestration.engines_agree_min": ("orchestration", "engines_agree", "min"),
    "orchestration.events_deterministic_min": ("orchestration", "events_deterministic", "min"),
    "orchestration.trace_complete_min": ("orchestration", "trace_complete", "min"),
    "orchestration.budget_respected_min": ("orchestration", "budget_respected", "min"),
    "orchestration.layers_covered_min": ("orchestration", "layers_covered", "min"),
    "orchestration.mission_p95_seconds_max": ("orchestration", "mission_p95_s", "max"),
    "critic.critic_recall_min": ("critic", "critic_recall", "min"),
    "critic.critic_precision_min": ("critic", "critic_precision", "min"),
    "optimality.goal_coverage_min": ("optimality", "goal_coverage", "min"),
    "optimality.relief_gap_max_max": ("optimality", "relief_gap_max", "max"),
    "optimality.top_score_ratio_mean_min": ("optimality", "top_score_ratio_mean", "min"),
    # incidents and the duty shift (decision #128)
    "incidents.incident_deterministic_min": ("incidents", "incident_deterministic", "min"),
    "incidents.incident_never_easier_min": ("incidents", "incident_never_easier", "min"),
    "incidents.shift_figures_match_min": ("incidents", "shift_figures_match", "min"),
    "incidents.shift_terminates_min": ("incidents", "shift_terminates", "min"),
    "incidents.shift_honest_end_min": ("incidents", "shift_honest_end", "min"),
    "incidents.shift_no_autonomous_apply_min": ("incidents", "shift_no_autonomous_apply", "min"),
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
