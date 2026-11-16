"""Agent trace (WP4, decision #136): spans derived from the events, and the optional OpenTelemetry export."""
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main, tracing
from apps.api.eventflow.agents import planner

SPEC = {"event_id": "downtown_night"}


@pytest.fixture
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "decisions_log.jsonl")
    monkeypatch.setattr(planner, "CACHE_WRITE", tmp_path / "cache")
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    return TestClient(main.app)


def mission(c, engine=None):
    if engine:
        os.environ["AGENTS_ENGINE"] = engine
    try:
        fc = c.post("/forecast", json=SPEC).json()
        return c.post("/agent/run", json={"forecast_run_id": fc["run_id"], "forecast": SPEC, "scope": "corridor"}).json()
    finally:
        os.environ.pop("AGENTS_ENGINE", None)


def test_spans_cover_every_event_in_order(c):
    m = mission(c)
    sp = m["spans"]
    assert sum(s["events"] for s in sp) == len(m["events"])
    assert [k for s in sp for k in s["keys"]] == [e["key"] for e in m["events"]]
    # parallel agents (the four specialists; explainer and stress test) keep their own clock, so spans may overlap
    assert all(s["end_ms"] >= s["start_ms"] >= 0 for s in sp)
    assert {s["agent"] for s in sp} >= {"supervisor", "rail", "station_crowd", "venue", "last_mile", "composer", "critic", "verifier"}
    sims = {e["run_id"] for e in m["events"] if e["key"] == "simulation.result"}
    assert sims <= {r for s in sp for r in s["run_ids"]}, "every simulator run is on a span"


def test_graph_and_sequence_give_the_same_spans_apart_from_timings(c):
    strip = lambda sp: [{k: v for k, v in s.items() if k not in ("start_ms", "end_ms")} for s in sp]     # noqa: E731
    assert strip(mission(c, "graph")["spans"]) == strip(mission(c, "seq")["spans"])


def test_no_export_without_an_endpoint(c):
    assert tracing.export_mission(mission(c)) is False


class _Collector(BaseHTTPRequestHandler):
    got: list[bytes] = []

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("content-length", 0))
        _Collector.got.append((self.path, self.rfile.read(n)))
        self.send_response(200)
        self.send_header("content-type", "application/x-protobuf")
        self.end_headers()

    def log_message(self, *a):
        pass


def test_spans_are_exported_to_an_otlp_collector(c, monkeypatch):
    pytest.importorskip("opentelemetry.sdk")
    srv = HTTPServer(("127.0.0.1", 0), _Collector)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        _Collector.got = []
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", f"http://127.0.0.1:{srv.server_port}")
        tracing._tracer.cache_clear()
        m = mission(c)                               # /agent/run exports when the endpoint is set
        assert _Collector.got, "the collector received the trace"
        assert all(p == "/v1/traces" for p, _ in _Collector.got)
        body = b"".join(b for _, b in _Collector.got)
        assert b"mission" in body and m["mission_id"].encode() in body and b"critic" in body
    finally:
        srv.shutdown()
        tracing._tracer.cache_clear()
