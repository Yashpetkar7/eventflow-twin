"""Confidence and evidence, graded in separate parts (decision #149). No language model writes any of it and there is
no single percentage: each part is computed from the forecast, the checks or the evaluation files, and the overall
grade is the weakest part.

    forecast     how wide the demand band is at the hotspot hour, and how the forecaster did in its last backtest
    evidence     where the inputs come from: synthetic or real demand, official timetable, assumed attendance
    robustness   how a plan held in the stress test and in the critic's checks
    validation   whether every number shown matched the simulator, and the simulator's own property checks
    execution    whether the agents finished within budget, and whether a model or code rules wrote the words

A mission that ran to the end is not the same as a recommendation that is right: with synthetic demand the evidence
part is "low" and so is the overall grade, whatever the other parts say.
"""
from __future__ import annotations

import glob
import json
from pathlib import Path

from ..config import ROOT
from .objectives import settings

ORDER = ["unknown", "low", "medium", "high"]


def latest_eval(suite: str) -> dict | None:
    """The newest result file of an eval suite (CLAUDE.md rule 8), or None when there is none."""
    files = sorted(glob.glob(str(ROOT / f"eval/results/{suite}_*.json")))
    for f in reversed(files):
        try:
            d = json.loads(Path(f).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        return {"file": Path(f).name, "metrics": d.get("metrics", {}), "n": d.get("n"), "split": d.get("split"),
                "is_synthetic": d.get("is_synthetic"), "dataset_version": d.get("dataset_version"), "models": d.get("models")}
    return None


def weakest(levels: list[str]) -> str:
    known = [x for x in levels if x in ORDER and x != "unknown"]
    return min(known, key=ORDER.index) if known else "unknown"


def forecast_part(run: dict, base: dict) -> dict:
    cfg = settings()["confidence"]
    hot = max(base["hourly"], key=lambda r: r["peak_lf"])
    row = next((r for r in run["rows"] if r["station_id"] == hot["station_id"] and r["hour"] == hot["hour"]), None)
    band = None
    if row and row["entries_p50"] > 0:
        band = round((row["entries_p90"] - row["entries_p10"]) / row["entries_p50"], 3)
    level = "unknown" if band is None else "high" if band <= cfg["band_high"] else "medium" if band <= cfg["band_medium"] else "low"
    bt = latest_eval("forecast")
    m = (bt or {}).get("metrics", {})
    return {"level": level, "station": hot["station_id"], "hour": hot["hour"], "band": band,
            "p10": row and round(row["entries_p10"]), "p50": row and round(row["entries_p50"]), "p90": row and round(row["entries_p90"]),
            "band_from": "synthetic days" if run["is_synthetic"] else "observed days",
            "backtest": bt and {"file": bt["file"], "mase": m.get("lgbm_mase"), "naive_mase": m.get("naive_mase"),
                                "coverage80": m.get("lgbm_coverage80"), "n": bt["n"], "data": "synthetic" if run["is_synthetic"] else "real",
                                "note": "backtest of the offline LightGBM forecaster; the forecast on screen is a weekday profile plus an event model"},
            "run_id": run["run_id"]}


def evidence_part(run: dict) -> dict:
    items = [
        {"what": "demand", "quality": "low" if run["is_synthetic"] else "high",
         "detail": "synthetic" if run["is_synthetic"] else "observed", "dataset_version": run.get("dataset_version"),
         "level_calibrated": run.get("demand_level") == "real_totals"},
        {"what": "timetable", "quality": "medium", "detail": "official RTA GTFS feed, service dates 2021", "source": "rta_gtfs"},
        {"what": "attendance", "quality": "low" if run.get("event_is_assumption") else "medium",
         "detail": "assumption" if run.get("event_is_assumption") else "stated", "value": run.get("attendance_used")},
        {"what": "capacity_factors", "quality": "low", "detail": "train capacity and boardable share are assumptions", "source": "model.capacity"},
    ]
    return {"level": weakest([i["quality"] for i in items]), "items": items, "is_synthetic": run["is_synthetic"]}


def robustness_part(mission: dict | None, rank: int | None) -> dict:
    if not mission or rank is None:
        return {"level": "unknown", "rank": rank}
    cfg = settings()["confidence"]
    a = next((x for x in mission.get("assessments", []) if x["rank"] == rank), None)
    if not a:
        return {"level": "unknown", "rank": rank}
    checks = [c for c in a["checks"] if c.get("passed") is not None]
    failed = [c["id"] for c in checks if not c["passed"]]
    share = (a["holds"] / a["total"]) if a.get("total") else None
    level = "unknown" if share is None else "high" if share >= cfg["stress_high"] else "medium" if share >= cfg["stress_medium"] else "low"
    hard = [c for c in failed if c in ("C1", "C2", "C3", "C6")]
    if hard and level != "unknown":
        level = "low"
    return {"level": level, "rank": rank, "holds": a.get("holds"), "total": a.get("total"), "checks_passed": len(checks) - len(failed),
            "checks_applicable": len(checks), "failed": failed,
            "stress_runs": [s["run_id"] for s in a.get("stress", []) if s.get("run_id")][:8]}


def validation_part(mission: dict | None) -> dict:
    sim = latest_eval("simulator")
    props = (sim or {}).get("metrics", {}).get("property_pass_rate")
    v = (mission or {}).get("plan", {}).get("verify")
    if not v:
        level = "high" if props == 1.0 else "unknown"
        return {"level": level, "numbers_checked": None, "all_matched": None, "simulator_properties": props, "file": sim and sim["file"]}
    level = "high" if v["all_matched"] and props == 1.0 else "medium" if v["all_matched"] else "low"
    return {"level": level, "numbers_checked": v["numbers_checked"], "all_matched": v["all_matched"], "simulator_properties": props,
            "file": sim and sim["file"]}


def execution_part(mission: dict | None) -> dict:
    if not mission:
        return {"level": "unknown"}
    b, rec = mission.get("budget", {}), mission.get("recording", {})
    stop = mission.get("stop_reason")
    level = "low" if b.get("exceeded") else "high" if stop in ("goal_met", "no_hotspot", "classic") else "medium"
    return {"level": level, "engine": mission.get("engine"), "stop_reason": stop, "exceeded": b.get("exceeded", []),
            "steps": b.get("steps"), "simulations": b.get("simulations"), "model_calls": b.get("model_calls"),
            "words_by": rec.get("mode", "code"), "model": rec.get("model")}


def report(run: dict, base: dict, mission: dict | None = None, rank: int | None = None) -> dict:
    """The five parts and the overall grade (the weakest part that could be graded)."""
    parts = {"forecast": forecast_part(run, base), "evidence": evidence_part(run), "robustness": robustness_part(mission, rank),
             "validation": validation_part(mission), "execution": execution_part(mission)}
    levels = {k: v["level"] for k, v in parts.items()}
    overall = weakest(list(levels.values()))
    limiting = sorted(k for k, v in levels.items() if v == overall)
    return {"overall": overall, "limiting": limiting, "levels": levels, **parts,
            "note": "Grades, not probabilities. The overall grade is the weakest part; 'unknown' parts are left out of it."}
