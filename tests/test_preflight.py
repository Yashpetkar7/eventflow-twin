"""Booth pre-flight (scripts/preflight.py): it must catch a missing LangGraph, which silently changed the engine."""
import builtins
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import preflight  # noqa: E402

from apps.api.eventflow.agents import engine  # noqa: E402


def test_pins_are_read_from_requirements(tmp_path):
    req = tmp_path / "r.txt"
    req.write_text("# c\nfastapi==1.2.3\nlanggraph==1.2.22   # note\nuvicorn[standard]==0.5\nopenai>=3\n", encoding="utf-8")
    assert preflight.pinned(req) == {"fastapi": "1.2.3", "langgraph": "1.2.22", "uvicorn": "0.5"}


def test_this_checkout_runs_the_langgraph_engine():
    bad, _ = preflight.checks(ports=False)       # CI has no node_modules or baked scene: only the code checks count here
    assert not [b for b in bad if "fallback engine" in b or "does not import" in b or "langgraph" in b]


def test_a_missing_langgraph_blocks_the_booth(monkeypatch):
    real = builtins.__import__

    def no_langgraph(name, *a, **k):
        if name.startswith("langgraph"):
            raise ImportError("blocked for the test")
        return real(name, *a, **k)
    monkeypatch.setattr(builtins, "__import__", no_langgraph)
    try:
        bad, _ = preflight.checks(ports=False)
    finally:
        monkeypatch.setattr(builtins, "__import__", real)
        engine._graph.cache_clear()
    assert any("fallback engine" in b for b in bad)
