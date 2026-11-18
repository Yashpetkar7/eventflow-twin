"""API contract v1 (frozen 11 Nov 2026). The web app's TypeScript types are generated from the OpenAPI
schema these models produce (`python scripts/export_contract.py`). Changing a field = a contract change:
bump CONTRACT_VERSION, regenerate fixtures + TS types, and note it in docs/09_DECISIONS.md.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .interventions import Intervention

CONTRACT_VERSION = "1.16.0"   # 1.16.0: the agentic loop with the human in it — POST /agent/brief (plain words → a proposal to confirm), AgentRunRequest.brief; checkpoints (AgentRunRequest.checkpoints/answers, Mission.pause, status "paused"); reject with a reason (POST /agent/feedback, DecisionRequest.reason_codes/reason); the chain loop (POST /chain/{id}/answer, /chain/{id}/change; topics checkpoint.asked, feedback.read, conditions.changed, plan.checked); GET /memory · 1.15.0: operations and riders — POST /events/register, /events/import, GET /inbox, POST /chain/{id}/publish, GET /notices, POST /travel/advice · 1.14.0: agent messages — AgentEvent.to and kind "message" (supervisor brief, critic objections, specialists revisions); specialists size their measures (planner rev 5) · 1.13.0: incidents (ForecastRequest.incident, ForecastResponse.incident) and the duty shift — POST /shift/next · 1.12.0: standing agents — POST /watch/scan, /agent/message, /agent/ask · 1.11.0: agent team — POST /agent/run (Mission with events, objective, rejected plans, C1–C7 checks, stress tests, budget), GET /agent/roster · 1.10.0: agent plan `trace`, `critic`, option `goal_met`/`round` (critic + replan loop); road-pressure proxy (`road`, `baseline_road`); ForecastRequest.demand_level · 1.9.0: ForecastRequest.metro_share (what-if share of event trips by metro) · 1.8.0: station_metering + extended_hours interventions, request size limits (MAX_INTERVENTIONS, id lengths) · 1.7.0: POST /breakpoint · 1.6.0: stateless runs — SimulateRequest.forecast / AgentPlanRequest.forecast rebuild a run on any instance · 1.5.0: exhibit what-ifs (weather, exit window, custom event, comfort threshold, corridor scope), trains_per_hour, /agent/plan live (steps, risk, new_hotspots) · 1.1.0: SimSummary.no_service_pax · 1.2.0: Event.profile/sources/note · 1.3.0: Event.*_ar · 1.4.0: whole network (Station.lines/in_corridor), SimulateRequest.detail, GET /decisions
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
MAX_INTERVENTIONS = 24          # per request: bounds simulator work on the public demo (one visitor cannot ask for thousands)


class Source(BaseModel):
    """Provenance attached to every set of numbers (CLAUDE.md rule 2)."""
    tool: Literal["forecast", "simulate", "rank", "eval"]
    run_id: str


class Station(BaseModel):
    id: str
    name_en: str
    name_ar: str | None = None
    line: str = Field(description="Primary line")
    lines: list[str] = Field(default_factory=list, description="All metro lines serving the station")
    lat: float
    lon: float
    in_corridor: bool = Field(False, description="Part of the featured Sheikh Zayed Road / Trade Centre corridor")


class Event(BaseModel):
    id: str
    name: str
    name_ar: str | None = None
    venue: str
    venue_ar: str | None = None
    lat: float
    lon: float
    date: str
    start: str
    end: str
    attendance: int
    is_assumption: bool = False
    is_synthetic: bool = False
    source_url: str | None = None
    profile: str = "default"
    sources: list[str] = Field(default_factory=list)
    note: str | None = None
    note_ar: str | None = None


# ---------- forecast ----------
Weather = Literal["normal", "hot", "rain"]
Scope = Literal["network", "corridor"]


class CustomEvent(BaseModel):
    """Visitor-built what-if event next to a station (always labelled an assumption)."""
    near_station: str = Field(max_length=40)
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    weekend: bool = False
    attendance: int = Field(ge=0, le=200_000)


IncidentType = Literal["train_fault", "rain", "heat", "crowd_surge"]


class Incident(BaseModel):
    """A duty-view what-if (contract 1.13.0): what it changes is fixed in config/incidents.yaml, not sent by the client."""
    type: IncidentType
    hour: int = Field(ge=5, le=23, description="Hour of the scenario day at which it happens (a train fault lasts from then; the watcher cannot see it earlier)")


class IncidentInfo(BaseModel):
    """The incident as resolved by the server, with the assumption behind each figure."""
    type: IncidentType
    hour: int
    source: str
    line: str | None = None
    capacity_factor: float | None = Field(None, description="train_fault: share of the scheduled trains that still run")
    hours: list[int] | None = Field(None, description="train_fault: the hours it lasts")
    attendance_factor: float | None = None
    attendance_before: float | None = None
    attendance_after: float | None = None
    weather: str | None = None


class ForecastRequest(BaseModel):
    event_id: str | None = Field(None, max_length=64, description="Event from /events; null = background only")
    date: str | None = Field(None, description="YYYY-MM-DD; picks the weekday profile (defaults to the event date)")
    weekday: int | None = Field(None, ge=0, le=6, description="0=Mon … 6=Sun; overrides date")
    attendance: int | None = Field(None, ge=0, le=200_000, description="What-if override of event attendance")
    end_time: str | None = Field(None, pattern=HHMM, description="What-if override of event end time (HH:MM)")
    weather: Weather = Field("normal", description="Weather what-if: sets the metro share of event trips (assumption)")
    exit_sigma_min: float | None = Field(None, ge=10, le=90, description="What-if venue exit window (σ, minutes)")
    metro_share: float | None = Field(None, ge=0.2, le=0.8, description="What-if share of event trips made by metro; overrides the weather what-if's share (assumption)")
    demand_level: Literal["synthetic", "real_totals"] = Field("synthetic", description="'real_totals' scales each corridor station's background demand to its real weekday total (config/calibration.yaml); the hourly shape stays synthetic")
    custom_event: CustomEvent | None = Field(None, description="Build-your-own scenario; overrides event_id")
    incident: Incident | None = Field(None, description="Incident what-if for the duty view (assumptions in config/incidents.yaml)")


class ForecastRow(BaseModel):
    station_id: str
    hour: int
    entries_p10: float
    entries_p50: float
    entries_p90: float
    exits_p10: float
    exits_p50: float
    exits_p90: float
    event_entries_p50: float
    event_exits_p50: float = 0.0


class ForecastResponse(BaseModel):
    run_id: str
    model: str
    dataset_version: str
    is_synthetic: bool
    event_is_assumption: bool
    weekday: int
    attendance_used: float | None
    end_used: str | None
    metro_share_used: float | None = None
    exit_sigma_used: float | None = None
    weather: Weather = "normal"
    demand_level: Literal["synthetic", "real_totals"] = "synthetic"
    calibration: dict | None = Field(None, description="Station ratios applied when demand_level = real_totals, with their source file")
    event: Event | None = Field(None, description="The event behind this run (resolved custom event included)")
    incident: IncidentInfo | None = Field(None, description="The incident in this scenario, as resolved from config/incidents.yaml")
    band_note: str
    rows: list[ForecastRow]
    source: Source


# ---------- simulate ----------
class SimulateRequest(BaseModel):
    forecast_run_id: str = Field(max_length=40)
    forecast: ForecastRequest | None = Field(
        None, description="The request that produced forecast_run_id. Lets an instance that has never seen the run rebuild it.")
    interventions: list[Intervention] = Field(default_factory=list, max_length=MAX_INTERVENTIONS)
    detail: bool = Field(False, description="Include the 15-minute rows (large); hourly rows are always returned")
    threshold: float | None = Field(None, ge=0.5, le=1.0, description="What-if comfort threshold (default: corridor.yaml)")
    scope: Scope = Field("network", description="'corridor' = rows and summary for the featured corridor stations only")


class SimRow(BaseModel):
    station_id: str
    bin: int
    time: str
    demand: float
    capacity: float
    load_factor: float
    queue: float
    wait_min: float


class SimHourRow(BaseModel):
    station_id: str
    hour: int
    demand: float
    capacity: float
    peak_lf: float
    overcap_bins: int
    trains_per_hour: float = Field(0.0, description="Boardable trains/hour, busier direction of the primary line")


class SimSummary(BaseModel):
    overcap_station_hours: float
    excess_pax: float
    peak_lf: float
    max_wait_min: float
    delay_pax_min: float
    cost_proxy: float
    total_demand: float
    end_of_day_queue: float
    no_service_pax: float = Field(description="Demand in bins with no scheduled metro service (not queued)")
    bins_per_hour: int
    threshold: float = Field(0.85, description="Comfort threshold these figures were computed against")


class RoadPressure(BaseModel):
    """Road-pressure proxy (config/road.yaml): extra vehicles the event puts on nearby roads. An assumption model."""
    peak_veh_per_hour: float = Field(description="Extra vehicles in the busiest hour")
    peak_hour: int
    pressure: float = Field(description="Busiest hour as a share of the reference road capacity")
    vehicles_total: float
    reference_capacity: float = Field(description="Vehicles/hour of the yardstick: one direction of Sheikh Zayed Road")
    hourly: list[float]
    is_assumption: bool = True


class SimulateResponse(BaseModel):
    run_id: str
    source_forecast: str
    is_synthetic: bool
    summary: SimSummary
    baseline_summary: SimSummary
    delta: dict[str, float] = Field(description="summary − baseline_summary for each numeric field")
    effects: list[dict]
    diverted_off_metro: float
    rows: list[SimRow]
    hourly: list[SimHourRow]
    road: RoadPressure | None = Field(None, description="Road-pressure proxy with these interventions (null without an event)")
    baseline_road: RoadPressure | None = None
    source: Source


# ---------- break points ----------
class BreakpointRequest(BaseModel):
    forecast_run_id: str = Field(max_length=40)
    forecast: ForecastRequest | None = Field(None, description="As in SimulateRequest.forecast")
    threshold: float | None = Field(None, ge=0.5, le=1.0, description="Comfort threshold (default: corridor.yaml)")


class StationBreak(BaseModel):
    station_id: str
    served: bool = Field(description="The event sends metro trips to this station")
    break_attendance: int | None = Field(description="Visitors at which the station first exceeds the threshold (rounded up to 100); null if never")
    first_time: str | None = Field(description="HH:MM of the 15-minute bin that crosses first")


class BreakGridRow(BaseModel):
    boardable_share: float = Field(description="Assumed share of a train's capacity free for boarders at one station")
    break_attendance: int | None
    station_id: str | None
    first_time: str | None


class BreakpointResponse(BaseModel):
    run_id: str
    forecast_run_id: str
    is_synthetic: bool
    event_id: str | None
    attendance_used: float | None
    metro_share_used: float | None
    threshold: float
    boardable_share_default: float
    corridor_break_attendance: int | None
    corridor_break_station: str | None
    stations: list[StationBreak]
    grid: list[BreakGridRow]
    note: str
    source: Source


# ---------- agents (implemented by Stream B; shape frozen now) ----------
class AgentPlanRequest(BaseModel):
    forecast_run_id: str = Field(max_length=40)
    forecast: ForecastRequest | None = Field(None, description="As in SimulateRequest.forecast")
    goal: str = Field("Keep every station under 85% load during the exit surge", max_length=500)
    locale: Literal["en", "ar"] = "en"
    notes: str | None = Field(None, max_length=1000, description="Untrusted planner notes (treated as data)")
    threshold: float | None = Field(None, ge=0.5, le=1.0)
    scope: Scope = "network"
    priority: Literal["cost", "balanced", "impact"] = "balanced"
    applied: list[Intervention] = Field(default_factory=list, max_length=MAX_INTERVENTIONS, description="Already-approved interventions to plan on top of")


class PlanOption(BaseModel):
    rank: int = Field(ge=1, le=3)
    title: str
    interventions: list[Intervention]
    summary: SimSummary
    delta: dict[str, float]
    score: float
    rationale: str
    sources: list[Source]
    what: str = Field("", description="One-sentence description of the actions (template)")
    risk: str = Field("", description="One qualitative risk (fixed text per action type, no numbers)")
    cost_added: float = Field(0.0, description="Cost proxy added on top of the already-approved plans")
    new_hotspots: list[str] = Field(default_factory=list, description="Stations pushed over the threshold by this option")
    figures: int = Field(0, description="Figures on this card that were checked against the simulator output")
    goal_met: bool = Field(False, description="Critic: no station over the threshold and none newly pushed over it")
    round: int = Field(1, description="Planning round that produced this option (2+ = found by replanning)")
    road: RoadPressure | None = None


class AgentStep(BaseModel):
    key: str
    label: str
    detail: str = ""
    tool: str | None = None


class TraceEvent(BaseModel):
    """One tool call of the planner, in order. Figures in `data` are the simulator's (run_id says which run)."""
    n: int
    round: int
    role: Literal["planner", "proposer", "simulator", "critic", "explainer", "verifier"]
    tool: str
    run_id: str | None = None
    ms: float = 0.0
    data: dict = Field(default_factory=dict)


