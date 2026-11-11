"""Event overlay: conservation, profiles, validation."""
import pytest

from apps.api.eventflow.config import events
from apps.api.eventflow.event_model import overlay, timing_params

EVENTS = {e["id"]: e for e in events()}


@pytest.mark.parametrize("eid", sorted(EVENTS))
def test_overlay_conserves_trips(eid):
    ev = EVENTS[eid]
    em = timing_params(ev)
    ov = overlay(ev)
    trips_in = ev["attendance"] * em["metro_share"]
    assert sum(sum(v["exits"]) for v in ov.values()) == pytest.approx(trips_in)
    assert sum(sum(v["entries"]) for v in ov.values()) == pytest.approx(trips_in * em["return_factor"])


def test_exhibition_profile_spreads_departures():
    gx = EVENTS["gitex2025_d1"]
    as_default = {**gx, "profile": "default"}
    peak = lambda ev: max(max(v["entries"]) for v in overlay(ev).values())
    assert peak(gx) < peak(as_default)


def test_unknown_profile_rejected():
    with pytest.raises(ValueError):
        overlay({**EVENTS["dfw2026_d1"], "profile": "rave"})


def test_historical_events_have_sources():
    for ev in events():
        assert ev.get("source_url"), ev["id"]
        if ev["attendance"] and ev.get("is_assumption") is not True:
            assert ev.get("sources"), f"{ev['id']}: non-assumption attendance needs sources"


def test_config_read_as_utf8():
    """Windows defaults to cp1252; the en dash in event names must survive (was rendered as 'â€“')."""
    assert any("–" in e["name"] for e in events())
    assert not any("â€" in e["name"] for e in events())
