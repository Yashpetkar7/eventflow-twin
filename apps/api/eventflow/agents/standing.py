"""Standing agents (docs/15): the Watcher (duty view), the Messenger (drafts after an approval) and Ask the Twin.

They work outside a planning mission. Every figure they give comes from the forecast, the simulator or the break-point
tool, with the run id behind it (CLAUDE.md rule 2). Text is returned as a key + parameters, rendered by the client in
English or Arabic, except the Messenger's drafts, which are written here in both languages from verified figures (a
recorded model answer may reword them; its numbers must still match, else the template is kept).
"""
from __future__ import annotations

import re
from typing import Callable

from ..breakpoint import break_points
from ..config import corridor
from ..forecast import build_from_spec
from ..simulate import simulate
from . import planner
from .personas import AgentLLM, agent_llm, note  # noqa: F401  (AgentLLM: type of the messenger's / ask's model)

# ---------------------------------------------------------------- Watcher
def watch(run: dict, base: dict, horizon_h: int = 3, start_h: int = 5) -> dict:
    """The duty view: for every hour of the scenario day, the alerts a watcher looking `horizon_h` hours ahead would
    raise, from the simulator's hourly rows (with the already-approved measures). One call returns the whole day, so
    the screen can follow the clock without polling the API."""
    thr = base["summary"]["threshold"]
    over: dict[str, list[tuple[int, float]]] = {}
    for r in base["hourly"]:
        if r["overcap_bins"] > 0:
            over.setdefault(r["station_id"], []).append((r["hour"], r["peak_lf"]))
    alerts = []
    for st, hrs in sorted(over.items()):
        hrs.sort()
        first, peak = hrs[0][0], max(lf for _, lf in hrs)
        raised = max(start_h, first - horizon_h)
        alerts.append({"station": st, "raised_at": raised, "crosses_at": first, "lead_h": first - raised,
                       "hours": [h for h, _ in hrs], "peak_lf": round(peak, 3), "run_id": base["run_id"]})
    alerts.sort(key=lambda a: (a["raised_at"], a["crosses_at"], a["station"]))
    timeline = []
    for h in range(start_h, 24):
        active = [a["station"] for a in alerts if a["raised_at"] <= h <= max(a["hours"])]
        timeline.append({"hour": h, "active": active, "new": [a["station"] for a in alerts if a["raised_at"] == h]})
    return {"horizon_h": horizon_h, "threshold": thr, "alerts": alerts, "timeline": timeline, "run_id": base["run_id"],
            "forecast_run_id": run["run_id"], "is_synthetic": run["is_synthetic"],
            "next_step": "run_team" if alerts else "none"}


# ---------------------------------------------------------------- Messenger
MSG = {
    "en": {
        "notice": "{event}: {station} station is expected to be very busy from {h0}:00 to {h1}:00. {advice} Please allow extra time.",
        "advice": {"wayfinding_redirect": "Follow the signs to {to} station, a short walk away.",
                   "shuttle_bus": "Free feeder shuttles will run from {station} to {to}.",
                   "extra_trains": "Trains will run more often on the {line} Line.",
                   "staggered_exit": "Exits from the venue will open in waves.",
                   "station_metering": "Entry to {station} will be managed at the gates.",
                   "robotaxi_staging": "Robotaxis will wait near {station}.",
                   "extended_hours": "The {line} Line will run later than usual."},
        "sign": "{station}: busy {h0}:00–{h1}:00 · {short}",
        "short": {"wayfinding_redirect": "use {to} station", "shuttle_bus": "shuttle to {to}", "extra_trains": "more trains",
                  "staggered_exit": "exits in waves", "station_metering": "managed entry", "robotaxi_staging": "robotaxis waiting",
                  "extended_hours": "later service"},
        "ops": ("Approved plan: {title}. Measures: {what} Simulated effect: riders above the comfort line {b_excess} → {a_excess}, "
                "peak station load {b_peak}% → {a_peak}%. {stress}"),
        "stress": "Holds in {holds} of {total} stress tests.",
    },
    "ar": {
        "notice": "{event}: يُتوقع ازدحام شديد في محطة {station} من {h0}:00 إلى {h1}:00. {advice} يُرجى تخصيص وقت إضافي.",
        "advice": {"wayfinding_redirect": "اتبع اللافتات إلى محطة {to} القريبة سيرًا.",
                   "shuttle_bus": "ستعمل حافلات مغذية مجانية من {station} إلى {to}.",
                   "extra_trains": "ستزداد وتيرة القطارات على الخط {line}.",
                   "staggered_exit": "سيُفتح الخروج من مكان الفعالية على دفعات.",
                   "station_metering": "سيُنظَّم الدخول إلى {station} عند البوابات.",
                   "robotaxi_staging": "ستنتظر سيارات أجرة ذاتية القيادة قرب {station}.",
                   "extended_hours": "سيعمل الخط {line} لوقت أطول من المعتاد."},
        "sign": "{station}: ازدحام {h0}:00–{h1}:00 · {short}",
        "short": {"wayfinding_redirect": "استخدم محطة {to}", "shuttle_bus": "حافلة إلى {to}", "extra_trains": "قطارات أكثر",
                  "staggered_exit": "خروج على دفعات", "station_metering": "دخول منظَّم", "robotaxi_staging": "سيارات أجرة بالانتظار",
                  "extended_hours": "خدمة أطول"},
        "ops": ("الخطة المعتمدة: {title}. الإجراءات: {what} الأثر بحسب المحاكاة: الركاب فوق حد الراحة {b_excess} ← {a_excess}، "
                "أعلى حمولة محطة {b_peak}% ← {a_peak}%. {stress}"),
        "stress": "تصمد في {holds} من {total} اختبارات ضغط.",
    },
}
LINE_AR = {"Red": "الأحمر", "Green": "الأخضر"}


