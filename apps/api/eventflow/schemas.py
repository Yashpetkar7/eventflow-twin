"""API contract v1 (frozen 11 Nov 2026). The web app's TypeScript types are generated from the OpenAPI
schema these models produce (`python scripts/export_contract.py`). Changing a field = a contract change:
bump CONTRACT_VERSION, regenerate fixtures + TS types, and note it in docs/09_DECISIONS.md.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .interventions import Intervention

CONTRACT_VERSION = "1.7.0"   # 1.7.0: POST /breakpoint · 1.6.0: stateless runs — SimulateRequest.forecast / AgentPlanRequest.forecast rebuild a run on any instance · 1.5.0: exhibit what-ifs (weather, exit window, custom event, comfort threshold, corridor scope), trains_per_hour, /agent/plan live (steps, risk, new_hotspots) · 1.1.0: SimSummary.no_service_pax · 1.2.0: Event.profile/sources/note · 1.3.0: Event.*_ar · 1.4.0: whole network (Station.lines/in_corridor), SimulateRequest.detail, GET /decisions
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


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
    near_station: str
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    weekend: bool = False
    attendance: int = Field(ge=0, le=200_000)


class ForecastRequest(BaseModel):
    event_id: str | None = Field(None, description="Event from /events; null = background only")
    date: str | None = Field(None, description="YYYY-MM-DD; picks the weekday profile (defaults to the event date)")
    weekday: int | None = Field(None, ge=0, le=6, description="0=Mon … 6=Sun; overrides date")
    attendance: int | None = Field(None, ge=0, le=200_000, description="What-if override of event attendance")
    end_time: str | None = Field(None, pattern=HHMM, description="What-if override of event end time (HH:MM)")
    weather: Weather = Field("normal", description="Weather what-if: sets the metro share of event trips (assumption)")
    exit_sigma_min: float | None = Field(None, ge=10, le=90, description="What-if venue exit window (σ, minutes)")
    custom_event: CustomEvent | None = Field(None, description="Build-your-own scenario; overrides event_id")


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
    event: Event | None = Field(None, description="The event behind this run (resolved custom event included)")
    band_note: str
    rows: list[ForecastRow]
    source: Source


# ---------- simulate ----------
class SimulateRequest(BaseModel):
    forecast_run_id: str
    forecast: ForecastRequest | None = Field(
        None, description="The request that produced forecast_run_id. Lets an instance that has never seen the run rebuild it.")
    interventions: list[Intervention] = Field(default_factory=list)
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
    source: Source


# ---------- break points ----------
class BreakpointRequest(BaseModel):
    forecast_run_id: str
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
    forecast_run_id: str
    forecast: ForecastRequest | None = Field(None, description="As in SimulateRequest.forecast")
    goal: str = Field("Keep every station under 85% load during the exit surge", max_length=500)
    locale: Literal["en", "ar"] = "en"
    notes: str | None = Field(None, max_length=1000, description="Untrusted planner notes (treated as data)")
    threshold: float | None = Field(None, ge=0.5, le=1.0)
    scope: Scope = "network"
    priority: Literal["cost", "balanced", "impact"] = "balanced"
    applied: list[Intervention] = Field(default_factory=list, description="Already-approved interventions to plan on top of")


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


class AgentStep(BaseModel):
    key: str
    label: str
    detail: str = ""
    tool: str | None = None


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
    cached: bool = False


# ---------- decisions ----------
class DecisionRequest(BaseModel):
    plan_id: str
    option_rank: int = Field(ge=1, le=3)
    decision: Literal["approve", "reject"]
    user: str = Field("visitor", max_length=40, pattern=r"^[\w .\-]+$", description="Anonymous label only")
    # What exactly was decided on, so the audit log stands on its own (treated as data, never executed).
    option_title: str | None = Field(None, max_length=200)
    forecast_run_id: str | None = Field(None, max_length=40)
    interventions: list[Intervention] = Field(default_factory=list)


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
    interventions: list[Intervention] = Field(default_factory=list)


class DecisionList(BaseModel):
    total: int
    approved: int
    rejected: int
    items: list[DecisionRecord] = Field(description="Newest first")