class CriticReport(BaseModel):
    rounds: int = 1
    replanned: bool = False
    simulations: int = 0
    goal_met_ranks: list[int] = Field(default_factory=list)
    top_meets_goal: bool = False
    checked_by: str = "code"
    residual: dict | None = Field(None, description="What the most effective offered plan still leaves, when none meets the goal")


class VerifyReport(BaseModel):
    numbers_checked: int
    all_matched: bool
    fallback_used: bool


class AgentPlanResponse(BaseModel):
    plan_id: str
    forecast_run_id: str
    mode: Literal["live", "offline"]
    is_synthetic: bool
    baseline_summary: SimSummary
    options: list[PlanOption]
    verify: VerifyReport
    steps: list[AgentStep] = Field(default_factory=list)
    planner: str = Field("", description="Which planner produced this: 'deterministic-template' or an LLM model id")
    hotspot: dict | None = Field(None, description="Worst station and hours the plan targets (from the diagnose tool)")
    critic: CriticReport | None = None
    trace: list[TraceEvent] = Field(default_factory=list, description="Every tool call behind this plan, in order")
    baseline_road: RoadPressure | None = None
    cached: bool = False


# ---------- decisions ----------
class DecisionRequest(BaseModel):
    plan_id: str = Field(max_length=64)
    option_rank: int = Field(ge=1, le=3)
    decision: Literal["approve", "reject"]
    user: str = Field("visitor", max_length=40, pattern=r"^[\w .\-]+$", description="Anonymous label only")
    # What exactly was decided on, so the audit log stands on its own (treated as data, never executed).
    option_title: str | None = Field(None, max_length=200)
    forecast_run_id: str | None = Field(None, max_length=40)
    interventions: list[Intervention] = Field(default_factory=list, max_length=MAX_INTERVENTIONS)
    reason_codes: list[str] = Field(default_factory=list, max_length=8, description="Why it was rejected (1.16.0): too_costly · not_enough · avoid:<measure> · protect:<station> · other")
    reason: str | None = Field(None, max_length=300, description="The planner's own words (stored as data)")