def _name(sid: str | None, locale: str) -> str:
    return planner._name(sid, locale) if sid else ""


def drafts(option: dict, baseline: dict, event: dict | None, hotspot: dict | None, stress: dict | None, locale: str = "en") -> dict:
    """Passenger notice, signage line and operations briefing for an approved option, in English and Arabic. Every
    number is the option's simulated figure or one of its measures' settings (checked); marked DRAFT, never sent."""
    ivs = option["interventions"]
    lead = ivs[0] if ivs else {"type": "extra_trains", "params": {}}
    p = lead["params"]
    station = (hotspot or {}).get("station") or p.get("from_station") or p.get("station")
    hours = (hotspot or {}).get("hours") or p.get("hours") or [18]
    b, a = planner.summary_figures(baseline), planner.summary_figures(option["summary"])
    allowed = {*b.values(), *a.values(), *planner.allowed_for(b, a, "0", "0", ivs, 1), str(min(hours)), str(max(hours) + 1), "00"}
    if stress and stress.get("total"):
        allowed |= {str(stress["holds"]), str(stress["total"])}
    out, names = {}, []
    for loc in ("en", "ar"):
        M = MSG[loc]
        ev_name = ((event or {}).get("name_ar") if loc == "ar" else None) or (event or {}).get("name") or ("الفعالية" if loc == "ar" else "Event")
        names.append(ev_name)
        ctx = {"station": _name(station, loc), "to": _name(p.get("to_station"), loc), "h0": min(hours), "h1": max(hours) + 1,
               "line": LINE_AR.get(p.get("line", "Red"), p.get("line", "Red")) if loc == "ar" else p.get("line", "Red"), "event": ev_name}
        advice = " ".join(dict.fromkeys(M["advice"][iv["type"]].format(**{**ctx, "to": _name(iv["params"].get("to_station"), loc) or ctx["to"]})
                                        for iv in ivs if iv["type"] in M["advice"]))
        st = M["stress"].format(holds=stress["holds"], total=stress["total"]) if stress and stress.get("total") else ""
        out[loc] = {"notice": M["notice"].format(advice=advice, **ctx),
                    "sign": M["sign"].format(short=M["short"].get(lead["type"], "").format(**ctx), **ctx),
                    "ops": M["ops"].format(title=planner.bundle_title(ivs, loc), what=planner.describe(ivs, loc)[0], b_excess=b["excess"],
                                           a_excess=a["excess"], b_peak=b["peak"], a_peak=a["peak"], stress=st).strip()}
    def check(text: str) -> tuple[int, bool]:
        for n in names:                                   # the event's own name is data, not a figure
            text = text.replace(n, "")
        return planner.verify_numbers(text, allowed)
    res = [check(v) for loc in out for v in out[loc].values()]
    return {"drafts": out, "status": "draft", "sent": False, "numbers_checked": sum(n for n, _ in res), "all_matched": all(ok for _, ok in res),
            "source": "template", "allowed": sorted(allowed), "event_names": names,
            "note": "Drafts for a human to edit and approve. Nothing is sent anywhere; not an RTA notice."}


# ---------------------------------------------------------------- Ask the twin
INTENTS = ["peak", "worst", "break_point", "if_hot", "if_rain", "if_more", "road", "plan"]
_ROUTES: list[tuple[str, str]] = [
    ("break_point", r"break|tip over|how many (visitors|people)|crowd size|نقطة الانكسار|كم زائر"),
    ("if_hot", r"\bhot\b|heat|حار|الحر"), ("if_rain", r"\brain|ممطر|المطر"),
    ("if_more", r"more (visitors|people)|bigger crowd|\+\s*\d+|زوار أكثر|زيادة الزوار"),
    ("road", r"\broad|traffic|cars|taxi|الطرق|السيارات|المرور"),
    ("plan", r"what should (we|i|the planner) do|recommend(ed)? (a |the )?(measure|action|plan|option)s?|\bplan\b|best (option|measure)|ماذا نفعل|توصي|خطة"),
    ("worst", r"which station|worst|busiest station|most crowded|أي محطة|أكثر محطة"),
    ("peak", r"\bwhen\b|what time|peak|busiest (time|moment|hour)|متى|الذروة|أي ساعة"),
]
_SCOPE = r"station|metro|crowd|platform|train|visitor|event|load|threshold|محطة|مترو|ازدحام|حشد|قطار|زوار|فعالية|حمولة"
# Refused whatever else the question mentions: harm, intrusion, personal data, surveillance.
_DENY = (r"hack|exploit|bomb|weapon|explosive|stampede|cause (a )?(crush|panic)|password|phone numbers?|home address|personal data|"
         r"track (a|my|someone|where)|follow (a|my) |surveil|scrape|اختراق|أخترق|سلاح|قنبلة|تدافع|بيانات شخصية|كلمة المرور|أرقام هواتف|تتبع")


