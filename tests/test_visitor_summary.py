"""scripts/visitor_summary.py: counts people's decisions only, per Dubai day, in English and Arabic."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("visitor_summary", ROOT / "scripts/visitor_summary.py")
vs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vs)

WAY = {"type": "wayfinding_redirect", "params": {"from_station": "WTC", "to_station": "EMT", "share": 0.3, "hours": [15]}}
BUS = {"type": "shuttle_bus", "params": {"from_station": "WTC", "to_station": "EMT", "buses": 4, "hours": [15]}}


def rec(day, user, decision, ivs, title="x"):
    return {"timestamp": f"{day}T10:15:00+04:00", "user": user, "decision": decision, "interventions": ivs, "option_title": title}


def test_summary_skips_the_guided_demo_and_other_days(tmp_path):
    log = tmp_path / "decisions_log.jsonl"
    rows = [rec("2026-11-18", "visitor", "approve", [WAY], "Wayfinding only"),
            rec("2026-11-18", "visitor", "approve", [WAY, BUS], "Wayfinding + shuttles"),
            rec("2026-11-18", "visitor", "reject", [BUS]),
            rec("2026-11-18", "guided-demo", "approve", [BUS]),       # automatic: not a visitor
            rec("2026-11-17", "visitor", "approve", [BUS])]           # another day
    log.write_text("\n".join(json.dumps(r) for r in rows) + "\n{torn line", encoding="utf-8")
    s = vs.summarise(vs.load(log), "2026-11-18")
    assert (s["decisions"], s["approved"], s["rejected"]) == (3, 2, 1)
    assert s["top_action"] == "wayfinding_redirect" and s["busiest_hour"] == "10:00"
    en, ar = vs.sentence(s)
    assert "3 decisions: 2 plans approved, 1 rejected" in en and "wayfinding" in en
    assert "التوجيه" in ar


def test_empty_day_invites_visitors(tmp_path):
    en, ar = vs.sentence(vs.summarise([], "2026-11-18"))
    assert "be the first" in en and ar
