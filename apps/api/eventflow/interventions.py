"""Typed, bounded intervention menu (docs/05 §5.4).

Every intervention is a Pydantic model; `validate_interventions` additionally checks station ids, walkable
neighbours and the bounds in corridor.yaml. Invalid input raises `InterventionError` (API → HTTP 422).
Nothing is silently clipped: a planner must see exactly what was simulated.
"""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from .config import corridor

Hours = Annotated[list[Annotated[int, Field(ge=0, le=23)]], Field(min_length=1, max_length=24)]


def _km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    from .event_model import _haversine_km
    return _haversine_km(a_lat, a_lon, b_lat, b_lon)


class InterventionError(ValueError):
    """Raised for any intervention that is malformed, out of bounds or refers to unknown stations."""


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExtraTrains(_Base):
    type: Literal["extra_trains"]
    params: "ExtraTrainsParams"


class ExtraTrainsParams(_Base):
    headway_min: float = Field(gt=0, description="New headway in minutes; must be ≥ min_headway_min")
    hours: Hours
    line: str = "Red"


class ShuttleBus(_Base):
    type: Literal["shuttle_bus"]
    params: "ShuttleBusParams"


class ShuttleBusParams(_Base):
    from_station: str
    to_station: str
    buses: int = Field(ge=1)
    hours: Hours


class RobotaxiStaging(_Base):
    type: Literal["robotaxi_staging"]
    params: "RobotaxiParams"


class RobotaxiParams(_Base):
    station: str
    vehicles: int = Field(ge=1)
    hours: Hours


class StaggeredExit(_Base):
    type: Literal["staggered_exit"]
    params: "StaggeredExitParams"


class StaggeredExitParams(_Base):
    spread_minutes: int
    event_id: str | None = None


class WayfindingRedirect(_Base):
    type: Literal["wayfinding_redirect"]
    params: "RedirectParams"


class RedirectParams(_Base):
    from_station: str
    to_station: str
    share: float = Field(gt=0)
    hours: Hours = Field(default_factory=lambda: list(range(24)))


class StationMetering(_Base):
    """Entry metering at the gates (RTA's New Year's Eve practice): admit riders only up to `max_load` × boarding
    capacity; the rest wait outside the station or, with `to_station`, are guided on foot to a neighbouring station.
    `max_load` 0 = the station is closed for those hours (then `to_station` is required)."""
    type: Literal["station_metering"]
    params: "MeteringParams"


class MeteringParams(_Base):
    station: str
    max_load: float = Field(ge=0, le=1)
    hours: Hours
    to_station: str | None = None


class ExtendedHours(_Base):
    """Run trains in hours when the line is normally closed (e.g. after midnight), at `headway_min`."""
    type: Literal["extended_hours"]
    params: "ExtendedHoursParams"


class ExtendedHoursParams(_Base):
    line: str = "Red"
    hours: Hours
    headway_min: float = Field(gt=0)


for _m in (ExtraTrains, ShuttleBus, RobotaxiStaging, StaggeredExit, WayfindingRedirect, StationMetering, ExtendedHours):
    _m.model_rebuild()

Intervention = Annotated[Union[ExtraTrains, ShuttleBus, RobotaxiStaging, StaggeredExit, WayfindingRedirect,
                               StationMetering, ExtendedHours], Field(discriminator="type")]
_LIST = TypeAdapter(list[Intervention])

# Application order is fixed by type so a bundle's result never depends on how it was listed:
# reshape the surge first, then capacity, then demand moves, then diversion off the metro.
# Entry metering comes last: it acts on whatever demand reaches the gates after every other measure.
APPLY_ORDER = {"staggered_exit": 0, "extra_trains": 1, "extended_hours": 1, "wayfinding_redirect": 2, "shuttle_bus": 3,
               "robotaxi_staging": 4, "station_metering": 5}


def _check_station(sid: str, field: str) -> None:
    ids = {s["id"] for s in corridor()["stations"]}
    if sid not in ids:
        raise InterventionError(f"{field}: unknown station '{sid}' (known: {sorted(ids)})")


