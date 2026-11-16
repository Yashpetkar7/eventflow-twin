"""Agent trace: one span per agent step, and an optional OpenTelemetry export (docs/17 WP4, decision #133).

`spans(events)` derives the spans from the mission's ordered events (no second timing source): consecutive events of
the same agent in the same round are one step. Graph and sequential engines give the same spans apart from timings.

Export is OFF unless OTEL_EXPORTER_OTLP_ENDPOINT is set (the booth is offline; nothing leaves the machine by default).
Any OTLP/HTTP collector works; for Langfuse (self-hosted with docker compose --profile observability, or Langfuse
Cloud) set

    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3001/api/public/otel
    OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 of public_key:secret_key>

The OpenTelemetry packages are an extra (requirements-saas.txt), imported only when exporting.
"""
from __future__ import annotations

import logging
import os
import time
from functools import lru_cache

_LOG = logging.getLogger("eventflow.tracing")


def spans(events: list[dict]) -> list[dict]:
    """[{agent, layer, round, start_ms, end_ms, kind, keys, run_ids, llm, to, events}] in order."""
    out: list[dict] = []
    for e in events:
        cur = out[-1] if out else None
        if cur is None or cur["agent"] != e["agent"] or cur["round"] != e["round"]:
            cur = {"agent": e["agent"], "layer": e["layer"], "round": e["round"], "start_ms": e["t_ms"], "end_ms": e["t_ms"],
                   "kind": e["kind"], "keys": [], "run_ids": [], "llm": False, "to": [], "events": 0}
            out.append(cur)
        cur["end_ms"] = max(cur["end_ms"], e["t_ms"])
        cur["keys"].append(e["key"])
        cur["events"] += 1
        if e.get("run_id") and e["run_id"] not in cur["run_ids"]:
            cur["run_ids"].append(e["run_id"])
        for r in (e.get("params") or {}).get("run_ids") or []:
            if isinstance(r, str) and r not in cur["run_ids"]:
                cur["run_ids"].append(r)
        cur["llm"] = cur["llm"] or bool(e.get("llm"))
        for t in e.get("to") or []:
            if t not in cur["to"]:
                cur["to"].append(t)
    # a step lasts until the next one starts (events are instants; the work happened between them)
    for a, b in zip(out, out[1:]):
        a["end_ms"] = max(a["end_ms"], b["start_ms"])
    return out


def enabled() -> bool:
    return bool(os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip())


@lru_cache(maxsize=1)
def _tracer():
    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    provider = TracerProvider(resource=Resource.create({"service.name": os.environ.get("OTEL_SERVICE_NAME", "eventflow-twin")}))
    ep = os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"].rstrip("/")
    provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(endpoint=ep if ep.endswith("/v1/traces") else ep + "/v1/traces")))
    return provider.get_tracer("eventflow.agents")


def export_mission(m: dict, wall_start_ns: int | None = None) -> bool:
    """Send one mission as a trace (root span + one child per agent step). Never raises: tracing must not take a
    mission down. Returns True when the spans were handed to the exporter."""
    if not enabled():
        return False
    try:
        from opentelemetry import trace
        tracer = _tracer()
    except Exception as e:  # noqa: BLE001 - missing extra or bad endpoint: log once per call, keep serving
        _LOG.warning("OpenTelemetry export skipped: %s", e)
        return False
    sp = m.get("spans") or spans(m.get("events", []))
    total_ms = max((s["end_ms"] for s in sp), default=0.0)
    t0 = wall_start_ns or (time.time_ns() - int(total_ms * 1e6))
    try:
        root = tracer.start_span("mission", start_time=t0, attributes={
            "eventflow.mission_id": m.get("mission_id", ""), "eventflow.engine": m.get("engine", ""), "eventflow.status": m.get("status", ""),
            "eventflow.stop_reason": m.get("stop_reason", ""), "eventflow.recommended_rank": m.get("recommended_rank") or 0,
            "eventflow.is_synthetic": bool(m.get("is_synthetic")), "langfuse.trace.name": "agent-mission"})
        ctx = trace.set_span_in_context(root)
        for s in sp:
            child = tracer.start_span(f"{s['agent']} (round {s['round']})", context=ctx, start_time=t0 + int(s["start_ms"] * 1e6), attributes={
                "eventflow.agent": s["agent"], "eventflow.layer": s["layer"], "eventflow.round": s["round"], "eventflow.kind": s["kind"],
                "eventflow.keys": s["keys"], "eventflow.run_ids": s["run_ids"], "eventflow.to": s["to"], "eventflow.llm": s["llm"]})
            child.end(end_time=t0 + int(max(s["end_ms"], s["start_ms"] + 0.01) * 1e6))
        root.end(end_time=t0 + int(total_ms * 1e6))
        return True
    except Exception as e:  # noqa: BLE001
        _LOG.warning("OpenTelemetry export failed: %s", e)
        return False