def route(question: str) -> str | None:
    """The tool a question needs, or None when it is outside the twin's scope or harmful (the agent refuses)."""
    q = question.lower()
    if re.search(_DENY, q):
        return None
    for intent, pat in _ROUTES:
        if re.search(pat, q):
            return intent
    return "peak" if re.search(_SCOPE, q) else None


def answer(intent: str, run: dict, req, base: dict, run_simulation: Callable[..., dict], plan_fn: Callable[[], dict] | None = None) -> dict:
    """An answer as a key + parameters (the client words it), with the tool run behind every figure."""
    thr = base["summary"]["threshold"]
    report = [s["id"] for s in corridor()["stations"] if s.get("in_corridor")] if req.scope == "corridor" else None
    best = max(base["hourly"], key=lambda r: r["peak_lf"])
    if intent == "peak":
        return {"key": "ask.peak", "params": {"station": best["station_id"], "hour": best["hour"], "peak_pct": round(best["peak_lf"] * 100)},
                "sources": [{"tool": "simulate", "run_id": base["run_id"]}]}
    if intent == "worst":
        hot = planner.diagnose(base)
        st = hot["station"] if hot else best["station_id"]
        over = sum(r["overcap_bins"] for r in base["hourly"] if r["station_id"] == st) / base["summary"]["bins_per_hour"]
        return {"key": "ask.worst", "params": {"station": st, "over_h": round(over, 2), "peak_pct": round(max(r["peak_lf"] for r in base["hourly"] if r["station_id"] == st) * 100)},
                "sources": [{"tool": "simulate", "run_id": base["run_id"]}]}
    if intent == "break_point":
        bp = break_points(run, req.threshold, report or [s["id"] for s in corridor()["stations"] if s.get("in_corridor")])
        return {"key": "ask.break" if bp["corridor_break_attendance"] else "ask.noBreak",
                "params": {"attendance": bp["corridor_break_attendance"], "station": bp["corridor_break_station"], "now": run.get("attendance_used")},
                "sources": [{"tool": "forecast", "run_id": bp["run_id"]}]}
    if intent in ("if_hot", "if_rain", "if_more"):
        spec = req.forecast.model_dump() if hasattr(req.forecast, "model_dump") else dict(req.forecast)
        if intent == "if_more":
            att = run.get("attendance_used")
            if not att:
                return {"key": "ask.noEvent", "params": {}, "sources": []}
            spec.update({"attendance": round(att * 1.25)})
        else:
            spec.update({"weather": "hot" if intent == "if_hot" else "rain", "metro_share": None})
        fc = build_from_spec(spec)
        res = simulate(fc["demand"], [], weekday=fc["weekday"], threshold=thr, report=report, service=fc.get("service"))
        return {"key": f"ask.{intent}", "params": {"over_before": base["summary"]["overcap_station_hours"], "over_after": res.summary["overcap_station_hours"],
                                                   "peak_before_pct": round(base["summary"]["peak_lf"] * 100), "peak_after_pct": round(res.summary["peak_lf"] * 100)},
                "sources": [{"tool": "forecast", "run_id": fc["run_id"]}]}
    if intent == "road":
        road = base.get("road")
        if not road:
            return {"key": "ask.noEvent", "params": {}, "sources": []}
        return {"key": "ask.road", "params": {"veh": round(road["peak_veh_per_hour"]), "hour": road["peak_hour"], "pressure_pct": round(road["pressure"] * 100)},
                "sources": [{"tool": "simulate", "run_id": base["run_id"]}]}
    if intent == "plan" and plan_fn is not None:
        plan = plan_fn()
        if not plan["options"]:
            return {"key": "ask.planNone", "params": {}, "sources": [{"tool": "simulate", "run_id": base["run_id"]}]}
        o = plan["options"][0]
        return {"key": "ask.plan", "params": {"title": o["title"], "excess_before": round(plan["baseline_summary"]["excess_pax"]),
                                              "excess_after": round(o["summary"]["excess_pax"])}, "sources": [o["sources"][0]]}
    return {"key": "ask.refuse", "params": {}, "sources": []}