class DecisionResponse(BaseModel):
    logged: bool
    decision_id: str
    timestamp: str
    plan_known: bool


class DecisionRecord(BaseModel):
    decision_id: str
    timestamp: str
    plan_id: str
    option_rank: int
    decision: Literal["approve", "reject"]
    user: str
    option_title: str | None = None
    forecast_run_id: str | None = None
    interventions: list[Intervention] = Field(default_factory=list, max_length=MAX_INTERVENTIONS)
    reason_codes: list[str] | None = Field(None, description="A rejection's reasons, when given (1.16.0)")
    reason: str | None = Field(None, description="The planner's own words, when given (1.16.0)")


class DecisionList(BaseModel):
    total: int
    approved: int
    rejected: int
    items: list[DecisionRecord] = Field(description="Newest first")


# ---------- agent team (contract 1.11.0, docs/15_AGENT_ARCHITECTURE.md) ----------
InterventionType = Literal["extra_trains", "shuttle_bus", "robotaxi_staging", "staggered_exit", "wayfinding_redirect",
                           "station_metering", "extended_hours"]


class Constraints(BaseModel):
    """The planner's hard choices, set with typed controls. Text in the goal or notes never becomes a constraint."""
    forbid_types: list[InterventionType] = Field(default_factory=list, max_length=7, description="Measures the agents must not propose")
    protect_stations: list[str] = Field(default_factory=list, max_length=12, description="Stations that must not get more over-threshold time (C6)")
    cost_cap: float | None = Field(None, ge=0, le=1000, description="Largest added cost proxy an option may have (C6)")


