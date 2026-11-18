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
from .schemas import (CONTRACT_VERSION, ChatRequest, ChatResponse, KnowledgeSources, ScenarioCompareRequest, ScenarioCompareResponse, EventImport, EventImportResult, EventRegistration, Inbox, RegisteredEvent, RiderNotice, TravelAdvice, TravelRequest, ChainDecideRequest, ChainStartRequest, ChainState, LoginRequest, RegisterRequest, AgentPlanRequest, AgentPlanResponse, AgentRunRequest, BriefRequest, BriefResponse, ChainAnswerRequest, ChainChangeRequest, FeedbackRequest, FeedbackResponse, MemoryResponse, AskRequest, AskResponse, MessageRequest, MessageResponse, Mission, Roster, WatchRequest, WatchResponse, BreakpointRequest, BreakpointResponse, DecisionList, DecisionRequest, DecisionResponse,
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


@app.post("/agent/brief", response_model=BriefResponse)
def agent_brief(req: BriefRequest):
    """The planner's brief (1.16.0, decision #144): plain words → an event and constraints for the planner to confirm.
    Read by the Intake agent's model when one is available (live or recorded), else by the word rules in
    config/brief.yaml; both pass the same code checks. A proposal only: nothing is applied or simulated here."""
    from .agents.brief import read_brief
    return read_brief(req.text, req.locale)


@app.post("/agent/feedback", response_model=FeedbackResponse)
def agent_feedback(req: FeedbackRequest):
    """A rejection's reason (1.16.0, decision #145) → the constraints and priority for the next round. Reason chips
    map to typed constraints; the planner's own words go through the brief reader (word rules, or the Intake model
    with its quote check). Only what the planner could set by hand can change; nothing is applied or simulated here."""
    from .agents.loop import read_feedback
    return read_feedback(req)


@app.get("/memory", response_model=MemoryResponse)
def agent_memory(user: str = "visitor", days: int = 1):
    """What the decision log remembers about this planner's rejections (today by default): measures they ruled out,
    stations they protected, cost or relief. Suggestions only (1.16.0)."""
    from .agents.loop import memory
    import re as _re
    if not _re.fullmatch(r"[\w .\-]{1,40}", user):
        raise HTTPException(422, "user: an anonymous label (letters, digits, space, . _ -)")
    return memory(DECISIONS_LOG, user, dt.datetime.now(DUBAI).date(), max(1, min(days, 30)))


@app.post("/agent/run", response_model=Mission)
def agent_run(req: AgentRunRequest):
    """The agent team on one planning request (docs/15): intake → forecast → diagnosis → four specialists in parallel →
    composer → simulation → critic ⟲ supervisor → ranker → explainer ∥ stress test → verifier → human approval.
    `plan` has the /agent/plan shape; every number in it and in `events` comes from the simulator."""
    from .agents.engine import run_mission
    from .tracing import export_mission
    run = get_run(req.forecast_run_id, req.forecast)
    t0 = time.time_ns()
    mission = run_mission(run, req, run_simulation)
    with _LOCK:
        _PLANS[mission["plan"]["plan_id"]] = mission["plan"]
    export_mission(mission, t0)                       # only when OTEL_EXPORTER_OTLP_ENDPOINT is set (WP4)
    return mission


@app.post("/agent/run/stream")
def agent_run_stream(req: AgentRunRequest):
    """The same mission as POST /agent/run, streamed as Server-Sent Events while the agents work: one `agent` event per
    agent event (in the final order, the moment it is logged), then one `mission` event with the whole answer (the
    /agent/run shape), or `error`. Nothing is paced or replayed: what arrives is what has happened."""
    import queue
    from fastapi.responses import StreamingResponse
    from .agents.engine import run_mission
    run = get_run(req.forecast_run_id, req.forecast)
    q: "queue.Queue[tuple[str, object]]" = queue.Queue()

    def work() -> None:
        try:
            m = run_mission(run, req, run_simulation, on_event=lambda e: q.put(("agent", e)))
            with _LOCK:
                _PLANS[m["plan"]["plan_id"]] = m["plan"]
            q.put(("mission", Mission.model_validate(m).model_dump(mode="json")))
        except Exception as ex:  # noqa: BLE001 - reported to the client, never swallowed
            _LOG.exception("stream mission failed")
            q.put(("error", {"detail": f"{type(ex).__name__}: {ex}"[:300]}))
        q.put(("end", None))

    def sse():
        threading.Thread(target=work, daemon=True).start()
        while True:
            kind, data = q.get()
            if kind == "end":
                return
            yield f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"
    return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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


def _chat_run(spec: dict) -> dict:
    """A forecast run for the assistant, with the request that rebuilds it attached (never stored on the cached run)."""
    m = ForecastRequest(**spec)
    return {**get_run(forecast(m)["run_id"], m), "_spec": m.model_dump()}


@app.post("/agent/chat", response_model=ChatResponse)
def agent_chat(req: ChatRequest, request: Request = None):  # type: ignore[assignment]
    """The assistant (docs/18_ASSISTANT.md): one turn of a conversation about the scenario on screen.

    A question is routed to ONE tool path (a simulation, the agent team, the documents); the answer is keys and
    parameters with the run or the document behind every statement. `audience: "kiosk"` gets visitor answers only.
    A planner's instruction ("attendance to 60,000, exit window 45 minutes") comes back as `patch`: the new scenario,
    already forecast and simulated here, for the client to make the state on screen. The API keeps no conversation:
    send `context` back on the next turn. With EVENTFLOW_AUTH=on the planner audience needs a signed-in user."""
    from .agents import assistant
    from .agents.engine import run_mission
    from .agents.personas import ask_route_model
    if req.audience == "planner" and request is not None:
        from .auth import require_role
        require_role(request, "viewer")
    run = {**get_run(req.forecast_run_id, req.forecast), "_spec": req.forecast.model_dump()}
    deps = assistant.Deps(run_for=_chat_run, simulate=run_simulation, mission=lambda r, a: run_mission(r, a, run_simulation),
                          make_request=lambda **k: AgentRunRequest(**k), route_model=ask_route_model)
    return assistant.chat(req, run, deps)


@app.post("/scenario/compare", response_model=ScenarioCompareResponse)
def scenario_compare_ep(req: ScenarioCompareRequest):
    """Two scenarios side by side (run history: "compare with now"): the settings that differ, peak load and
    over-threshold time before any plan, and the team's recommendation for each, all computed here with their run ids."""
    from .agents import assistant
    from .agents.engine import run_mission
    deps = assistant.Deps(run_for=_chat_run, simulate=run_simulation, mission=lambda r, a: run_mission(r, a, run_simulation),
                          make_request=lambda **k: AgentRunRequest(**k), route_model=None)
    return assistant.scenario_compare(req.a.model_dump(), req.b.model_dump(), [i.model_dump() for i in req.applied], req.scope, req.locale, deps)


@app.get("/knowledge/sources", response_model=KnowledgeSources)
def knowledge_sources():
    """The documents the assistant may cite: title, issuing authority, URL, dates, licence, and how they are searched."""
    from .agents import knowledge
    return knowledge.sources_view()


@app.get("/knowledge/graph")
def knowledge_graph():
    """The corridor as a graph (stations, lines, events, measures, agents, operating parties): counts and edge types."""
    from .agents import knowledge
    return knowledge.graph_view()


GENESIS = "0" * 64


def _canon(rec: dict) -> str:
    return json.dumps(rec, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _last_line(path: Path) -> str | None:
    """The last non-empty line of the log as written (the next record's `prev` is its SHA-256)."""
    if not path.exists():
        return None
    with path.open("rb") as f:
        f.seek(0, os.SEEK_END)
        end = f.tell()
        chunk, pos = b"", end
        while pos > 0:
            step = min(4096, pos)
            pos -= step
            f.seek(pos)
            chunk = f.read(step) + chunk
            lines = [x.rstrip(b"\r") for x in chunk.split(b"\n") if x.strip()]
            if len(lines) >= 2 or pos == 0:
                return lines[-1].decode("utf-8") if lines else None
    return None


@app.post("/decisions", response_model=DecisionResponse)
def decisions(req: DecisionRequest, request: Request = None):  # type: ignore[assignment]
    """Human-in-the-loop log (CLAUDE.md rule 3). Anonymous labels only; append-only JSONL. Tamper-evident (WP5): each
    record carries `prev` (SHA-256 of the previous line as written, 64 zeros for the first) and `hash` (SHA-256 of
    the record without `hash`, canonical JSON); GET /decisions/verify checks the chain. With EVENTFLOW_AUTH=on the
    planner role is needed and the signed-in account is recorded next to the label."""
    import hashlib
    signed = None
    if request is not None:
        from .auth import require_role
        signed = require_role(request, "planner")
    ts = dt.datetime.now(DUBAI).isoformat(timespec="seconds")
    body = {k: v for k, v in req.model_dump().items() if not (k in ("reason_codes", "reason") and not v)}
    rec = {"decision_id": f"dec_{uuid.uuid4().hex[:10]}", "timestamp": ts, **body,
           "plan_known": req.plan_id in _PLANS}
    if signed:
        rec["signed_in"] = signed["username"]
    plan = _PLANS.get(req.plan_id)
    if plan:
        rec["option"] = next((o for o in plan["options"] if o["rank"] == req.option_rank), None)
    DECISIONS_LOG.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        last = _last_line(DECISIONS_LOG)
        rec["prev"] = hashlib.sha256(last.encode("utf-8")).hexdigest() if last else GENESIS
        rec["hash"] = hashlib.sha256(_canon(rec).encode("utf-8")).hexdigest()
        with DECISIONS_LOG.open("a", encoding="utf-8", newline="\n") as f:     # LF on Windows too: the hash covers the bytes
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return {"logged": True, "decision_id": rec["decision_id"], "timestamp": ts, "plan_known": rec["plan_known"]}


def verify_log(path: Path) -> dict:
    """Walk the decision log: every chained record's hash must match its content and its `prev` the line before.
    Records written before the chain existed (no `hash`) are counted as unchained, not as broken."""
    import hashlib
    out = {"ok": True, "records": 0, "chained": 0, "unchained": 0, "first_bad": None}
    if not path.exists():
        return out
    prev_line = None
    for n, line in enumerate((x for x in path.read_text(encoding="utf-8").splitlines() if x.strip()), 1):
        out["records"] += 1
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            out.update(ok=False, first_bad=n)
            break
        if "hash" not in rec:
            out["unchained"] += 1
            prev_line = line
            continue
        want_prev = hashlib.sha256(prev_line.encode("utf-8")).hexdigest() if prev_line else GENESIS
        body = {k: v for k, v in rec.items() if k != "hash"}
        if rec.get("prev") != want_prev or hashlib.sha256(_canon(body).encode("utf-8")).hexdigest() != rec["hash"]:
            out.update(ok=False, first_bad=n)
            break
        out["chained"] += 1
        prev_line = line
    return out


@app.get("/decisions/verify")
def decisions_verify():
    """Is the decision log intact? {ok, records, chained, unchained, first_bad}. On the hosted site the log lives in
    /tmp and does not survive a restart: the chain proves order and integrity while it lasts, not durability."""
    return verify_log(DECISIONS_LOG)


# ---------------------------------------------------------------- the event chain (docs/15 §8, contract 1.14.0)
def _chain_deps(state: dict):
    from .agents.agents_util import message_for
    from .agents.chain import Deps
    from .agents.engine import run_mission
    from .schemas import ForecastRequest as _FR, MessageRequest as _MR
    r = state["request"]
    spec = _FR(**r["forecast"])
    run = get_run(state["forecast_run_id"], spec)

    def mission(st: dict) -> dict:
        req = AgentRunRequest(forecast_run_id=run["run_id"], forecast=spec, threshold=r.get("threshold"), scope=r.get("scope", "corridor"),
                              applied=st["applied"], locale=r.get("locale", "en"), priority=st.get("priority") or r.get("priority", "balanced"),
                              constraints=st.get("constraints") or {}, checkpoints=r.get("checkpoints") or [], answers=st.get("answers") or [])
        m = run_mission(run, req, run_simulation)
        with _LOCK:
            _PLANS[m["plan"]["plan_id"]] = m["plan"]
        return m

    def message(before: list[dict], ivs: list[dict]) -> dict:
        mr = _MR(forecast_run_id=run["run_id"], forecast=spec, threshold=r.get("threshold"), scope=r.get("scope", "corridor"),
                 applied=before, interventions=ivs)
        named = run
        if r.get("label") and (run.get("event") or {}).get("id") == "custom":     # a registered event: riders read its own name
            named = {**run, "event": {**run["event"], "name": r["label"], "name_ar": r["label"]}}
        return message_for(mr, named, run_simulation)

    def log(fields: dict) -> dict:
        return decisions(DecisionRequest(**fields))

    def feedback(fields: dict) -> dict:
        from .agents.loop import read_feedback
        return read_feedback(FeedbackRequest(**fields))
    return Deps(run=run, simulate=run_simulation, mission=mission, message=message, log_decision=log, feedback=feedback)


def _chain_owner(request: Request) -> str | None:
    from .auth import current_user
    u = current_user(request)
    return u["username"] if u else None


@app.post("/chain/start", response_model=ChainState)
def chain_start(req: ChainStartRequest, request: Request):
    """Start an event chain on a scenario: the Watcher scans, its alert triggers the planning team, and the chain runs
    by itself until the plan reaches the human (or the day ends). Every event says who published it and who it
    triggered. Nothing is applied: approve or reject with POST /chain/{id}/decide."""
    from .agents import chain as ch
    from .store import store
    run = build_run(req.forecast)
    _remember(run)                                    # later steps look the run up by id (cold instance)
    state = ch.new_state(req.model_dump(mode="json"), run["run_id"])
    state = ch.start(state, _chain_deps(state))
    store().put("chains", state["chain_id"], ch.public(state), owner=_chain_owner(request))
    from .ops import notify_chain
    notify_chain(state, 0)                            # "decision needed" when NOTIFY_WEBHOOK_URL is set
    return ch.public(state)


@app.post("/chain/{chain_id}/decide", response_model=ChainState)
def chain_decide(chain_id: str, req: ChainDecideRequest, request: Request):
    """The human's decision on the option in the inbox: logged first (append-only decision log), then published as
    `decision.made`, which triggers the Messenger (after an approval) and the Watcher; the chain runs on until the next
    decision or the end of the day."""
    from .agents import chain as ch
    from .auth import require_role
    from .store import store
    require_role(request, "planner")
    state = store().get("chains", chain_id)
    if state is None:
        raise HTTPException(404, f"unknown chain {chain_id} (chains live in this server's store; see GET /chains)")
    since = len(state["events"])
    try:
        reason = {"reason_codes": req.reason_codes, "reason": req.reason, "avoid": req.avoid, "protect": req.protect}
        state = ch.decide(state, _chain_deps(state), req.rank, req.decision, req.user, reason)
    except ch.ChainError as e:
        raise HTTPException(409, str(e)) from e
    store().put("chains", chain_id, ch.public(state), owner=_chain_owner(request))
    from .ops import notify_chain
    notify_chain(state, since)
    _sync_event(state)
    return ch.public(state)


def _chain_or_404(chain_id: str) -> dict:
    from .store import store
    state = store().get("chains", chain_id)
    if state is None:
        raise HTTPException(404, f"unknown chain {chain_id} (chains live in this server's store; see GET /chains)")
    return state


@app.post("/chain/{chain_id}/answer", response_model=ChainState)
def chain_answer(chain_id: str, req: ChainAnswerRequest, request: Request):
    """The human's answer at a checkpoint (1.16.0, decision #145): published as `checkpoint.answered`, which triggers the
    Supervisor; the team runs again with the answer and goes on to the next checkpoint or the approval inbox."""
    from .agents import chain as ch
    from .auth import require_role
    from .store import store
    require_role(request, "planner")
    state = _chain_or_404(chain_id)
    since = len(state["events"])
    try:
        state = ch.answer(state, _chain_deps(state), req.answer.model_dump())
    except ch.ChainError as e:
        raise HTTPException(409, str(e)) from e
    store().put("chains", chain_id, ch.public(state), owner=_chain_owner(request))
    from .ops import notify_chain
    notify_chain(state, since)
    _sync_event(state)
    return ch.public(state)


@app.post("/chain/{chain_id}/change", response_model=ChainState)
def chain_change(chain_id: str, req: ChainChangeRequest, request: Request):
    """Conditions changed during the day (1.16.0): an incident (rain, heat, a train fault, a crowd surge) or a bigger or
    smaller crowd. The forecast is rebuilt with it, `conditions.changed` triggers the Watcher, which re-checks the day
    with the approved plan in place (`plan.checked`) and raises an alert where it no longer holds."""
    from .agents import chain as ch
    from .auth import require_role
    from .store import store
    require_role(request, "planner")
    if req.incident is None and req.attendance_x is None:
        raise HTTPException(422, "say what changed: incident and/or attendance_x")
    state = _chain_or_404(chain_id)
    spec = dict(state["request"]["forecast"])
    what: dict = {}
    if req.incident is not None:
        spec["incident"] = req.incident.model_dump()
        what["incident"] = spec["incident"]
    if req.attendance_x is not None:
        old = get_run(state["forecast_run_id"], ForecastRequest(**state["request"]["forecast"]))
        base_att = (spec.get("custom_event") or {}).get("attendance") or old.get("attendance_used") or 0
        if not base_att:
            raise HTTPException(409, "this scenario has no event crowd to scale")
        new_att = int(round(min(200_000, base_att * req.attendance_x)))
        if spec.get("custom_event"):
            spec["custom_event"] = {**spec["custom_event"], "attendance": new_att}
        else:
            spec["attendance"] = new_att
        what.update(attendance_x=req.attendance_x, attendance=new_att)
    run = build_run(ForecastRequest(**spec))
    _remember(run)
    state["request"]["forecast"] = ForecastRequest(**spec).model_dump(mode="json", exclude_none=True)
    state["forecast_run_id"] = run["run_id"]
    since = len(state["events"])
    try:
        state = ch.change(state, _chain_deps(state), {**what, "run_id": run["run_id"]})
    except ch.ChainError as e:
        raise HTTPException(409, str(e)) from e
    store().put("chains", chain_id, ch.public(state), owner=_chain_owner(request))
    from .ops import notify_chain
    notify_chain(state, since)
    _sync_event(state)
    return ch.public(state)


def _sync_event(state: dict) -> None:
    """Keep a registered event's chain status in step with its chain."""
    from .store import store
    key = state["request"].get("event_key")
    ev = store().get("events", key) if key else None
    if ev:
        ev["chain_id"], ev["chain_status"] = state["chain_id"], state["status"] if state["status"] != "ended" else f"ended:{state.get('ended_reason')}"
        store().put("events", key, ev, owner=ev.get("registered_by"))


# ---------------------------------------------------------------- operations: events, inbox, rider notices (1.15.0)
def _start_event_chain(ev: dict, threshold: float | None, request: Request) -> dict:
    from .agents import chain as ch
    from .ops import notify_chain
    from .store import store
    req = ChainStartRequest(forecast=ForecastRequest(**ev["forecast"]), threshold=threshold, label=ev["name"], event_key=ev["event_key"])
    run = build_run(req.forecast)
    _remember(run)                                    # later steps look the run up by id (cold instance)
    state = ch.new_state(req.model_dump(mode="json"), run["run_id"])
    state = ch.start(state, _chain_deps(state))
    store().put("chains", state["chain_id"], ch.public(state), owner=_chain_owner(request))
    notify_chain(state, 0)
    _sync_event(state)
    return store().get("events", ev["event_key"])


@app.post("/events/register", response_model=RegisteredEvent)
def events_register(req: EventRegistration, request: Request):
    """Register an event (organiser or duty manager). With auto_chain the event chain starts at once: the Watcher
    scans the day, an alert triggers the planning team, and the plan waits in the inbox (GET /inbox)."""
    from .auth import require_role
    from .ops import save_event, validate_event
    u = require_role(request, "planner")
    try:
        ev = validate_event(req.model_dump())
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    doc = save_event(ev, u["username"] if u else None)
    return _start_event_chain(doc, req.threshold, request) if req.auto_chain else doc


@app.post("/events/import", response_model=EventImportResult)
def events_import(req: EventImport, request: Request):
    """Register many events from a CSV (header: name,near_station,date,start,end,attendance[,venue,organiser]).
    Rows that fail are reported with their line number; the others are registered (and their chains started)."""
    from .auth import require_role
    from .ops import parse_csv, save_event
    u = require_role(request, "planner")
    good, bad = parse_csv(req.csv)
    created = []
    for ev in good:
        doc = save_event(ev, u["username"] if u else None)
        created.append(_start_event_chain(doc, None, request) if req.auto_chain else doc)
    return {"created": created, "errors": bad}


@app.get("/events/registered", response_model=list[RegisteredEvent])
def events_registered(limit: int = 50):
    from .store import store
    return [d for r in store().list("events", limit=limit) if (d := store().get("events", r["id"]))]


@app.get("/inbox", response_model=Inbox)
def inbox_list(request: Request, limit: int = 50):
    """Every chain waiting for a decision, newest first (the duty manager's phone view)."""
    from . import auth
    from .ops import inbox, questions
    auth.require_role(request, "viewer")
    return {"items": inbox(limit), "questions": questions(limit), "auth": "on" if auth.enabled() else "off", "notifications": bool(os.environ.get("NOTIFY_WEBHOOK_URL", "").strip())}


@app.post("/chain/{chain_id}/publish", response_model=RiderNotice)
def chain_publish(chain_id: str, request: Request):
    """Publish the last approval's Messenger drafts as a rider notice (shown on the travel page). Needs a logged
    approval; with auth on, the planner role. Nothing is published automatically."""
    from .auth import require_role
    from .ops import publish
    from .store import store
    u = require_role(request, "planner")
    state = store().get("chains", chain_id)
    if state is None:
        raise HTTPException(404, f"unknown chain {chain_id}")
    return publish(state, u["username"] if u else "duty-manager")


@app.get("/notices", response_model=list[RiderNotice])
def rider_notices(forecast_run_id: str | None = None):
    """Rider notices a duty manager published (public, no sign-in), newest first."""
    from .ops import notices
    from .travel import settings
    return notices(float(settings()["notices_max_age_h"]), forecast_run_id)


@app.post("/travel/advice", response_model=TravelAdvice)
def travel_advice(req: TravelRequest):
    """For a rider: how busy a station is at an hour, how long the platform wait is, until when it stays busy, a
    quieter station within walking distance and a later time to leave — from the simulator, with the measures of
    published rider notices for this scenario. Public; no model involved."""
    from .ops import notices
    from .travel import advice, settings
    run = build_run(req.forecast)
    _remember(run)                                    # later steps look the run up by id (cold instance)
    pub = notices(float(settings()["notices_max_age_h"]), run["run_id"]) if req.use_notices else []
    applied = pub[0]["applied"] if pub else []
    sim = run_simulation(run["run_id"], applied, True, req.threshold, "network")
    thr = sim["summary"]["threshold"]
    try:
        return advice(sim, req.station, req.hour, thr, applied, pub)
    except KeyError as e:
        raise HTTPException(422, f"unknown station {e}") from e


@app.get("/chain/{chain_id}", response_model=ChainState)
def chain_get(chain_id: str):
    from .store import store
    state = store().get("chains", chain_id)
    if state is None:
        raise HTTPException(404, f"unknown chain {chain_id}")
    return state


@app.get("/chains")
def chain_list(limit: int = 20):
    """The most recent chains on this server (id, created, updated, owner)."""
    from .store import store
    return {"items": store().list("chains", limit=limit), "store": store().kind}


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


# ---------------------------------------------------------------- sign-in and roles (auth.py; off unless EVENTFLOW_AUTH=on)
@app.post("/auth/register")
def auth_register(req: RegisterRequest, request: Request):
    """The first account on an empty store becomes the admin; after that only an admin can add users."""
    from . import auth
    return auth.register(req.username, req.password, req.role, auth.current_user(request))


@app.post("/auth/login")
def auth_login(req: LoginRequest):
    from . import auth
    return auth.login(req.username, req.password)


@app.post("/auth/logout")
def auth_logout(request: Request):
    from . import auth
    auth.logout(request)
    return {"ok": True}


@app.get("/auth/me")
def auth_me(request: Request):
    from . import auth
    return {"auth": "on" if auth.enabled() else "off", "user": auth.current_user(request)}
