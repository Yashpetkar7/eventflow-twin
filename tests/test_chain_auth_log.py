"""The event chain, sign-in with roles and the tamper-evident decision log (decisions #131, #132)."""
import json
import secrets

import pytest
from fastapi.testclient import TestClient

from apps.api.eventflow import main, store as store_mod
from apps.api.eventflow.agents import planner

DOWNTOWN = {"event_id": "downtown_night"}


@pytest.fixture
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DECISIONS_LOG", tmp_path / "decisions_log.jsonl")
    monkeypatch.setattr(planner, "CACHE_WRITE", tmp_path / "cache")
    monkeypatch.setenv("DEMO_MODE", "offline")
    store_mod.reset_store(store_mod.Store(str(tmp_path / "test.db")))
    yield TestClient(main.app)
    store_mod.reset_store(None)


# ---------------------------------------------------------------- the event chain
def test_the_chain_triggers_itself_until_a_human_is_needed(c):
    r = c.post("/chain/start", json={"forecast": DOWNTOWN})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["status"] == "awaiting_human"
    topics = [(e["topic"], e["publisher"], e["subscribers"]) for e in s["events"]]
    assert topics == [("scenario.loaded", "human", ["watcher"]), ("alert.raised", "watcher", ["supervisor"]),
                      ("plan.ready", "supervisor", ["human"])]
    inbox = s["inbox"]
    assert inbox["mission"]["engine"] in ("graph", "seq") and inbox["recommended_rank"] == inbox["mission"]["recommended_rank"]
    assert s["applied"] == [], "nothing is applied before a human decides"
    assert c.get(f"/chain/{s['chain_id']}").json()["events"] == s["events"], "the chain is stored and can be read back"


def test_a_decision_is_logged_then_triggers_messenger_and_watcher(c):
    s = c.post("/chain/start", json={"forecast": DOWNTOWN}).json()
    plan_id = s["inbox"]["mission"]["plan"]["plan_id"]
    s2 = c.post(f"/chain/{s['chain_id']}/decide", json={"decision": "approve"}).json()
    after = [(e["topic"], e["publisher"]) for e in s2["events"][len(s["events"]):]]
    assert after[0] == ("decision.made", "human") and after[1] == ("drafts.ready", "messenger")
    assert after[2][0] in ("alert.raised", "day.ended") and after[2][1] == "watcher"
    log = [json.loads(x) for x in main.DECISIONS_LOG.read_text(encoding="utf-8").splitlines()]
    assert log[-1]["plan_id"] == plan_id and log[-1]["decision"] == "approve", "the decision was logged before it took effect"
    assert s2["applied"] and s2["drafts"] and s2["drafts"][0]["sent"] is False


def test_the_chain_works_the_day_to_its_end(c):
    s = c.post("/chain/start", json={"forecast": DOWNTOWN}).json()
    for _ in range(12):
        if s["status"] != "awaiting_human":
            break
        s = c.post(f"/chain/{s['chain_id']}/decide", json={"decision": "approve"}).json()
    assert s["status"] == "ended" and s["ended_reason"] in ("clear", "residual")
    assert s["events"][-1]["topic"] == "day.ended"
    assert [e["seq"] for e in s["events"]] == list(range(1, len(s["events"]) + 1))


def test_a_rejection_raises_no_alert_twice(c):
    s = c.post("/chain/start", json={"forecast": DOWNTOWN}).json()
    first = {a["key"] for a in s["inbox"]["alerts"]}
    s2 = c.post(f"/chain/{s['chain_id']}/decide", json={"decision": "reject"}).json()
    assert not s2["applied"] and first <= set(s2["handled"])
    if s2["inbox"]:
        assert not first & {a["key"] for a in s2["inbox"]["alerts"]}


def test_deciding_on_a_chain_that_is_not_waiting_is_refused(c):
    s = c.post("/chain/start", json={"forecast": {"event_id": "gitex2025_d1"}}).json()
    if s["status"] == "ended":
        assert c.post(f"/chain/{s['chain_id']}/decide", json={"decision": "approve"}).status_code == 409
    assert c.post("/chain/chain_nope/decide", json={"decision": "approve"}).status_code == 404


