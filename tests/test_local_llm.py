"""The self-hosted model provider (LLM_PROVIDER=local, decision #135): an OpenAI-compatible server such as vLLM or
Ollama on the college's GPUs. Tested against a stand-in server on 127.0.0.1 that records what it was sent."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from apps.api.eventflow.agents import llm


class _Server(BaseHTTPRequestHandler):
    seen: list[dict] = []
    reply = {"bundles": []}

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        _Server.seen.append({"path": self.path, "body": body})
        out = {"id": "x", "object": "chat.completion", "created": 0, "model": body["model"],
               "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(_Server.reply)}}],
               "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}}
        b = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


@pytest.fixture
def server(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), _Server)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _Server.seen = []
    monkeypatch.setenv("LLM_PROVIDER", "local")
    monkeypatch.setenv("LLM_BASE_URL", f"http://127.0.0.1:{srv.server_port}/v1")
    yield srv
    srv.shutdown()


def test_local_provider_sends_a_json_schema_request_and_parses_the_answer(server):
    c = llm.make_client("qwen-test")
    assert c is not None and c.provider == "local" and llm.display_name(c) == "Local qwen-test"
    _Server.reply = {"bundles": [{"label": "a", "interventions": []}]}
    got = c.complete_json(system="S", user="U", schema=llm.PROPOSER_SCHEMA, effort="low", max_tokens=500)
    assert got == _Server.reply
    req = _Server.seen[-1]
    assert req["path"] == "/v1/chat/completions"
    assert req["body"]["response_format"]["type"] == "json_schema" and req["body"]["temperature"] == 0
    assert [m["role"] for m in req["body"]["messages"]] == ["system", "user"]
    assert c.last_usage == {"input_tokens": 11, "output_tokens": 7}


def test_local_provider_needs_a_base_url(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "local")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    assert llm.make_client("qwen-test") is None


def test_an_unreachable_server_is_reported_not_raised_as_a_crash(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "local")
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:9/v1")      # nothing listens on port 9
    c = llm.LocalLLM("qwen-test", timeout=2, max_retries=0)
    with pytest.raises(llm.LLMUnavailable):
        c.complete_json(system="S", user="U", schema=llm.PROPOSER_SCHEMA, effort="low", max_tokens=100)


def test_the_gpu_benchmark_measures_a_self_hosted_model(server, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from apps.api.eventflow import main
    from apps.api.eventflow.agents import planner
    from eval.suites import gpu_benchmark
    monkeypatch.setattr(planner, "CACHE_WRITE", tmp_path)
    monkeypatch.setenv("LLM_MODEL", "qwen-test")
    _Server.reply = {"bundles": []}
    m = gpu_benchmark.model_calls(TestClient(main.app), 3)
    assert m["llm_model"] == "Local qwen-test" and m["llm_calls"] == 3 and m["llm_schema_valid"] == 1.0
    assert m["llm_p95_s"] >= m["llm_p50_s"] >= 0
    assert all(s["path"] == "/v1/chat/completions" for s in _Server.seen)
