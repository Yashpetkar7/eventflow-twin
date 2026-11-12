"""EventFlow Twin API (contract v1, see schemas.py and docs/03_ARCHITECTURE.md).

Every response that carries numbers includes `is_synthetic` and a `source` {tool, run_id}.
/agent/plan runs the deterministic planner pipeline (agents/planner.py); numbers only ever come from /simulate.
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import os
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import ROOT, corridor, events
from .forecast import NoDataError, build_forecast, config_hash, load_panel, make_run_id
from .interventions import InterventionError, validate_interventions
from .ratelimit import RateLimit
from .schemas import (CONTRACT_VERSION, AgentPlanRequest, AgentPlanResponse, DecisionList, DecisionRequest, DecisionResponse,
                      Event, ForecastRequest, ForecastResponse, SimulateRequest, SimulateResponse, Station)
from .simulate import simulate

app = FastAPI(title="EventFlow Twin API", version=CONTRACT_VERSION)
# The web app runs on the same machine (any local port: dev 3000, booth build, test builds). Nothing remote is allowed.
app.add_middleware(CORSMiddleware, allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
                   allow_methods=["GET", "POST"], allow_headers=["*"])

# Public demo only: EVENTFLOW_RATE_LIMIT = POST requests per minute per client (unset on the laptop: no limit).
_LIMIT = RateLimit(int(os.environ["EVENTFLOW_RATE_LIMIT"])) if os.environ.get("EVENTFLOW_RATE_LIMIT") else None


@app.middleware("http")
async def _rate_limit(request: Request, call_next):
    if _LIMIT is not None and request.method == "POST":
        fwd = request.headers.get("x-forwarded-for") or (request.client.host if request.client else "unknown")
        if not _LIMIT.allow(fwd.split(",")[0].strip(), time.monotonic()):
            return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again in a minute."})
    return await call_next(request)

# Writable state. Laptop / booth: <repo>/data (kept between runs). Serverless: a temp directory per instance —
# set EVENTFLOW_DATA_DIR=/tmp/eventflow and EVENTFLOW_STORAGE=ephemeral so the UI can say decisions are not kept.
DATA_DIR = Path(os.environ.get("EVENTFLOW_DATA_DIR") or ROOT / "data")
DECISIONS_LOG = DATA_DIR / "processed/decisions_log.jsonl"
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


def build_run(req: ForecastRequest) -> dict:
    """One place that turns a forecast request into a run (shared by /forecast and cold-instance rebuilds)."""
    try:
        return build_forecast(req.event_id, req.date, req.weekday, req.attendance, req.end_time,
                              weather=req.weather, exit_sigma_min=req.exit_sigma_min,
                              custom=req.custom_event.model_dump() if req.custom_event else None)
    except KeyError as e:
        raise HTTPException(404, f"Unknown event or station {e}")
    except ValueError as e:     # bad date string
        raise HTTPException(422, str(e))


def get_run(run_id: str, spec: ForecastRequest | None = None) -> dict:
    """The forecast run for `run_id`. Run ids are deterministic hashes of the request, so an instance that has
    never seen the run rebuilds it from `spec` and checks that it hashes to the same id (serverless hosting)."""
    run = _RUNS.get(run_id)
    if run is None and spec is not None:
        run = build_run(spec)
        if run["run_id"] != run_id:
            raise HTTPException(409, f"forecast does not match forecast_run_id '{run_id}' (it produces '{run['run_id']}')")
        _remember(run)
    if run is None:
        raise HTTPException(404, f"Unknown forecast_run_id '{run_id}'. Send `forecast` with the request, or POST /forecast again.")
    return run


@app.get("/healthz")
def healthz():
    return {"ok": True, "contract": CONTRACT_VERSION, "storage": os.environ.get("EVENTFLOW_STORAGE", "persistent")}


@app.get("/stations", response_model=list[Station])
def stations():
    return corridor()["stations"]


@app.get("/events", response_model=list[Event])
def list_events():
    return events()


@app.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest):
    run = build_run(req)
    _remember(run)
    return {**{k: v for k, v in run.items() if k != "demand"},
            "source": {"tool": "forecast", "run_id": run["run_id"]}}


def corridor_ids() -> list[str]:
    return [s["id"] for s in corridor()["stations"] if s.get("in_corridor")]


def run_simulation(forecast_run_id: str, interventions: list, detail: bool = False,
                   threshold: float | None = None, scope: str = "network") -> dict:
    """Shared by /simulate, the agent tools and the eval suites."""
    run = get_run(forecast_run_id)
    # canonical form (validated, defaults filled, fixed order) so the same plan always gets the same run id
    ivs = [i.model_dump() for i in validate_interventions(list(interventions))]
    report = corridor_ids() if scope == "corridor" else None
    base = simulate(run["demand"], weekday=run["weekday"], threshold=threshold, report=report)
    res = simulate(run["demand"], ivs, weekday=run["weekday"], threshold=threshold, report=report)
    key = {"fc": forecast_run_id, "iv": ivs}
    if threshold is not None:
        key["thr"] = threshold
    if scope != "network":
        key["scope"] = scope
    run_id = make_run_id("sim", key)
    delta = {k: round(res.summary[k] - base.summary[k], 3) for k in res.summary if k != "bins_per_hour"}
    return {"run_id": run_id, "source_forecast": forecast_run_id, "is_synthetic": run["is_synthetic"],
            "summary": res.summary, "baseline_summary": base.summary, "delta": delta, "effects": res.effects,
            "diverted_off_metro": res.diverted_off_metro, "rows": res.rows if detail else [], "hourly": res.hourly,
            "source": {"tool": "simulate", "run_id": run_id}}


@app.post("/simulate", response_model=SimulateResponse)
def simulate_ep(req: SimulateRequest):
    get_run(req.forecast_run_id, req.forecast)          # rebuild first if this instance has never seen the run
    return run_simulation(req.forecast_run_id, req.interventions, req.detail, req.threshold, req.scope)


@app.post("/agent/plan", response_model=AgentPlanResponse)
def agent_plan(req: AgentPlanRequest):
    """Plan → simulate each candidate → rank → explain → verify every number. See agents/planner.py."""
    from .agents.planner import make_plan
    run = get_run(req.forecast_run_id, req.forecast)
    plan = make_plan(run, req, run_simulation)
    with _LOCK:
        _PLANS[plan["plan_id"]] = plan
    return plan


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


@app.get("/decisions", response_model=DecisionList)
def list_decisions(limit: int = 100):
    """Audit trail of human decisions, newest first."""
    records = []
    if DECISIONS_LOG.exists():
        for line in DECISIONS_LOG.read_text(encoding="utf-8").splitlines():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue                       # a torn line must not hide the rest of the log
    limit = max(1, min(limit, 500))
    return {"total": len(records), "approved": sum(r.get("decision") == "approve" for r in records),
            "rejected": sum(r.get("decision") == "reject" for r in records), "items": records[::-1][:limit]}


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
