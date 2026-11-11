"""EventFlow Twin API (contract v1, see schemas.py and docs/03_ARCHITECTURE.md).

Every response that carries numbers includes `is_synthetic` and a `source` {tool, run_id}.
/agent/plan is implemented by Stream B; until then it answers 501 with a clear message.
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import threading
import uuid
from collections import OrderedDict
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import ROOT, corridor, events
from .forecast import NoDataError, build_forecast, config_hash, load_panel, make_run_id
from .interventions import InterventionError
from .schemas import (CONTRACT_VERSION, AgentPlanRequest, AgentPlanResponse, DecisionRequest, DecisionResponse,
                      Event, ForecastRequest, ForecastResponse, SimulateRequest, SimulateResponse, Station)
from .simulate import simulate

app = FastAPI(title="EventFlow Twin API", version=CONTRACT_VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["GET", "POST"], allow_headers=["*"])

DECISIONS_LOG = ROOT / "data/processed/decisions_log.jsonl"
DUBAI = ZoneInfo("Asia/Dubai")
_RUNS: "OrderedDict[str, dict]" = OrderedDict()   # forecast runs; deterministic ids so safe to rebuild
_PLANS: dict[str, dict] = {}                       # filled by Stream B's agent endpoint
_LOCK = threading.Lock()
_MAX_RUNS = 256


@app.exception_handler(InterventionError)
async def _bad_intervention(_: Request, exc: InterventionError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(NoDataError)
async def _no_data(_: Request, exc: NoDataError):
    return JSONResponse(status_code=503, content={"detail": str(exc)})


def _remember(run: dict) -> None:
    with _LOCK:
        _RUNS[run["run_id"]] = run
        _RUNS.move_to_end(run["run_id"])
        while len(_RUNS) > _MAX_RUNS:
            _RUNS.popitem(last=False)


def get_run(run_id: str) -> dict:
    run = _RUNS.get(run_id)
    if run is None:
        raise HTTPException(404, f"Unknown forecast_run_id '{run_id}'. POST /forecast again (ids are deterministic).")
    return run


@app.get("/healthz")
def healthz():
    return {"ok": True, "contract": CONTRACT_VERSION}


@app.get("/stations", response_model=list[Station])
def stations():
    return corridor()["stations"]


@app.get("/events", response_model=list[Event])
def list_events():
    return events()


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    try:
        run = build_forecast(req.event_id, req.date, req.weekday, req.attendance, req.end_time)
    except KeyError:
        raise HTTPException(404, f"Unknown event_id '{req.event_id}'")
    except ValueError as e:     # bad date string
        raise HTTPException(422, str(e))
    _remember(run)
    return {**{k: v for k, v in run.items() if k not in ("demand", "event")},
            "source": {"tool": "forecast", "run_id": run["run_id"]}}


def run_simulation(forecast_run_id: str, interventions: list) -> dict:
    """Shared by /simulate, the agent tools and the eval suites."""
    run = get_run(forecast_run_id)
    ivs = [i.model_dump() if hasattr(i, "model_dump") else i for i in interventions]
    base = simulate(run["demand"])
    res = simulate(run["demand"], ivs)
    run_id = make_run_id("sim", {"fc": forecast_run_id, "iv": ivs})
    delta = {k: round(res.summary[k] - base.summary[k], 3) for k in res.summary if k != "bins_per_hour"}
    return {"run_id": run_id, "source_forecast": forecast_run_id, "is_synthetic": run["is_synthetic"],
            "summary": res.summary, "baseline_summary": base.summary, "delta": delta, "effects": res.effects,
            "diverted_off_metro": res.diverted_off_metro, "rows": res.rows, "hourly": res.hourly,
            "source": {"tool": "simulate", "run_id": run_id}}


@app.post("/simulate", response_model=SimulateResponse)
def simulate_ep(req: SimulateRequest):
    return run_simulation(req.forecast_run_id, req.interventions)


@app.post("/agent/plan", response_model=AgentPlanResponse)
def agent_plan(req: AgentPlanRequest):
    get_run(req.forecast_run_id)
    raise HTTPException(501, "Agent planner not implemented yet (Stream B). Use fixtures/agent_plan.json in the UI.")


@app.post("/decisions", response_model=DecisionResponse)
def decisions(req: DecisionRequest):
    """Human-in-the-loop log (CLAUDE.md rule 3). Anonymous labels only; append-only JSONL."""
    ts = dt.datetime.now(DUBAI).isoformat(timespec="seconds")
    rec = {"decision_id": f"dec_{uuid.uuid4().hex[:10]}", "timestamp": ts, **req.model_dump(),
           "plan_known": req.plan_id in _PLANS}
    plan = _PLANS.get(req.plan_id)
    if plan:
        rec["option"] = next((o for o in plan["options"] if o["rank"] == req.option_rank), None)
    DECISIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK, DECISIONS_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return {"logged": True, "decision_id": rec["decision_id"], "timestamp": ts, "plan_known": rec["plan_known"]}


@app.get("/evidence")
def evidence():
    """Latest eval metrics per suite + data provenance + decision count."""
    latest: dict[str, dict] = {}
    for f in sorted(glob.glob(str(ROOT / "eval/results/*.json"))):
        try:
            d = json.loads(Path(f).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        latest[d["suite"]] = {"file": Path(f).name, "timestamp": d.get("timestamp"), "metrics": d.get("metrics", {}),
                              "n": d.get("n"), "split": d.get("split"), "is_synthetic": d.get("is_synthetic"),
                              "dataset_version": d.get("dataset_version")}
    try:
        panel = load_panel()
        data = {"dataset_version": panel.dataset_version, "is_synthetic": panel.is_synthetic, "file": panel.path.name}
    except NoDataError:
        data = {"dataset_version": None, "is_synthetic": None, "file": None}
    n_dec = sum(1 for _ in DECISIONS_LOG.open(encoding="utf-8")) if DECISIONS_LOG.exists() else 0
    return {"eval": latest, "data": {**data, "config_hash": config_hash()}, "decisions_logged": n_dec,
            "contract": CONTRACT_VERSION}
