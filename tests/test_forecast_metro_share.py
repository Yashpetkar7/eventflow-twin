"""ForecastRequest.metro_share (contract 1.9.0): a what-if share of event trips made by metro."""
from apps.api.eventflow.forecast import build_forecast


def _event_trips(run: dict) -> float:
    return sum(sum(d["event"]) for d in run["demand"].values())


def test_metro_share_scales_event_trips_and_wins_over_weather():
    base = build_forecast("gitex2025_d1")
    more = build_forecast("gitex2025_d1", metro_share=0.6)
    assert base["metro_share_used"] == 0.45 and more["metro_share_used"] == 0.6
    assert _event_trips(more) / _event_trips(base) == __import__("pytest").approx(0.6 / 0.45, rel=1e-6)
    assert more["run_id"] != base["run_id"]                                   # a different what-if is a different run
    both = build_forecast("gitex2025_d1", weather="hot", metro_share=0.3)
    assert both["metro_share_used"] == 0.3                                    # the explicit share wins over the hot-day share


def test_default_request_keeps_its_run_id():
    # the new field only enters the run id when used, so cached answers and fixtures stay valid
    assert build_forecast("gitex2025_d1")["run_id"] == build_forecast("gitex2025_d1", metro_share=None)["run_id"]