class BriefRequest(BaseModel):
    """The planner's brief in plain words (1.16.0, decision #144). Untrusted text: read, screened, never followed."""
    text: str = Field(min_length=3, max_length=1000)
    locale: Literal["en", "ar"] = "en"


class BriefEvent(BaseModel):
    event_id: str | None = Field(None, description="A demo event from /events when the brief names one (its venue, date and times are used)")
    name: str | None = None
    near_station: str | None = Field(None, description="Corridor station id; null = not in the brief (the planner must choose)")
    start: str | None = Field(None, description="HH:MM on the 30-minute grid")
    end: str | None = None
    weekend: bool | None = None
    date: str | None = None
    attendance: int | None = Field(None, description="null = not in the brief (the default is shown and labelled)")


class BriefField(BaseModel):
    field: Literal["event", "name", "station", "start", "end", "day", "date", "attendance", "weather", "threshold", "priority",
                   "forbid", "protect", "cost_cap"]
    value: Any
    evidence: str = Field(description="The words of the brief this field was read from")
    source: Literal["model", "rules"] = Field(description="Read by the Intake agent's model, or by the word rules in config/brief.yaml")


class BriefResponse(BaseModel):
    """A proposal: nothing is applied until the planner confirms it in the brief card."""
    text: str
    summary: str
    event: BriefEvent
    weather: Weather | None = None
    threshold: float | None = None
    priority: Literal["cost", "balanced", "impact"] | None = None
    constraints: Constraints
    fields: list[BriefField]
    missing: list[str] = Field(description="Fields a build-your-own event needs that the brief leaves out")
    notes: list[str] = Field(description="Adjustments the reader made (time grid, defaults), in plain words")
    dropped: list[dict] = Field(default_factory=list, description="Model fields removed by the code checks (no quote from the brief, out of bounds)")
    findings: list[dict] = Field(default_factory=list, description="Instruction-like text (logged, never followed)")
    source: Literal["model", "recorded", "rules"]
    model: str | None = None
    note: str


class ConfirmedBrief(BaseModel):
    """What the planner confirmed in the brief card; the team logs it as the human's first message (1.16.0)."""
    text: str = Field(max_length=1000)
    summary: str = Field(max_length=300)
    source: Literal["model", "recorded", "rules"] = "rules"
    fields: list[str] = Field(default_factory=list, max_length=20, description="The fields kept, e.g. 'station', 'forbid'")
    removed: list[str] = Field(default_factory=list, max_length=20, description="Fields the planner removed or changed")


CheckpointId = Literal["hotspot", "partial"]
CheckpointAction = Literal["confirm", "focus", "stop", "accept", "more", "allow", "raise_cap"]


class CheckpointAnswer(BaseModel):
    """The human's answer at a checkpoint (1.16.0, decision #145). Answers are replayed in order: a mission run again
    with the same request and answers takes the same path to the same point, then continues."""
    checkpoint: CheckpointId
    action: CheckpointAction = Field(description="hotspot: confirm · focus (another over-threshold station) · stop. "
                                                 "partial: accept (the best plan so far) · more (one more round, at most 2). "
                                                 "allow / raise_cap change the constraints: the caller applies them and runs again")
    station: str | None = Field(None, max_length=40, description="focus: the station to plan for")
    measure: InterventionType | None = Field(None, description="allow: the measure the planner allows again")
    cost_cap: float | None = Field(None, ge=0, le=1000, description="raise_cap: the new cost cap")


class CheckpointPause(BaseModel):
    """The team stopped and asks the human (Mission.status 'paused'). Every figure in `params` is the simulator's."""
    checkpoint: CheckpointId
    asked_by: str = Field(description="The agent that asks (supervisor)")
    params: dict = Field(default_factory=dict, description="hotspot: station, hours, gap, candidates[{id, bins, peak_pct}] · "
                                                           "partial: best {interventions, over, excess, station}, rounds, forbidden, cost_cap")
    actions: list[CheckpointAction] = Field(description="The answers that apply here")