def validate_interventions(raw: list) -> list[Intervention]:
    """Parse + semantically validate. Accepts dicts or already-built models."""
    try:
        items = _LIST.validate_python([i.model_dump() if isinstance(i, BaseModel) else i for i in raw or []])
    except ValidationError as e:
        raise InterventionError(str(e)) from e
    cfg = corridor()
    b, cap = cfg["interventions"]["bounds"], cfg["capacity"]
    for k, iv in enumerate(items):
        p, where = iv.params, f"interventions[{k}] ({iv.type})"
        if isinstance(iv, ExtraTrains):
            if p.headway_min < cap["min_headway_min"]:
                raise InterventionError(f"{where}: headway_min {p.headway_min} < minimum {cap['min_headway_min']}")
            lines = set(cfg.get("lines") or {s["line"] for s in cfg["stations"]})
            if p.line not in lines:
                raise InterventionError(f"{where}: unknown line '{p.line}'")
        elif isinstance(iv, ShuttleBus):
            _check_station(p.from_station, f"{where}.from_station")
            _check_station(p.to_station, f"{where}.to_station")
            if p.from_station == p.to_station:
                raise InterventionError(f"{where}: from_station and to_station must differ")
            if p.buses > b["max_buses"]:
                raise InterventionError(f"{where}: buses {p.buses} > max {b['max_buses']}")
            by_id = {s["id"]: s for s in cfg["stations"]}
            a_, b_ = by_id[p.from_station], by_id[p.to_station]
            km = _km(a_["lat"], a_["lon"], b_["lat"], b_["lon"])
            if km > b.get("max_shuttle_km", 8):
                raise InterventionError(f"{where}: {p.from_station}→{p.to_station} is {km:.1f} km; max {b.get('max_shuttle_km', 8)} km")
        elif isinstance(iv, RobotaxiStaging):
            _check_station(p.station, f"{where}.station")
            if p.vehicles > b["max_robotaxi_vehicles"]:
                raise InterventionError(f"{where}: vehicles {p.vehicles} > max {b['max_robotaxi_vehicles']}")
        elif isinstance(iv, StaggeredExit):
            lo, hi = b["stagger_minutes"]
            if not lo <= p.spread_minutes <= hi:
                raise InterventionError(f"{where}: spread_minutes {p.spread_minutes} outside [{lo}, {hi}]")
        elif isinstance(iv, WayfindingRedirect):
            _check_station(p.from_station, f"{where}.from_station")
            _check_station(p.to_station, f"{where}.to_station")
            if p.to_station not in cfg["neighbours"].get(p.from_station, []):
                raise InterventionError(f"{where}: {p.to_station} is not a walkable neighbour of {p.from_station}")
            if p.share > b["max_redirect_share"]:
                raise InterventionError(f"{where}: share {p.share} > max {b['max_redirect_share']}")
        elif isinstance(iv, StationMetering):
            _check_station(p.station, f"{where}.station")
            lo, hi = b.get("metering_load", [0.5, 0.95])
            if p.max_load != 0 and not lo <= p.max_load <= hi:
                raise InterventionError(f"{where}: max_load {p.max_load} outside [{lo}, {hi}] (0 = closed)")
            if p.max_load == 0 and not p.to_station:
                raise InterventionError(f"{where}: a closed station needs to_station (where riders are guided)")
            if p.to_station is not None:
                _check_station(p.to_station, f"{where}.to_station")
                if p.to_station not in cfg["neighbours"].get(p.station, []):
                    raise InterventionError(f"{where}: {p.to_station} is not a walkable neighbour of {p.station}")
        elif isinstance(iv, ExtendedHours):
            if p.headway_min < cap["min_headway_min"]:
                raise InterventionError(f"{where}: headway_min {p.headway_min} < minimum {cap['min_headway_min']}")
            lines = set(cfg.get("lines") or {s["line"] for s in cfg["stations"]})
            if p.line not in lines:
                raise InterventionError(f"{where}: unknown line '{p.line}'")
    return sorted(items, key=lambda iv: APPLY_ORDER[iv.type])