# ---------------------------------------------------------------- sign-in and roles
def test_auth_is_off_by_default(c):
    assert c.get("/auth/me").json() == {"auth": "off", "user": None}


def test_roles_with_auth_on(c, monkeypatch):
    monkeypatch.setenv("EVENTFLOW_AUTH", "on")
    pw_admin, pw_view = secrets.token_urlsafe(12), secrets.token_urlsafe(12)       # generated test values only
    assert c.post("/auth/register", json={"username": "duty-admin", "password": pw_admin}).json()["role"] == "admin"
    assert c.post("/auth/register", json={"username": "someone", "password": pw_view, "role": "viewer"}).status_code == 403
    tok = c.post("/auth/login", json={"username": "duty-admin", "password": pw_admin}).json()["token"]
    adm = {"Authorization": f"Bearer {tok}"}
    assert c.post("/auth/register", json={"username": "viewer1", "password": pw_view, "role": "viewer"}, headers=adm).status_code == 200
    vt = c.post("/auth/login", json={"username": "viewer1", "password": pw_view}).json()["token"]
    view = {"Authorization": f"Bearer {vt}"}
    body = {"plan_id": "plan_x", "option_rank": 1, "decision": "approve"}
    assert c.post("/decisions", json=body).status_code == 401
    assert c.post("/decisions", json=body, headers=view).status_code == 403
    assert c.post("/decisions", json=body, headers=adm).status_code == 200
    assert json.loads(main.DECISIONS_LOG.read_text(encoding="utf-8").splitlines()[-1])["signed_in"] == "duty-admin"
    assert c.post("/auth/login", json={"username": "viewer1", "password": "wrong-password"}).status_code == 401
    c.post("/auth/logout", headers=view)
    assert c.get("/auth/me", headers=view).json()["user"] is None, "a revoked token no longer works"


def test_passwords_are_stored_hashed(c, monkeypatch):
    monkeypatch.setenv("EVENTFLOW_AUTH", "on")
    pw = secrets.token_urlsafe(12)
    c.post("/auth/register", json={"username": "duty-admin", "password": pw})
    stored = store_mod.store().get("users", "duty-admin")
    assert pw not in json.dumps(stored) and stored["pw"].startswith("pbkdf2_sha256$")


# ---------------------------------------------------------------- tamper-evident log (WP5)
def _decide(c, n=3):
    for i in range(n):
        assert c.post("/decisions", json={"plan_id": f"plan_{i}", "option_rank": 1, "decision": "approve"}).status_code == 200


def test_the_log_verifies(c):
    _decide(c)
    assert c.get("/decisions/verify").json() == {"ok": True, "records": 3, "chained": 3, "unchained": 0, "first_bad": None}


def test_an_edited_line_breaks_the_chain_at_that_line(c):
    _decide(c)
    lines = main.DECISIONS_LOG.read_text(encoding="utf-8").splitlines()
    rec = json.loads(lines[1])
    rec["decision"] = "reject"
    lines[1] = json.dumps(rec, ensure_ascii=False)
    main.DECISIONS_LOG.write_text("\n".join(lines) + "\n", encoding="utf-8")
    v = c.get("/decisions/verify").json()
    assert v["ok"] is False and v["first_bad"] == 2


def test_a_deleted_line_is_detected(c):
    _decide(c)
    lines = main.DECISIONS_LOG.read_text(encoding="utf-8").splitlines()
    main.DECISIONS_LOG.write_text("\n".join([lines[0], lines[2]]) + "\n", encoding="utf-8")
    assert c.get("/decisions/verify").json()["first_bad"] == 2


def test_old_records_are_unchained_not_broken(c):
    main.DECISIONS_LOG.write_text(json.dumps({"decision_id": "dec_old", "decision": "approve"}) + "\n", encoding="utf-8")
    _decide(c, 2)
    v = c.get("/decisions/verify").json()
    assert v["ok"] and v["unchained"] == 1 and v["chained"] == 2