class AgentRunRequest(AgentPlanRequest):
    forecast: ForecastRequest = Field(description="The forecast request (required: the stress test re-forecasts from it)")
    constraints: Constraints = Field(default_factory=Constraints)
    brief: ConfirmedBrief | None = Field(None, description="The planner's confirmed brief (sent only when one was used)")
    checkpoints: list[CheckpointId] = Field(default_factory=list, max_length=2, description="Where the team stops and asks the human (1.16.0)")
    answers: list[CheckpointAnswer] = Field(default_factory=list, max_length=12, description="The human's answers so far, in order")


ReasonCode = Literal["too_costly", "not_enough", "avoid_measure", "protect_station", "other"]


class FeedbackRequest(BaseModel):
    """Why the planner rejected an option (1.16.0, decision #145): read into constraints for the next round."""
    reason_codes: list[ReasonCode] = Field(default_factory=list, max_length=5)
    reason: str | None = Field(None, max_length=300, description="The planner's own words (untrusted: read, screened, never followed)")
    interventions: list[Intervention] = Field(default_factory=list, max_length=MAX_INTERVENTIONS, description="The rejected option's measures")
    cost_proxy: float | None = Field(None, ge=0, description="The rejected option's added cost (cost_added, what the cost cap is checked against; for too_costly)")
    avoid: list[InterventionType] = Field(default_factory=list, max_length=7, description="avoid_measure: which measures")
    protect: list[str] = Field(default_factory=list, max_length=12, description="protect_station: which stations")
    constraints: Constraints = Field(default_factory=Constraints, description="The constraints the rejected option was planned with")
    priority: Literal["cost", "balanced", "impact"] = "balanced"
    locale: Literal["en", "ar"] = "en"


class FeedbackResponse(BaseModel):
    constraints: Constraints = Field(description="The constraints for the next round (the old ones plus what the reason adds)")
    priority: Literal["cost", "balanced", "impact"]
    changes: list[dict] = Field(description="What changed and why: {field, value, via: 'reason' | 'words'}")
    findings: list[dict] = Field(default_factory=list, description="Instruction-like text in the reason (logged, never followed)")
    source: Literal["model", "recorded", "rules"] = "rules"
    replan: bool = Field(description="True when the reason changed something the team can act on")


class MemoryItem(BaseModel):
    kind: Literal["avoid", "protect", "priority"]
    value: str
    count: int = Field(description="How many logged rejections gave this reason")
    last: str = Field(description="Timestamp of the latest one")


class MemoryResponse(BaseModel):
    """What the decision log remembers about this planner's rejections (1.16.0). Shown as suggestions, never applied."""
    user: str
    items: list[MemoryItem]
    decisions_read: int
    note: str


class AgentInfo(BaseModel):
    id: str
    layer: int = Field(description="1 command · 2 understand · 3 propose · 4 test · 5 explain & govern · 6 standing")
    kind: Literal["code", "model", "human"]
    can_call_model: bool
    tools: list[str]
    role: str
    role_ar: str


class LayerInfo(BaseModel):
    id: int
    key: str
    name: str
    name_ar: str


class AgentEvent(BaseModel):
    """One thing an agent did, in order. Text is rendered by the client from `key` + `params` (EN/AR); figures in
    `params` are the tools' (run_id says which run)."""
    seq: int
    t_ms: float = Field(description="Milliseconds since the mission started")
    round: int
    layer: int
    agent: str
    kind: Literal["start", "tool", "decision", "proposal", "reject", "finding", "handoff", "model", "budget", "message"]
    key: str
    params: dict = Field(default_factory=dict)
    run_id: str | None = None
    llm: dict | None = Field(None, description="Model, tokens, milliseconds and whether the answer was recorded")
    to: list[str] | None = Field(None, description="A message: the agents it is addressed to, who act on it next (1.14.0)")


class Objective(BaseModel):
    goal: str
    threshold: float
    priority: str
    scope: str
    constraints: Constraints
    findings: list[dict] = Field(default_factory=list, description="Instruction-like text found in the goal or notes (logged, never followed)")
    suggestions: list[str] = Field(default_factory=list, description="Constraint suggestions from the intake model: shown, not applied")
    source: str = "code"
    note: str = ""


class RejectedPlan(BaseModel):
    label: str
    interventions: list[Intervention]
    round: int
    criteria: list[str] = Field(description="Critic criteria the plan fails (C1 still over · C2 new hotspot · C3 worse overall · C6 constraint)")
    reason: Literal["no_relief", "bounds", "forbidden", "outranked"]
    run_id: str | None = None
    summary: SimSummary | None = None


class CriterionCheck(BaseModel):
    id: Literal["C1", "C2", "C3", "C4", "C5", "C6", "C7"]
    passed: bool | None = Field(description="None: the criterion does not apply to this scenario")
    value: float | None = None
    limit: float | None = None


class StressCase(BaseModel):
    case: str
    kind: Literal["attendance", "metro_share", "weather", "demand_level"]
    value: float | str
    holds: bool = Field(description="Every station stays under the threshold in this case")
    overcap_station_hours: float
    peak_lf: float
    excess_pax: float
    baseline_overcap_station_hours: float
    run_id: str


class Assessment(BaseModel):
    rank: int
    checks: list[CriterionCheck]
    stress: list[StressCase] = Field(default_factory=list)
    holds: int = 0
    total: int = 0


class Budget(BaseModel):
    steps: int
    steps_max: int
    simulations: int
    simulations_max: int
    model_calls: int
    model_calls_max: int
    tokens: int
    wall_ms: float
    wall_ms_max: float
    exceeded: list[str] = Field(default_factory=list)


