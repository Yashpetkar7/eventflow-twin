"""Contract drift guard: the committed OpenAPI, TS types and fixtures must match the code.
If this fails, run `python scripts/export_contract.py` and regenerate contract/api-types.ts (see that script)."""
import json
from pathlib import Path

import pytest

from apps.api.eventflow import main
from apps.api.eventflow.schemas import (CONTRACT_VERSION, AgentPlanResponse, DecisionResponse, Event,
                                        ForecastResponse, SimulateResponse, Station)

CONTRACT = Path(__file__).resolve().parents[1] / "contract"
FIXTURES = CONTRACT / "fixtures"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_openapi_matches_code():
    assert load(CONTRACT / "openapi.json") == json.loads(json.dumps(main.app.openapi())), "contract drift: re-export"


def test_version_file():
    assert (CONTRACT / "VERSION").read_text(encoding="utf-8").strip() == CONTRACT_VERSION


def test_api_types_generated():
    assert "SimSummary" in (CONTRACT / "api-types.ts").read_text(encoding="utf-8")


@pytest.mark.parametrize("name,model", [
    ("forecast_dfw2026_d1.json", ForecastResponse),
    ("forecast_dfw2026_d1_attendance30000.json", ForecastResponse),
    ("simulate_baseline.json", SimulateResponse),
    ("simulate_option.json", SimulateResponse),
    ("agent_plan.json", AgentPlanResponse),
    ("decision_response.json", DecisionResponse),
])
def test_fixture_validates(name, model):
    model.model_validate(load(FIXTURES / name))


def test_list_fixtures_validate():
    assert [Station.model_validate(s) for s in load(FIXTURES / "stations.json")]
    assert [Event.model_validate(e) for e in load(FIXTURES / "events.json")]
