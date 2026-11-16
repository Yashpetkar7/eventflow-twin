"""Duty-manager operations (decision #140): registered events that start the event chain by themselves, the approval
inbox, rider notices published after an approval, and alert notifications.

    register an event (form or CSV)  ──►  chain starts (Watcher → team → inbox)  ──►  notification "decision needed"
    duty manager approves on a phone ──►  Messenger drafts  ──►  "Publish to riders"  ──►  /travel shows the notice

Rules kept: a notification only says that a decision is waiting (it never applies anything); a rider notice exists
only after a logged approval and an explicit publish by a planner; every figure in it is the Messenger's, which
re-simulates (agents/agents_util.message_for). Notifications are OFF unless NOTIFY_WEBHOOK_URL is set (a Teams,
Slack or any incoming-webhook URL the operator configures); the booth sends nothing anywhere.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import logging
import os
import re
import urllib.request
import uuid

from fastapi import HTTPException

from .config import corridor, events
from .store import store

_LOG = logging.getLogger("eventflow.ops")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_IMPORT = 100
CSV_FIELDS = ["name", "near_station", "date", "start", "end", "attendance", "venue", "organiser"]


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------- events
def validate_event(e: dict) -> dict:
    """Clean one event (form or CSV row) or raise ValueError with a sentence a person can act on."""
    st = {s["id"] for s in corridor()["stations"]}
    name = str(e.get("name") or "").strip()
    if not 2 <= len(name) <= 120:
        raise ValueError("name: 2 to 120 characters")
    near = str(e.get("near_station") or "").strip().upper()
    if near not in st:
        raise ValueError(f"near_station: unknown station id {near!r} (use an id from GET /stations)")
    date = str(e.get("date") or "").strip()
    if not DATE.match(date):
        raise ValueError("date: YYYY-MM-DD")
    try:
        weekday = dt.date.fromisoformat(date).weekday()
    except ValueError as ex:
        raise ValueError("date: not a real date") from ex
    start, end = str(e.get("start") or "").strip(), str(e.get("end") or "").strip()
    if not (HHMM.match(start) and HHMM.match(end)):
        raise ValueError("start and end: HH:MM, 24-hour")
    if end <= start:
        raise ValueError("end must be after start on the same day")
    try:
        att = int(str(e.get("attendance") or "").replace(",", "").strip())
    except ValueError as ex:
        raise ValueError("attendance: a whole number") from ex
    if not 0 < att <= 200_000:
        raise ValueError("attendance: 1 to 200,000")
    return {"name": name, "near_station": near, "date": date, "start": start, "end": end, "attendance": att,
            "weekend": weekday >= 5, "venue": str(e.get("venue") or "").strip()[:120] or None,
            "organiser": str(e.get("organiser") or "").strip()[:120] or None}


def forecast_spec(ev: dict) -> dict:
    """The forecast request for a registered event: the build-your-own event model at its station (an assumption,
    labelled as such everywhere the custom event appears)."""
    return {"date": ev["date"], "custom_event": {"near_station": ev["near_station"], "start": ev["start"], "end": ev["end"],
                                                 "weekend": ev["weekend"], "attendance": ev["attendance"]}}


def save_event(ev: dict, owner: str | None) -> dict:
    doc = {"event_key": f"evt_{uuid.uuid4().hex[:10]}", **ev, "forecast": forecast_spec(ev), "registered": _now(),
           "registered_by": owner, "chain_id": None, "chain_status": None}
    store().put("events", doc["event_key"], doc, owner=owner)
    return doc


def parse_csv(text: str) -> tuple[list[dict], list[dict]]:
    """(valid events, errors with their line number). Header row required; extra columns are ignored."""
    if len(text) > 200_000:
        raise HTTPException(413, "CSV larger than 200 kB")
    rdr = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not rdr.fieldnames or not {"name", "near_station", "date", "start", "end", "attendance"} <= {f.strip().lower() for f in rdr.fieldnames}:
        raise HTTPException(422, f"CSV header must include: {', '.join(CSV_FIELDS[:6])} (optional: venue, organiser)")
    good, bad = [], []
    for i, row in enumerate(rdr, start=2):
        if i - 1 > MAX_IMPORT:
            bad.append({"line": i, "error": f"more than {MAX_IMPORT} rows: the rest was not read"})
            break
        row = {(k or "").strip().lower(): v for k, v in row.items()}
        try:
            good.append(validate_event(row))
        except ValueError as e:
            bad.append({"line": i, "error": str(e)})
    return good, bad


# ---------------------------------------------------------------- inbox
def inbox(limit: int = 50) -> list[dict]:
    """Chains waiting for a decision, newest first, in a form a phone can show."""
    out = []
    for row in store().list("chains", limit=200):
        st = store().get("chains", row["id"])
        if not st or st.get("status") != "awaiting_human" or not st.get("inbox"):
            continue
        ib, m = st["inbox"], st["inbox"]["mission"]
        rec = next((o for o in m["plan"]["options"] if o["rank"] == ib.get("recommended_rank")), m["plan"]["options"][0])
        a0 = (ib.get("alerts") or [{}])[0]
        eid = st["request"]["forecast"].get("event_id")
        label = st["request"].get("label") or next((e["name"] for e in events() if e["id"] == eid), eid)
        out.append({"chain_id": st["chain_id"], "updated": row["updated"], "event": label,
                    "event_key": st["request"].get("event_key"), "station": a0.get("station"), "crosses_at": a0.get("crosses_at"),
                    "hour": ib.get("hour"), "recommended_rank": rec["rank"], "title": rec["title"], "what": rec.get("what"),
                    "before": ib["baseline"]["overcap_station_hours"], "after": rec["summary"]["overcap_station_hours"],
                    "basis": (m.get("recommendation") or {}).get("basis"), "options": len(m["plan"]["options"]),
                    "is_synthetic": m["is_synthetic"]})
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------- rider notices
def publish(state: dict, by: str | None) -> dict:
    """A rider notice from the chain's last approval: only after a logged approval with the Messenger's drafts."""
    if not state.get("decisions") or state["decisions"][-1]["decision"] != "approve":
        raise HTTPException(409, "publish needs an approved plan: approve the recommendation first")
    if not state.get("drafts"):
        raise HTTPException(409, "the Messenger has no drafts for this approval")
    d, dec = state["drafts"][-1], state["decisions"][-1]
    ivs = next((e["payload"]["interventions"] for e in reversed(state["events"]) if e["topic"] == "decision.made"), [])
    # the stations a notice is about; empty for a line-wide measure only (extra trains, extended hours)
    stations = sorted({p for iv in ivs for p in (iv["params"].get("station"), iv["params"].get("from_station"), iv["params"].get("to_station")) if p})
    key = f"ntc_{uuid.uuid4().hex[:10]}"
    doc = {"notice_id": key, "published": _now(), "published_by": by, "chain_id": state["chain_id"], "decision_id": dec["decision_id"],
           "plan_id": dec["plan_id"], "title": dec["title"], "stations": stations, "forecast_run_id": state["forecast_run_id"],
           "forecast": state["request"]["forecast"], "applied": state["applied"], "event": state["request"].get("label"),
           "text": {loc: {"notice": d["drafts"][loc]["notice"], "sign": d["drafts"][loc]["sign"]} for loc in ("en", "ar") if loc in d.get("drafts", {})},
           "numbers_checked": d.get("numbers_checked"), "status": "published"}
    store().put("notices", key, doc, owner=by)
    return doc


def notices(max_age_h: float, forecast_run_id: str | None = None) -> list[dict]:
    cut = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=max_age_h)
    out = []
    for row in store().list("notices", limit=200):
        n = store().get("notices", row["id"])
        if not n or n.get("status") != "published" or dt.datetime.fromisoformat(n["published"]) < cut:
            continue
        if forecast_run_id and n["forecast_run_id"] != forecast_run_id:
            continue
        out.append(n)
    return out


# ---------------------------------------------------------------- notifications
def notify(kind: str, text: str, payload: dict) -> bool:
    """POST {"text", "eventflow"} to NOTIFY_WEBHOOK_URL. Off when unset; never raises; returns whether it was sent."""
    url = os.environ.get("NOTIFY_WEBHOOK_URL", "").strip()
    if not url:
        return False
    body = json.dumps({"text": text, "eventflow": {"kind": kind, **payload}}, ensure_ascii=False, default=str).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=4) as r:
            return 200 <= r.status < 300
    except Exception as e:  # noqa: BLE001 - a notification must never take a chain down
        _LOG.warning("notification not sent: %s", e)
        return False


def notify_chain(state: dict, since: int) -> list[str]:
    """Notifications for the chain events after `since`: a decision waiting, or the day ended."""
    sent = []
    label = state["request"].get("label") or state["request"]["forecast"].get("event_id") or "scenario"
    for e in state["events"][since:]:
        if e["topic"] == "plan.ready" and e["payload"].get("options"):
            a = (state.get("inbox") or {}).get("alerts") or [{}]
            txt = (f"EventFlow: decision needed for {label} — {a[0].get('station', '?')} crosses the line at "
                   f"{a[0].get('crosses_at', '?')}:00. The team recommends option {e['payload'].get('recommended_rank')}. "
                   f"Open the inbox to approve or reject (nothing is applied until you do).")
            if notify("decision_needed", txt, {"chain_id": state["chain_id"], "seq": e["seq"]}):
                sent.append("decision_needed")
        elif e["topic"] == "day.ended":
            txt = f"EventFlow: {label} — the chain ended ({e['payload'].get('reason')})."
            if notify("day_ended", txt, {"chain_id": state["chain_id"], "seq": e["seq"]}):
                sent.append("day_ended")
    return sent