class Recording(BaseModel):
    mode: Literal["code", "recorded", "live", "mixed"] = Field(description="code: no model; recorded: model answers replayed offline; live: model called now")
    model: str | None = None
    recorded_at: str | None = None
    agents_from_model: list[str] = Field(default_factory=list)
    misses: int = Field(0, description="Model answers not found in the recording (that agent used its code policy)")


class TeamCounts(BaseModel):
    agents: int
    model_capable: int
    code_only: int


class AgentSpan(BaseModel):
    """One agent step (consecutive events of one agent in one round), for the trace view and OpenTelemetry."""
    agent: str
    layer: int
    round: int
    start_ms: float
    end_ms: float
    kind: str
    keys: list[str]
    run_ids: list[str]
    llm: bool
    to: list[str] = Field(default_factory=list)
    events: int


class Recommendation(BaseModel):
    """Which offered option the critic's checks C1–C7 recommend (docs/17 WP3). The plan's own order is unchanged."""
    rank: int
    basis: Literal["all_checks", "goal_and_most", "most_checks"] = Field(
        description="all_checks: passes every applicable check · goal_and_most: passes C1–C3 and the most of C4–C7 · "
                    "most_checks: passes the most checks (ties: the plan's order)")
    passed: int = Field(description="Applicable checks the option passes")
    applicable: int = Field(description="Checks that apply to this scenario (C5 and C7 do not always)")
    failed: list[str] = Field(default_factory=list, description="Applicable checks it does not pass")


class Mission(BaseModel):
    mission_id: str
    status: Literal["awaiting_human", "no_action", "paused"]
    engine: Literal["graph", "seq", "classic"]
    objective: Objective
    roster: list[AgentInfo]
    counts: TeamCounts
    events: list[AgentEvent]
    plan: AgentPlanResponse
    rejected: list[RejectedPlan]
    assessments: list[Assessment]
    budget: Budget
    recording: Recording
    is_synthetic: bool
    stop_reason: str = Field("", description="Why the supervisor stopped testing: goal_met · max_rounds · no_relief · budget · no_variants · no_action")
    recommended_rank: int | None = Field(None, description="The option the critic's checks recommend (1.14.0)")
    recommendation: Recommendation | None = None
    spans: list[AgentSpan] | None = Field(None, description="One span per agent step, derived from the events (1.14.0, WP4)")
    pause: CheckpointPause | None = Field(None, description="Status 'paused': the question the team asks the human (1.16.0)")


class Roster(BaseModel):
    engine: Literal["graph", "seq", "classic"]
    layers: list[LayerInfo]
    agents: list[AgentInfo]
    counts: TeamCounts
    graph_mermaid: str = Field(description="The orchestration graph, generated from the code (empty without LangGraph)")


# ---------- standing agents (contract 1.12.0, docs/15) ----------
class _ScenarioRef(BaseModel):
    forecast_run_id: str = Field(max_length=40)
    forecast: ForecastRequest = Field(description="The forecast request (lets any instance rebuild the run)")
    threshold: float | None = Field(None, ge=0.5, le=1.0)
    scope: Scope = "corridor"
    applied: list[Intervention] = Field(default_factory=list, max_length=MAX_INTERVENTIONS)


class WatchRequest(_ScenarioRef):
    horizon_h: int = Field(3, ge=1, le=6, description="How far ahead the watcher looks (hours)")


class WatchAlert(BaseModel):
    station: str
    raised_at: int = Field(description="Hour of the scenario day at which the watcher raises the alert")
    crosses_at: int = Field(description="First hour the station is over the threshold")
    lead_h: int
    hours: list[int]
    peak_lf: float
    run_id: str


class WatchHour(BaseModel):
    hour: int
    active: list[str]
    new: list[str]


class WatchResponse(BaseModel):
    horizon_h: int
    threshold: float
    alerts: list[WatchAlert]
    timeline: list[WatchHour]
    run_id: str
    forecast_run_id: str
    is_synthetic: bool
    next_step: Literal["run_team", "none"]


class MessageRequest(_ScenarioRef):
    interventions: list[Intervention] = Field(min_length=1, max_length=MAX_INTERVENTIONS, description="The approved option's measures (re-simulated here)")


class MessageDraft(BaseModel):
    notice: str = Field(description="Passenger notice")
    sign: str = Field(description="Signage line")
    ops: str = Field(description="Operations briefing")


class MessageResponse(BaseModel):
    drafts: dict[Literal["en", "ar"], MessageDraft]
    status: Literal["draft"]
    sent: Literal[False]
    numbers_checked: int
    all_matched: bool
    source: Literal["template", "model", "recorded"]
    model: str | None = None
    note: str
    sources: list[Source]
    is_synthetic: bool


AskIntent = Literal["peak", "worst", "break_point", "if_hot", "if_rain", "if_more", "road", "plan"]


class AskRequest(_ScenarioRef):
    question: str | None = Field(None, max_length=300, description="Free text (untrusted); routed to one tool or refused")
    intent: AskIntent | None = Field(None, description="A question chip: the tool to run, no routing needed")
    locale: Literal["en", "ar"] = "en"


