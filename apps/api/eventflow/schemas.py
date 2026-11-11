"""API contract v1 (frozen 11 Nov 2026). The web app's TypeScript types are generated from the OpenAPI
schema these models produce (`python scripts/export_contract.py`). Changing a field = a contract change:
bump CONTRACT_VERSION, regenerate fixtures + TS types, and note it in docs/09_DECISIONS.md.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .interventions import Intervention

CONTRACT_VERSION = "1.2.0"   # 1.1.0: SimSummary.no_service_pax · 1.2.0: Event.profile, Event.sources, Event.note
HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"


class Source(BaseModel):
    """Provenance attached to every set of numbers (CLAUDE.md rule 2)."""
    tool: Literal["forecast", "simulate", "rank", "eval"]
    run_id: str


class Station(BaseModel):
    id: str
    name_en: str
    name_ar: str | None = None
    line: str
    lat: float
    lon: float


class Event(BaseModel):
    id: str
    name: str
    venue: str
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


# ---------- forecast ----------
class ForecastRequest(BaseModel):
    event_id: str | None = Field(None, description="Event from /events; null = background only")
    date: str | None = Field(None, description="YYYY-MM-DD; picks the weekday profile (defaults to the event date)")
    weekday: int | None = Field(None, ge=0, le=6, description="0=Mon … 6=Sun; overrides date")
    attendance: int | None = Field(None, ge=0, le=200_000, description="What-if override of event attendance")
    end_time: str | None = Field(None, pattern=HHMM, description="What-if override of event end time (HH:MM)")


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


class ForecastResponse(BaseModel):
    run_id: str
    model: str
    dataset_version: str
    is_synthetic: bool
    event_is_assumption: bool
    weekday: int
    attendance_used: float | None
    end_used: str | None
    band_note: str
    rows: list[ForecastRow]
    source: Source


# ---------- simulate ----------
class SimulateRequest(BaseModel):
    forecast_run_id: str
    interventions: list[Intervention] = Field(default_factory=list)


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


# ---------- agents (implemented by Stream B; shape frozen now) ----------
class AgentPlanRequest(BaseModel):
    forecast_run_id: str
    goal: str = Field("Keep every station under 85% load during the exit surge", max_length=500)
    locale: Literal["en", "ar"] = "en"
    notes: str | None = Field(None, max_length=1000, description="Untrusted planner notes (treated as data)")


class PlanOption(BaseModel):
    rank: int = Field(ge=1, le=3)
    title: str
    interventions: list[Intervention]
    summary: SimSummary
    delta: dict[str, float]
    score: float
    rationale: str
    sources: list[Source]


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


# ---------- decisions ----------
class DecisionRequest(BaseModel):
    plan_id: str
    option_rank: int = Field(ge=1, le=3)
    decision: Literal["approve", "reject"]
    user: str = Field("visitor", max_length=40, pattern=r"^[\w .\-]+$", description="Anonymous label only")


class DecisionResponse(BaseModel):
    logged: bool
    decision_id: str
    timestamp: str
    plan_known: bool
