"""EventFlow Twin API (contract v1, see schemas.py and docs/03_ARCHITECTURE.md).

Every response that carries numbers includes `is_synthetic` and a `source` {tool, run_id}.
/agent/plan runs the deterministic planner pipeline (agents/planner.py); numbers only ever come from /simulate.
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import logging
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
from .forecast import NoDataError, build_from_spec, config_hash, load_panel, make_run_id
from .interventions import InterventionError, validate_interventions
from .ratelimit import RateLimit
from .road import road_pressure
from .schemas import (CONTRACT_VERSION, AgentPlanRequest, AgentPlanResponse, AgentRunRequest, AskRequest, AskResponse, MessageRequest, MessageResponse, Mission, Roster, WatchRequest, WatchResponse, BreakpointRequest, BreakpointResponse, DecisionList, DecisionRequest, DecisionResponse,
                      Event, ForecastRequest, ForecastResponse, ShiftRequest, ShiftStep, SimulateRequest, SimulateResponse, Station)
from .simulate import simulate

app = FastAPI(title="EventFlow Twin API", version=CONTRACT_VERSION)
# The web app runs on the same machine (any local port: dev 3000, booth build, test builds). Nothing remote is allowed.
app.add_middleware(CORSMiddleware, allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
                   allow_methods=["GET", "POST"], allow_headers=["*"])

# Public demo only: EVENTFLOW_RATE_LIMIT = POST requests per minute per client (unset on the laptop: no limit).
_LIMIT = RateLimit(int(os.environ["EVENTFLOW_RATE_LIMIT"])) if os.environ.get("EVENTFLOW_RATE_LIMIT") else None


_LOG = logging.getLogger("eventflow.access")      # one JSON line per request: id, path, status, milliseconds
if (os.environ.get("VERCEL") or os.environ.get("EVENTFLOW_ACCESS_LOG")) and not _LOG.handlers:
    _LOG.addHandler(logging.StreamHandler())        # hosted: lines reach the platform's log; on the laptop set EVENTFLOW_ACCESS_LOG=1
    _LOG.setLevel(logging.INFO)

SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
                    "Cache-Control": "no-store"}


@app.middleware("http")
async def _rate_limit(request: Request, call_next):
    if _LIMIT is not None and request.method == "POST":
        # Vercel overwrites X-Forwarded-For (no client spoofing) and also sends x-vercel-forwarded-for, which survives
        # a proxy in front of Vercel; locally neither is set and the socket address is used.
        fwd = (request.headers.get("x-vercel-forwarded-for") or request.headers.get("x-forwarded-for")
               or (request.client.host if request.client else "unknown"))
        if not _LIMIT.allow(fwd.split(",")[0].strip(), time.monotonic()):
            return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again in a minute."},
                                headers={"Retry-After": "60", **SECURITY_HEADERS})
    # One id and one timing per request, so a slow or failed call can be found in the logs (and in the browser's
    # network panel) without any external tracing service. A caller's own id is kept if it is a plain token.
    rid = request.headers.get("x-request-id", "")
    rid = rid if rid and len(rid) <= 64 and rid.replace("-", "").replace("_", "").isalnum() else uuid.uuid4().hex[:16]
    t0 = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - t0) * 1000
    response.headers.update(SECURITY_HEADERS)
    response.headers["X-Request-ID"] = rid
    response.headers["Server-Timing"] = f"app;dur={ms:.1f}"
    _LOG.info(json.dumps({"rid": rid, "method": request.method, "path": request.url.path, "status": response.status_code,
                          "ms": round(ms, 1)}))
    return response

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
        return build_from_spec(req.model_dump())
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
    from .agents.engine import available_engine
    return {"ok": True, "contract": CONTRACT_VERSION, "storage": os.environ.get("EVENTFLOW_STORAGE", "persistent"),
            "engine": available_engine()}


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
    return {**{k: v for k, v in run.items() if k not in ("demand", "service")},
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
    base = simulate(run["demand"], weekday=run["weekday"], threshold=threshold, report=report, service=run.get("service"))
    res = simulate(run["demand"], ivs, weekday=run["weekday"], threshold=threshold, report=report, service=run.get("service"))
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
            "road": road_pressure(run, ivs, res.effects), "baseline_road": road_pressure(run, [], []),
            "source": {"tool": "simulate", "run_id": run_id}}


@app.post("/simulate", response_model=SimulateResponse)
def simulate_ep(req: SimulateRequest):
    get_run(req.forecast_run_id, req.forecast)          # rebuild first if this instance has never seen the run
    return run_simulation(req.forecast_run_id, req.interventions, req.detail, req.threshold, req.scope)


@app.post("/breakpoint", response_model=BreakpointResponse)
def breakpoint_ep(req: BreakpointRequest):
    """At what crowd size does each corridor station cross the comfort threshold (exact; see breakpoint.py)?"""
    from .breakpoint import break_points
    return break_points(get_run(req.forecast_run_id, req.forecast), req.threshold, corridor_ids())


@app.post("/agent/plan", response_model=AgentPlanResponse)
def agent_plan(req: AgentPlanRequest):
    """Plan → simulate each candidate → rank → explain → verify every number. See agents/planner.py."""
    from .agents.planner import make_plan
    run = get_run(req.forecast_run_id, req.forecast)
    plan = make_plan(run, req, run_simulation)
    with _LOCK:
        _PLANS[plan["plan_id"]] = plan
    return plan


@app.post("/agent/run", response_model=Mission)
def agent_run(req: AgentRunRequest):
    """The agent team on one planning request (docs/15): intake → forecast → diagnosis → four specialists in parallel →
    composer → simulation → critic ⟲ supervisor → ranker → explainer ∥ stress test → verifier → human approval.
    `plan` has the /agent/plan shape; every number in it and in `events` comes from the simulator."""
    from .agents.engine import run_mission
    run = get_run(req.forecast_run_id, req.forecast)
    mission = run_mission(run, req, run_simulation)
    with _LOCK:
        _PLANS[mission["plan"]["plan_id"]] = mission["plan"]
    return mission


@app.get("/agent/roster", response_model=Roster)
def agent_roster():
    """Who is on the team, in which layer, which can call a model, and the orchestration graph (from the code)."""
    from .agents.engine import roster
    return roster()


@app.post("/watch/scan", response_model=WatchResponse)
def watch_scan(req: WatchRequest):
    """The Watcher (standing agent): every alert of the scenario day, raised `horizon_h` hours before a station crosses
    the threshold, in one answer (the screen follows the clock without polling)."""
    from .agents.standing import watch
    get_run(req.forecast_run_id, req.forecast)
    base = run_simulation(req.forecast_run_id, req.applied, False, req.threshold, req.scope)
    return watch(get_run(req.forecast_run_id), base, req.horizon_h)


@app.post("/shift/next", response_model=ShiftStep)
def shift_next(req: ShiftRequest):
    """The duty shift on autopilot, one step (agents/shift.py): the clock runs to the Watcher's next alert, the team
    plans on top of what is already approved, and the step stops for a human. Nothing is applied here."""
    from .agents.engine import run_mission
    from .agents.shift import next_step
    run = get_run(req.forecast_run_id, req.forecast)
    plan_req = AgentRunRequest(forecast_run_id=req.forecast_run_id, forecast=req.forecast, threshold=req.threshold, scope=req.scope,
                               applied=req.applied, locale=req.locale)
    step = next_step(run, req, run_simulation, lambda: run_mission(run, plan_req, run_simulation))
    if step["mission"]:
        with _LOCK:
            _PLANS[step["mission"]["plan"]["plan_id"]] = step["mission"]["plan"]
    return step


@app.post("/agent/message", response_model=MessageResponse)
def agent_message(req: MessageRequest):
    """The Messenger (standing agent): passenger notice, signage line and operations briefing for an approved option,
    in English and Arabic, from figures re-simulated here. Drafts only: nothing is sent anywhere."""
    from .agents.agents_util import message_for
    return message_for(req, get_run(req.forecast_run_id, req.forecast), run_simulation)


@app.post("/agent/ask", response_model=AskResponse)
def agent_ask(req: AskRequest):
    """Ask the twin (standing agent): a chip or a question is routed to one tool; the answer's figures come from that
    tool with its run id. Anything outside the corridor's crowding is refused."""
    from .agents.agents_util import ask_for
    return ask_for(req, get_run(req.forecast_run_id, req.forecast), run_simulation)


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