class AskResponse(BaseModel):
    intent: AskIntent | None
    refused: bool
    key: str = Field(description="Answer text key; the client words it from `params` (EN/AR)")
    params: dict
    sources: list[dict]
    routed_by: Literal["chip", "code", "model", "recorded"]
    is_synthetic: bool


# ---------- duty shift (contract 1.13.0, docs/15) ----------
class ShiftRequest(_ScenarioRef):
    """One step of a duty shift. The client keeps the state (stateless API): the measures approved so far (`applied`),
    the alerts already dealt with (`handled`) and the hour the shift has reached."""
    from_hour: int = Field(5, ge=5, le=23, description="The shift's clock: alerts are raised no earlier than this hour (an incident cannot be seen before it happens)")
    handled: list[str] = Field(default_factory=list, max_length=64, description="Alert keys (ShiftAlert.key) already approved, rejected or passed to the duty manager")
    locale: Literal["en", "ar"] = "en"
    horizon_h: int = Field(3, ge=1, le=6)


class ShiftAlert(WatchAlert):
    key: str = Field(max_length=40, description="'STATION@crosses_at#approved measures': how the client marks the alert as handled")
    seen_at: int = Field(description="Hour at which this shift sees the alert (never before from_hour)")
    lead_now_h: int = Field(description="Hours between seeing it and the crossing (0 or less: already over the line)")


class ShiftStep(BaseModel):
    """What the autonomous shift did until it needed a human: the clock ran to `hour`, the Watcher raised `alerts`,
    the team planned (`mission`) and its first option waits for approval. Nothing is applied by this call."""
    done: bool = Field(description="True: no alert is left for the rest of the day")
    reason: Literal["awaiting_human", "no_option", "clear", "residual", "step_limit"] = Field(
        description="clear: nothing is over the line · residual: every alert was dealt with but some crowding remains (for the duty manager) · "
                    "no_option: the team found nothing that helps · step_limit: too many decisions asked, the rest goes to the duty manager")
    hour: int
    alerts: list[ShiftAlert]
    mission: Mission | None = None
    recommended_rank: int | None = Field(None, description="The option put to the human: the first that clears every station (critic's goal), else the plan's first")
    watch: WatchResponse
    residual: SimSummary = Field(description="The day with the measures approved so far (simulator)")
    baseline: SimSummary = Field(description="The day with no measures (simulator)")
    applied_count: int
    handled_count: int
    run_id: str
    is_synthetic: bool



# ---------------------------------------------------------------- event chain (1.14.0, docs/15 §8)
class ChainStartRequest(BaseModel):
    forecast: ForecastRequest
    label: str | None = Field(None, max_length=120, description="What the inbox calls this chain (a registered event's name)")
    event_key: str | None = Field(None, max_length=40, description="The registered event that started it, if any")
    threshold: float | None = Field(None, ge=0.5, le=1.0)
    scope: Scope = "corridor"
    priority: Literal["cost", "balanced", "impact"] = "balanced"
    locale: Literal["en", "ar"] = "en"
    horizon_h: int = Field(3, ge=1, le=6)
    constraints: Constraints = Field(default_factory=Constraints, description="The planner's constraints; rejections with a reason add to them")
    checkpoints: list[CheckpointId] = Field(default_factory=list, max_length=2, description="Where the team stops and asks during each plan (1.16.0)")
    max_feedback_rounds: int = Field(3, ge=0, le=5, description="Replans after rejections with a reason, per alert, before the alert is set aside")


class ChainDecideRequest(BaseModel):
    decision: Literal["approve", "reject"]
    rank: int | None = Field(None, ge=1, le=3, description="The option decided on; default: the critic's recommendation")
    user: str = Field("duty-manager", max_length=40, pattern=r"^[\w .\-]+$", description="Anonymous label only")
    reason_codes: list[ReasonCode] = Field(default_factory=list, max_length=5, description="A rejection's reasons: the team replans with them (1.16.0)")
    reason: str | None = Field(None, max_length=300)
    avoid: list[InterventionType] = Field(default_factory=list, max_length=7)
    protect: list[str] = Field(default_factory=list, max_length=12)


class ChainAnswerRequest(BaseModel):
    answer: CheckpointAnswer
    user: str = Field("duty-manager", max_length=40, pattern=r"^[\w .\-]+$")


class ChainChangeRequest(BaseModel):
    """Conditions changed during the day (1.16.0): the Watcher re-checks the approved plan under them."""
    incident: Incident | None = None
    attendance_x: float | None = Field(None, ge=0.5, le=2.0, description="The crowd turns out this many times the forecast")
    user: str = Field("duty-manager", max_length=40, pattern=r"^[\w .\-]+$")


class ChainEvent(BaseModel):
    seq: int
    topic: Literal["scenario.loaded", "alert.raised", "plan.ready", "decision.made", "drafts.ready", "day.ended",
                   "checkpoint.asked", "checkpoint.answered", "feedback.read", "conditions.changed", "plan.checked"]
    publisher: str = Field(description="The agent (or the human) that published the event")
    subscribers: list[str] = Field(description="The agents this event triggered, in the order they acted")
    at: str
    payload: dict = Field(default_factory=dict)


class ChainInbox(BaseModel):
    mission: Mission
    recommended_rank: int | None = None
    alerts: list[ShiftAlert]
    hour: int
    residual: SimSummary
    baseline: SimSummary


