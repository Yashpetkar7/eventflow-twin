"""Operations and riders (decision #140): registered events start the chain, the inbox, rider notices only after an
approval, alert notifications only when configured, and rider travel advice from the simulator."""
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main, store as store_mod
from apps.api.eventflow.agents import planner

CONCERT = {"name": "Concert at Coca-Cola Arena", "near_station": "BBY", "date": "2026-12-04", "start": "19:00", "end": "22:30",
           "attendance": 17000}


@pytest.fixture
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "decisions_log.jsonl")
    monkeypatch.setattr(planner, "CACHE_WRITE", tmp_path / "cache")
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("EVENTFLOW_AUTH", raising=False)
    store_mod.reset_store(store_mod.Store(str(tmp_path / "t.db")))
    yield TestClient(main.app)
    store_mod.reset_store(None)


def register(c, **kw):
    r = c.post("/events/register", json={**CONCERT, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_a_registered_event_starts_the_chain_and_lands_in_the_inbox(c):
    ev = register(c)
    assert ev["chain_status"] == "awaiting_human" and ev["forecast"]["custom_event"]["near_station"] == "BBY"
    items = c.get("/inbox").json()["items"]
    assert len(items) == 1 and items[0]["chain_id"] == ev["chain_id"] and items[0]["event"] == CONCERT["name"]
    assert items[0]["after"] <= items[0]["before"] and items[0]["is_synthetic"]
    assert c.get("/events/registered").json()[0]["event_key"] == ev["event_key"]


def test_after_a_decision_the_inbox_empties_and_the_event_follows_its_chain(c):
    ev = register(c)
    c.post(f"/chain/{ev['chain_id']}/decide", json={"decision": "approve"})
    assert c.get("/inbox").json()["items"] == []
    assert c.get("/events/registered").json()[0]["chain_status"].startswith(("ended", "awaiting"))


def test_without_auto_chain_nothing_starts(c):
    ev = register(c, auto_chain=False)
    assert ev["chain_id"] is None and c.get("/inbox").json()["items"] == []


def test_bad_events_are_refused_with_a_reason(c):
    r = c.post("/events/register", json={**CONCERT, "near_station": "NOPE"})
    assert r.status_code == 422 and "unknown station" in r.text
    r = c.post("/events/register", json={**CONCERT, "start": "23:00", "end": "22:00"})
    assert r.status_code == 422 and "after start" in r.text


def test_csv_import_reports_each_bad_row(c):
    csv = ("name,near_station,date,start,end,attendance,venue\n"
           "Expo talk,FIC,2026-12-05,18:00,21:00,9000,DIFC\n"
           "Typo,NOPE,2026-12-05,18:00,21:00,9000,\n"
           "No count,FIC,2026-12-05,18:00,21:00,lots,\n")
    r = c.post("/events/import", json={"csv": csv, "auto_chain": False}).json()
    assert [e["name"] for e in r["created"]] == ["Expo talk"] and r["created"][0]["venue"] == "DIFC"
    assert [e["line"] for e in r["errors"]] == [3, 4]
    assert c.post("/events/import", json={"csv": "a,b\n1,2\n"}).status_code == 422


def test_a_rider_notice_needs_an_approval_first(c):
    ev = register(c)
    assert c.post(f"/chain/{ev['chain_id']}/publish").status_code == 409          # nothing decided yet
    c.post(f"/chain/{ev['chain_id']}/decide", json={"decision": "reject"})
    assert c.post(f"/chain/{ev['chain_id']}/publish").status_code == 409          # rejected: nothing to publish
    assert c.get("/notices").json() == []


def test_publish_after_approval_and_the_rider_sees_it(c):
    ev = register(c)
    s = c.post(f"/chain/{ev['chain_id']}/decide", json={"decision": "approve"}).json()
    n = c.post(f"/chain/{ev['chain_id']}/publish").json()
    assert n["decision_id"] == s["decisions"][-1]["decision_id"] and n["text"]["en"]["notice"] and n["text"]["ar"]["notice"]
    assert "BBY" in n["stations"] and c.get("/notices").json()[0]["notice_id"] == n["notice_id"]
    a = c.post("/travel/advice", json={"forecast": ev["forecast"], "station": "BBY", "hour": 22}).json()
    assert a["notices"] and a["notices"][0]["notice_id"] == n["notice_id"]


def test_travel_advice_reads_the_simulator_and_the_approved_measures(c):
    ev = register(c)
    spec = ev["forecast"]
    before = c.post("/travel/advice", json={"forecast": spec, "station": "BBY", "hour": 22, "use_notices": False}).json()
    assert before["status"] in ("busy", "crowded") and before["now"]["load"] > before["threshold"]
    assert before["source"]["tool"] == "simulate" and before["is_synthetic"]
    assert all(a["walk_min"] <= 25 for a in before["alternatives"])
    c.post(f"/chain/{ev['chain_id']}/decide", json={"decision": "approve"})
    c.post(f"/chain/{ev['chain_id']}/publish")
    after = c.post("/travel/advice", json={"forecast": spec, "station": "BBY", "hour": 22}).json()
    assert after["now"]["load"] < before["now"]["load"], "the published plan's measures are in the advice"
    assert after["source"]["run_id"] != before["source"]["run_id"]
    assert c.post("/travel/advice", json={"forecast": spec, "station": "NOPE", "hour": 22}).status_code == 422


class _Hook(BaseHTTPRequestHandler):
    got: list[dict] = []

    def do_POST(self):  # noqa: N802
        _Hook.got.append(json.loads(self.rfile.read(int(self.headers["content-length"]))))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *a):
        pass


def test_a_decision_needed_notification_goes_to_the_configured_webhook_only(c, monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), _Hook)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        _Hook.got = []
        register(c, name="Unnotified")                                        # no webhook configured: nothing sent
        assert _Hook.got == []
        monkeypatch.setenv("NOTIFY_WEBHOOK_URL", f"http://127.0.0.1:{srv.server_port}/hook")
        ev = register(c)
        kinds = [g["eventflow"]["kind"] for g in _Hook.got]
        assert kinds == ["decision_needed"] and ev["chain_id"] == _Hook.got[0]["eventflow"]["chain_id"]
        assert "nothing is applied until you do" in _Hook.got[0]["text"]
        c.post(f"/chain/{ev['chain_id']}/decide", json={"decision": "approve"})
        assert [g["eventflow"]["kind"] for g in _Hook.got][-1] in ("day_ended", "decision_needed")
    finally:
        srv.shutdown()


