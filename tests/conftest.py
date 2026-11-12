import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apps.api.eventflow.config import corridor, events  # noqa: E402
from apps.api.eventflow.event_model import overlay  # noqa: E402
from apps.api.eventflow.simulate import bins_per_hour  # noqa: E402

STATIONS = [s["id"] for s in corridor()["stations"]]
N = 24 * bins_per_hour()


def make_demand(base_per_bin: float = 125.0, event_scale: float = 1.0) -> dict:
    """Flat background + the demo event's exit surge, in 15-min bins."""
    ev = overlay(next(e for e in events() if e["id"] == "dfw2026_d1"), scale=event_scale)
    return {s: {"base": [base_per_bin] * N, "event": list(ev[s]["entries"])} for s in STATIONS}


@pytest.fixture
def demand():
    return make_demand()


@pytest.fixture
def heavy_demand():
    """A surge big enough that every intervention has crowding to act on."""
    return make_demand(base_per_bin=250.0, event_scale=2.0)


@pytest.fixture(autouse=True)
def _isolated_plan_cache(tmp_path, monkeypatch):
    """New plan-cache entries go to a temp folder, never into the committed data/demo_cache."""
    from apps.api.eventflow.agents import planner
    monkeypatch.setattr(planner, "CACHE_WRITE", tmp_path / "plan_cache_write")