class ChainState(BaseModel):
    """An event chain: agents triggered by each other's events until a human decision is needed."""
    chain_id: str
    status: Literal["running", "awaiting_human", "ended"]
    ended_reason: str | None = Field(None, description="clear · residual · step_limit · no_option · event_limit · human_stop")
    request: ChainStartRequest
    forecast_run_id: str
    applied: list[dict]
    handled: list[str]
    hour: int
    events: list[ChainEvent]
    inbox: ChainInbox | None = None
    drafts: list[dict] = Field(default_factory=list, description="The Messenger's drafts after each approval (never sent)")
    decisions: list[dict] = Field(default_factory=list)
    started: str
    constraints: Constraints = Field(default_factory=Constraints, description="The constraints now in force (start + rejections with a reason)")
    priority: Literal["cost", "balanced", "impact"] = Field("balanced", description="The priority now in force (start + rejections with a reason)")
    answers: list[CheckpointAnswer] = Field(default_factory=list, description="The human's checkpoint answers for the plan being made")
    feedback_rounds: int = Field(0, description="Replans after a rejection with a reason, for the current alert")
    pause: CheckpointPause | None = Field(None, description="Status 'awaiting_human' at a checkpoint: the question")
    loop: dict = Field(default_factory=dict, description="Loop counters: plans, checkpoints, feedback, changes, approvals, rejections")


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=1, max_length=200)


class RegisterRequest(LoginRequest):
    role: Literal["viewer", "planner", "admin"] = "planner"


# ---------------------------------------------------------------- operations and riders (1.15.0, decision #140)
class EventRegistration(BaseModel):
    """An organiser's or duty manager's event. It becomes a build-your-own event at its station (an assumption)."""
    name: str = Field(min_length=2, max_length=120)
    near_station: str = Field(max_length=40, description="Station id from GET /stations")
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    attendance: int = Field(ge=1, le=200_000)
    venue: str | None = Field(None, max_length=120)
    organiser: str | None = Field(None, max_length=120)
    auto_chain: bool = Field(True, description="Start the event chain at once (Watcher → team → inbox)")
    threshold: float | None = Field(None, ge=0.5, le=1.0)


class EventImport(BaseModel):
    csv: str = Field(max_length=200_000, description="Header: name,near_station,date,start,end,attendance[,venue,organiser]")
    auto_chain: bool = True


class RegisteredEvent(BaseModel):
    event_key: str
    name: str
    near_station: str
    date: str
    start: str
    end: str
    attendance: int
    weekend: bool
    venue: str | None = None
    organiser: str | None = None
    forecast: ForecastRequest
    registered: str
    registered_by: str | None = None
    chain_id: str | None = None
    chain_status: str | None = None


class EventImportResult(BaseModel):
    created: list[RegisteredEvent]
    errors: list[dict] = Field(default_factory=list, description="{line, error} for rows that were not imported")


class InboxItem(BaseModel):
    chain_id: str
    updated: str
    event: str | None = None
    event_key: str | None = None
    station: str | None = None
    crosses_at: int | None = None
    hour: int | None = None
    recommended_rank: int
    title: str
    what: str | None = None
    before: float
    after: float
    basis: str | None = None
    options: int
    is_synthetic: bool


class InboxQuestion(BaseModel):
    """A chain stopped at a checkpoint (1.16.0): the team asks before it goes on."""
    chain_id: str
    updated: str
    event: str | None = None
    checkpoint: str
    actions: list[str]
    params: dict = Field(default_factory=dict)
    is_synthetic: bool = True


class Inbox(BaseModel):
    items: list[InboxItem]
    questions: list[InboxQuestion] = Field(default_factory=list, description="Chains waiting at a checkpoint (1.16.0)")
    auth: Literal["on", "off"]
    notifications: bool = Field(description="True when NOTIFY_WEBHOOK_URL is configured")


class RiderNotice(BaseModel):
    notice_id: str
    published: str
    published_by: str | None = None
    chain_id: str
    decision_id: str
    plan_id: str
    title: str
    stations: list[str]
    forecast_run_id: str
    forecast: ForecastRequest
    applied: list[dict]
    event: str | None = None
    text: dict = Field(description="{en|ar: {notice, sign}} from the Messenger (figures re-simulated)")
    numbers_checked: int | None = None
    status: Literal["published"]


class TravelRequest(BaseModel):
    forecast: ForecastRequest
    station: str = Field(max_length=40)
    hour: int = Field(ge=0, le=23)
    threshold: float | None = Field(None, ge=0.5, le=1.0)
    use_notices: bool = Field(True, description="Include the measures of rider notices published for this scenario")


class TravelHour(BaseModel):
    hour: int
    load: float | None
    wait_min: float
    trains_per_hour: float | None


class TravelAlternative(BaseModel):
    station: str
    walk_min: int
    load: float
    wait_min: float
    better: bool


class TravelAdvice(BaseModel):
    station: str
    hour: int
    status: Literal["easy", "busy", "crowded", "closed"]
    now: TravelHour
    ahead: list[TravelHour]
    busy_until: int | None = None
    leave_later: dict | None = None
    alternatives: list[TravelAlternative]
    entry_metered: bool
    metered_stations: list[str]
    notices: list[RiderNotice]
    threshold: float
    is_synthetic: bool
    assumptions: dict
    source: dict
