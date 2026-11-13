"""Adds scenarios en11–en30 / ar11–ar30 to eval/gold/agents_scenarios.jsonl (run once; the file is then reviewed).

The parameter sets and goal texts below are written by hand. Two things are derived by code so they cannot be
typed wrong: the boundary scenarios sit just under and just over the corridor's break-point attendance
(POST /breakpoint), and every `expect` comes from the simulator alone ("options" exactly when riders exceed the
threshold with the already-approved measures applied) — never from the planner being tested.
Usage: python scripts/extend_gold.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402

GOLD = ROOT / "eval/gold/agents_scenarios.jsonl"
c = TestClient(main.app)


def brk(event_id: str) -> int:
    spec = {"event_id": event_id}
    fc = c.post("/forecast", json=spec).json()
    return c.post("/breakpoint", json={"forecast_run_id": fc["run_id"], "forecast": spec, "threshold": 0.85}).json()["corridor_break_attendance"]


G, D = brk("gitex2025_d1"), brk("dfw2026_d1")
WAY = {"type": "wayfinding_redirect", "params": {"from_station": "WTC", "to_station": "EMT", "share": 0.35, "hours": [15, 16]}}
# (forecast, threshold, priority, applied, split, tag, goal_en, goal_ar)
SETS = [
    ({"event_id": "gitex2025_d1", "attendance": G - 200}, 0.85, "balanced", [], "dev", "boundary_under",
     "Is the corridor still comfortable at this crowd size?", "هل يبقى المسار مريحًا عند هذا العدد من الزوار؟"),
    ({"event_id": "gitex2025_d1", "attendance": G + 200}, 0.85, "balanced", [], "test", "boundary_over",
     "We are just past the limit. What is the lightest fix?", "تجاوزنا الحد بقليل. ما أخف إجراء ممكن؟"),
    ({"event_id": "dfw2026_d1", "attendance": D - 200}, 0.85, "cost", [], "dev", "boundary_under",
     "Check whether any station needs help tonight.", "تحقق مما إذا كانت أي محطة تحتاج إلى دعم الليلة."),
    ({"event_id": "dfw2026_d1", "attendance": D + 200}, 0.85, "cost", [], "test", "boundary_over",
     "Only a few riders are over the line. Keep it cheap.", "عدد قليل من الركاب فوق الحد. اجعل الحل قليل التكلفة."),
    ({"event_id": "gitex2025_d1"}, 0.7, "balanced", [], "dev", "strict_threshold",
     "Hold every platform under 70% for a VIP visit.", "أبقِ كل الأرصفة تحت 70% بسبب زيارة رسمية."),
    ({"event_id": "gitex2025_d1", "weather": "hot"}, 0.95, "balanced", [], "dev", "loose_threshold",
     "We can accept up to 95% load today. Anything to do?", "نقبل اليوم حمولة حتى 95%. هل يلزم أي إجراء؟"),
    ({"event_id": "dfw2026_d1", "attendance": 30000}, 0.9, "balanced", [], "dev", "threshold",
     "Plan the exit for a larger closing ceremony.", "خطِّط للخروج بعد حفل ختام أكبر من المعتاد."),
    ({"event_id": "downtown_night"}, 0.95, "impact", [], "dev", "loose_threshold",
     "Clear the platforms as fast as possible after the show.", "أخلِ الأرصفة بأسرع ما يمكن بعد العرض."),
    ({"event_id": "gitex2025_d1", "metro_share": 0.65}, 0.85, "cost", [], "test", "metro_share",
     "Parking is restricted, so more visitors take the metro. What now?", "المواقف مقيَّدة فيزداد ركاب المترو. ما العمل؟"),
    ({"event_id": "gitex2025_d1", "metro_share": 0.35}, 0.85, "balanced", [], "dev", "metro_share",
     "Most visitors drive today. Do the stations need anything?", "معظم الزوار يأتون بالسيارات اليوم. هل تحتاج المحطات إلى شيء؟"),
    ({"event_id": "downtown_night", "exit_sigma_min": 60}, 0.85, "balanced", [], "dev", "exit_window",
     "The venue will release the crowd slowly. Is that enough?", "سيُخرج المنظمون الجمهور على مهل. هل يكفي ذلك؟"),
    ({"event_id": "dfw2026_d1", "attendance": 30000, "exit_sigma_min": 15}, 0.85, "impact", [], "dev", "exit_window",
     "Everyone leaves at once. Protect the nearest station.", "يغادر الجميع دفعة واحدة. احمِ أقرب محطة."),
    ({"custom_event": {"near_station": "BBY", "start": "19:00", "end": "22:00", "weekend": True, "attendance": 30000}}, 0.85,
     "balanced", [], "test", "custom_event",
     "A new concert next to Business Bay: what should operations prepare?", "حفل جديد قرب الخليج التجاري: ماذا تجهّز العمليات؟"),
    ({"custom_event": {"near_station": "FIC", "start": "09:00", "end": "17:00", "weekend": False, "attendance": 8000}}, 0.85,
     "balanced", [], "dev", "custom_event",
     "A small conference near Financial Centre. Any crowding risk?", "مؤتمر صغير قرب المركز المالي. هل من خطر ازدحام؟"),
    ({"event_id": "gitex2025_d1", "weather": "rain", "demand_level": "real_totals"}, 0.85, "balanced", [], "dev", "real_totals",
     "Use the real station totals and plan for a rainy day.", "استخدم الأعداد الحقيقية للمحطات وخطِّط ليوم ماطر."),
    ({"event_id": "downtown_night", "demand_level": "real_totals"}, 0.85, "impact", [], "dev", "real_totals",
     "With real demand levels, how do we handle the fireworks night?", "بمستويات الطلب الحقيقية، كيف ندير ليلة الألعاب النارية؟"),
    ({"event_id": "gitex2025_d1", "weather": "rain"}, 0.85, "balanced", [WAY], "dev", "already_approved",
     "Wayfinding is already approved. Is more needed?", "تمت الموافقة على توجيه المشاة. هل يلزم المزيد؟"),
    ({"event_id": "downtown_night", "attendance": 50000}, 0.85, "impact", [], "test", "replan",
     "Twice the expected crowd. Find a plan that clears every station.", "ضعف العدد المتوقع. اعثر على خطة تُخلي كل المحطات."),
    ({"event_id": "dfw2026_d1", "attendance": 40000, "end_time": "22:30"}, 0.85, "balanced", [], "dev", "late_end",
     "The closing session runs late. Plan the last trains.", "الجلسة الختامية تتأخر. خطِّط للقطارات الأخيرة."),
    ({"event_id": "gitex2025_d1", "attendance": 80000}, 0.85, "cost", [], "dev", "goal_vs_cost",
     "Record attendance. Show me the cheapest plan and the one that clears the goal.", "حضور قياسي. أرني أرخص خطة والخطة التي تحقق الهدف."),
]


def main_() -> None:
    rows = [json.loads(line) for line in GOLD.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [r for r in rows if int(r["id"][2:]) <= 10]            # idempotent: rebuild the added block
    added = []
    for k, (spec, thr, prio, applied, split, tag, en, ar) in enumerate(SETS, 11):
        fc = c.post("/forecast", json=spec)
        assert fc.status_code == 200, (spec, fc.text)
        sim = c.post("/simulate", json={"forecast_run_id": fc.json()["run_id"], "forecast": spec, "scope": "corridor",
                                        "threshold": thr, "interventions": applied}).json()
        expect = "options" if sim["summary"]["excess_pax"] > 0 else "no_action"
        for lang, goal in (("en", en), ("ar", ar)):
            row = {"id": f"{lang}{k:02d}", "lang": lang, "forecast": spec, "threshold": thr, "priority": prio, "goal": goal,
                   "expect": expect, "split": split, "tag": tag}
            if applied:
                row["applied"] = applied
            added.append(row)
    added.sort(key=lambda r: (r["lang"] != "en", r["id"]))
    en = [r for r in rows if r["lang"] == "en"] + [r for r in added if r["lang"] == "en"]
    ar = [r for r in rows if r["lang"] == "ar"] + [r for r in added if r["lang"] == "ar"]
    GOLD.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in en + ar), encoding="utf-8")
    n_opt = sum(r["expect"] == "options" for r in en + ar)
    print(f"{len(en + ar)} scenarios ({n_opt} expect options, {len(en + ar) - n_opt} no action; "
          f"{sum(r['split'] == 'test' for r in en + ar)} test). Break points: GITEX {G}, DFW {D}")


if __name__ == "__main__":
    main_()