def test_with_auth_on_registering_and_publishing_need_the_planner_role(c, monkeypatch):
    monkeypatch.setenv("EVENTFLOW_AUTH", "on")
    assert c.post("/events/register", json=CONCERT).status_code == 401
    assert c.get("/inbox").status_code == 401
    pw = secrets.token_urlsafe(12)                                             # generated test value only
    c.post("/auth/register", json={"username": "duty-admin", "password": pw})
    tok = c.post("/auth/login", json={"username": "duty-admin", "password": pw}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    ev = c.post("/events/register", json=CONCERT, headers=h).json()
    assert ev["registered_by"] == "duty-admin" and c.get("/inbox", headers=h).json()["items"]
    assert c.post(f"/chain/{ev['chain_id']}/publish").status_code == 401
    assert c.get("/notices").status_code == 200, "rider notices are public"


def test_travel_advice_works_on_a_cold_instance(c):
    """Found in the browser after an API restart: the rider page asked for a run no instance remembered."""
    ev = register(c)
    main._RUNS.clear()                                                     # another instance, or a restart
    r = c.post("/travel/advice", json={"forecast": ev["forecast"], "station": "BBY", "hour": 22})
    assert r.status_code == 200, r.text
    main._RUNS.clear()
    assert c.post("/chain/start", json={"forecast": ev["forecast"]}).status_code == 200
