"""Planner pipeline behind POST /agent/plan (docs/06).

    intake → forecast → diagnose → propose → simulate ×N → rank → explain → verify_numbers

Every number comes from the deterministic simulator (CLAUDE.md rule 2). This module is the offline planner:
`propose` picks bundles from the fixed intervention menu around the diagnosed hotspot and `explain` fills a
template, so it runs with no network and no API key. It reports itself honestly as
`planner: "deterministic-template"`, `verify.fallback_used: true`. An LLM proposer/explainer can replace those
two steps behind the same response shape; `verify_numbers` below is the guard it would have to pass.

Results are cached in data/demo_cache/ (keyed by the deterministic request hash) and replayed when
DEMO_MODE=offline, so the booth serves the exact same plan every time.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Callable

from ..config import ROOT, corridor
from ..forecast import config_hash, make_run_id
from ..interventions import InterventionError, validate_interventions
from . import llm as llm_mod

CACHE = ROOT / "data/demo_cache"                    # shipped with the build (read)
# new entries go to the writable data directory: the same folder on a laptop, a temp folder on serverless hosting
CACHE_WRITE = Path(os.environ.get("EVENTFLOW_DATA_DIR") or ROOT / "data") / "demo_cache"
PLANNER = "deterministic-template"
PLANNER_REV = 3
DEFAULT_GOAL = "Keep every station under 85% load during the exit surge"   # schemas.AgentPlanRequest.goal default
LLM_FACTORY = llm_mod.get_llm                    # swapped for a fake model in tests            # bump when the ranking changes, so stale offline-cache entries are not replayed

STEP_KEYS = ["intake", "forecast", "diagnose", "propose", "simulate", "rank", "explain", "verify"]
STEP_LABELS = {
    "en": ["Read the goal", "Forecast demand", "Find hotspots", "Propose plans", "Simulate each plan",
           "Rank by impact and cost", "Explain in plain words", "Check every number"],
    # Arabic: draft for native-speaker review
    "ar": ["قراءة الهدف", "التنبؤ بالطلب", "تحديد نقاط الازدحام", "اقتراح الخطط", "محاكاة كل خطة",
           "الترتيب حسب الأثر والتكلفة", "الشرح بلغة بسيطة", "التحقق من كل رقم"],
}
STEP_TOOLS = [None, "forecast", "simulate", None, "simulate", "rank", None, "verify_numbers"]

TEXT = {
    "en": {
        "stagway": ("Staggered exit + wayfinding",
                    "Spread venue exits over an extra {spread} minutes and guide {share}% of {worst} riders to {nb} on foot.",
                    "Needs the organiser's cooperation and clear signage."),
        "trains": ("Extra trains",
                   "Cut {line} Line headway to {hw} minutes from {h0}:00 to {h1}:00.",
                   "Depends on spare trains and crew."),
        "busrt": ("Feeder shuttles + robotaxi staging",
                  "{buses} shuttles from {worst} to {far}, plus {veh} robotaxis staged at {worst}.",
                  "Can shift crowding to the receiving station."),
        "way": ("Wayfinding only",
                "Guide {share}% of {worst} riders to {nb} on foot.",
                "Relies on visitors following the signs."),
        "trainstag": ("Extra trains + staggered exit",
                      "{hw}-minute headway from {h0}:00 to {h1}:00, plus exits spread over an extra {spread} minutes.",
                      "The most expensive option."),
        "trainsway": ("Extra trains + wayfinding",
                      "{hw}-minute headway from {h0}:00 to {h1}:00, plus guiding {share}% of {worst} riders to {nb}.",
                      "Needs operations and on-street teams to coordinate."),
        "meter": ("Entry metering + guide to the next station",
                  "Admit riders at {worst} only up to {ml}% load; guide the rest on foot to {nb}.",
                  "Riders are turned away at the gates; needs staff and clear signs, and can load the next station."),
        "meterq": ("Entry metering at the gates",
                   "Admit riders at {worst} only up to {ml}% load; the rest wait outside the station.",
                   "Keeps the platform safe but builds a queue outside – watch the waiting time."),
        "rationale": ("{what} Simulated result: station-hours over the threshold go from {b_over} to {a_over}, "
                      "riders above the threshold from {b_excess} to {a_excess}, and the peak station load from "
                      "{b_peak}% to {a_peak}%. Added cost proxy: {cost}. Risk: {risk}"),
        "detail": {"intake": "Keep every station under {thr}% · priority: {prio}", "forecast": "Run {run}",
                   "diagnose": "{worst}, {hours}", "diagnose_none": "No station over {thr}%",
                   "propose": "{n} candidate plans from the fixed menu", "simulate": "{n} simulator runs",
                   "rank": "Top {n} by riders relieved − λ × cost", "explain": "Template text, numbers copied from the simulator",
                   "verify": "{n} figures checked, {ok}",
                   "llm_propose": "{llm} added {n} bundles ({d} outside the menu dropped)",
                   "llm_explain": "{llm} wrote {n} of {m}; the rest kept the verified template",
                   "llm_off": "{llm} unavailable ({why}); offline planner used"},
        "ok": "all match", "bad": "mismatch found", "prio": {"cost": "lower cost", "balanced": "balanced", "impact": "biggest impact"},
    },
    "ar": {
        "stagway": ("خروج متدرج + توجيه المشاة",
                    "توزيع خروج الزوار على {spread} دقيقة إضافية وتوجيه {share}% من ركاب {worst} إلى {nb} سيرًا.",
                    "يتطلب تعاون المنظمين ولافتات واضحة."),
        "trains": ("قطارات إضافية",
                   "تقليل الفاصل الزمني للخط {line} إلى {hw} دقائق من {h0}:00 إلى {h1}:00.",
                   "يعتمد على توفر القطارات والطواقم."),
        "busrt": ("حافلات مغذية + سيارات أجرة ذاتية القيادة",
                  "{buses} حافلات من {worst} إلى {far} و{veh} سيارة أجرة ذاتية القيادة عند {worst}.",
                  "قد ينقل الازدحام إلى المحطة المستقبلة."),
        "way": ("توجيه المشاة فقط",
                "توجيه {share}% من ركاب {worst} إلى {nb} سيرًا.",
                "يعتمد على استجابة الزوار."),
        "trainstag": ("قطارات إضافية + خروج متدرج",
                      "فاصل {hw} دقائق من {h0}:00 إلى {h1}:00 مع توزيع الخروج على {spread} دقيقة إضافية.",
                      "أعلى تكلفة بين الخيارات."),
        "trainsway": ("قطارات إضافية + توجيه المشاة",
                      "فاصل {hw} دقائق من {h0}:00 إلى {h1}:00 مع توجيه {share}% من ركاب {worst} إلى {nb}.",
                      "يحتاج إلى تنسيق بين التشغيل والميدان."),
        "meter": ("تنظيم الدخول + التوجيه إلى المحطة التالية",
                  "السماح بالدخول إلى {worst} حتى حمولة {ml}% فقط، وتوجيه البقية سيرًا إلى {nb}.",
                  "يُمنع بعض الركاب عند البوابات؛ يحتاج إلى موظفين ولافتات واضحة، وقد يزيد حمل المحطة التالية."),
        "meterq": ("تنظيم الدخول عند البوابات",
                   "السماح بالدخول إلى {worst} حتى حمولة {ml}% فقط، وينتظر البقية خارج المحطة.",
                   "يحافظ على سلامة الرصيف لكنه يُكوّن طابورًا في الخارج – راقب وقت الانتظار."),
        "rationale": ("{what} نتيجة المحاكاة: ساعات المحطات فوق الحد من {b_over} إلى {a_over}، والركاب فوق الحد من "
                      "{b_excess} إلى {a_excess}، وأعلى حمولة محطة من {b_peak}% إلى {a_peak}%. "
                      "مؤشر التكلفة المضافة: {cost}. المخاطر: {risk}"),
        "detail": {"intake": "إبقاء كل المحطات تحت {thr}% · الأولوية: {prio}", "forecast": "التشغيل {run}",
                   "diagnose": "{worst}، {hours}", "diagnose_none": "لا توجد محطة فوق {thr}%",
                   "propose": "{n} خطط مرشحة من القائمة المحددة", "simulate": "{n} عمليات محاكاة",
                   "rank": "أفضل {n} حسب الركاب المخفَّف عنهم − λ × التكلفة", "explain": "نص قالب، والأرقام منسوخة من المحاكي",
                   "verify": "تم التحقق من {n} رقمًا، {ok}",
                   "llm_propose": "أضاف {llm} {n} حزم (واستُبعدت {d} خارج القائمة)",
                   "llm_explain": "كتب {llm} {n} من {m}؛ والبقية بالنص المتحقَّق منه",
                   "llm_off": "{llm} غير متاح ({why})؛ استُخدم المخطِّط غير المتصل"},
        "ok": "جميعها مطابقة", "bad": "وُجد عدم تطابق", "prio": {"cost": "تكلفة أقل", "balanced": "متوازن", "impact": "أكبر أثر"},
    },
}
LINE_AR = {"Red": "الأحمر", "Green": "الأخضر", "Branch": "الفرعي"}


# ---------- canonical number formatting (shared by explain and verify) ----------
def f_int(v: float) -> str:
    return f"{round(v):,}"


def f_num(v: float) -> str:
    return f"{v:,.2f}".rstrip("0").rstrip(".")


def f_pct(lf: float) -> str:
    return str(round(lf * 100))


def summary_figures(s: dict) -> dict[str, str]:
    return {"over": f_num(s["overcap_station_hours"]), "excess": f_int(s["excess_pax"]), "peak": f_pct(s["peak_lf"])}


_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def extract_numbers(text: str) -> list[str]:
    return [n.replace(",", "").rstrip(".") for n in _NUM.findall(text.translate(_AR_DIGITS))]


def verify_numbers(text: str, allowed: set[str]) -> tuple[int, bool]:
    """Every number in `text` must be one the tools produced (after canonical formatting) or a tool input."""
    nums = extract_numbers(text)
    ok = {a.replace(",", "") for a in allowed}
    return len(nums), all(n in ok for n in nums)


# ---------- helpers ----------
def merge(applied: list[dict], extra: list[dict]) -> list[dict]:
    """Approved + candidate interventions without duplicates; two staggers never stack (keep the wider one)."""
    out, seen, stag = [], set(), None
    for iv in [*applied, *extra]:
        if iv["type"] == "staggered_exit":
            if stag is None or iv["params"]["spread_minutes"] > stag["params"]["spread_minutes"]:
                stag = iv
            continue
        k = json.dumps(iv, sort_keys=True)
        if k not in seen:
            seen.add(k)
            out.append(iv)
    return ([stag] if stag else []) + out


def over_sets(sim: dict) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for r in sim["hourly"]:
        if r["overcap_bins"] > 0:
            out.setdefault(r["station_id"], []).append(r["hour"])
    return out


def _km(a: dict, b: dict) -> float:
    from ..event_model import _haversine_km
    return _haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])


def diagnose(base: dict) -> dict | None:
    """Worst station = most over-threshold time, then highest peak. None when nothing is over the threshold."""
    by: dict[str, dict] = {}
    for r in base["hourly"]:
        d = by.setdefault(r["station_id"], {"bins": 0, "peak": 0.0, "hours": [], "peak_hour": r["hour"]})
        d["bins"] += r["overcap_bins"]
        if r["overcap_bins"] > 0:
            d["hours"].append(r["hour"])
        if r["peak_lf"] > d["peak"]:
            d["peak"], d["peak_hour"] = r["peak_lf"], r["hour"]
    hot = {s: d for s, d in by.items() if d["bins"] > 0}
    if not hot:
        return None
    worst = max(hot, key=lambda s: (hot[s]["bins"], hot[s]["peak"]))
    d = hot[worst]
    hours = sorted(d["hours"])
    window = sorted({h for x in hours for h in (x - 1, x, x + 1) if 0 <= h <= 23})
    return {"station": worst, "hours": hours, "window": window, "peak_hour": d["peak_hour"], "peak_lf": d["peak"],
            "load_at": {s: {r["hour"]: r["peak_lf"] for r in base["hourly"] if r["station_id"] == s} for s in by}}


def propose(hot: dict, has_event: bool, has_stagger: bool, scope_ids: set[str], thr: float | None = None) -> list[dict]:
    """Candidate bundles from the fixed menu, inside the bounds of corridor.yaml."""
    cfg = corridor()
    by_id = {s["id"]: s for s in cfg["stations"]}
    b, cap = cfg["interventions"]["bounds"], cfg["capacity"]
    worst, hrs, win, pk = hot["station"], hot["hours"], hot["window"], hot["peak_hour"]
    load = lambda s: hot["load_at"].get(s, {}).get(pk, 0.0)                                      # noqa: E731
    nbs = [n for n in cfg["neighbours"].get(worst, []) if n in scope_ids]
    nb = min(nbs, key=lambda s: (load(s), nbs.index(s))) if nbs else None
    # Deterministic: quietest station, then the nearest, then by id (scope_ids is a set — never rely on its order).
    far_pool = sorted(s for s in scope_ids if s not in (worst, nb) and _km(by_id[worst], by_id[s]) <= b.get("max_shuttle_km", 8))
    far = min(far_pool, key=lambda s: (load(s), round(_km(by_id[worst], by_id[s]), 3), s)) if far_pool else nb
    hw = max(3.0, float(cap["min_headway_min"]))
    hw = int(hw) if hw == int(hw) else hw
    line = by_id[worst]["line"]
    spread = min(60, b["stagger_minutes"][1])
    stag = {"type": "staggered_exit", "params": {"spread_minutes": spread}}
    trains = {"type": "extra_trains", "params": {"headway_min": hw, "hours": win, "line": line}}
    way = lambda share: {"type": "wayfinding_redirect",                                           # noqa: E731
                         "params": {"from_station": worst, "to_station": nb, "share": share, "hours": hrs}}
    ctx = {"worst": worst, "nb": nb, "far": far, "hw": hw, "h0": win[0], "h1": win[-1] + 1, "line": line, "spread": spread}
    can_stag = has_event and not has_stagger
    out = []
    if can_stag and nb:
        out.append({"key": "stagway", "ivs": [stag, way(0.25)], "ctx": {**ctx, "share": 25}})
    out.append({"key": "trains", "ivs": [trains], "ctx": ctx})
    if far:
        out.append({"key": "busrt", "ctx": {**ctx, "buses": 6, "veh": 30}, "ivs": [
            {"type": "shuttle_bus", "params": {"from_station": worst, "to_station": far, "buses": 6, "hours": hrs}},
            {"type": "robotaxi_staging", "params": {"station": worst, "vehicles": 30, "hours": hrs}}]})
    if nb:
        out.append({"key": "way", "ivs": [way(0.35)], "ctx": {**ctx, "share": 35}})
    if can_stag:
        out.append({"key": "trainstag", "ivs": [trains, stag], "ctx": ctx})
    if nb:
        out.append({"key": "trainsway", "ivs": [trains, way(0.2)], "ctx": {**ctx, "share": 20}})
    if hot["peak_lf"] > 1.0:
        # Platform over its full capacity (not just the comfort line): offer RTA's New Year's Eve measure, entry
        # metering at the gates — with riders guided to the walkable neighbour, or kept waiting outside.
        ml = round(float(thr if thr is not None else cap["overcap_threshold"]), 2)
        meter = lambda to: {"type": "station_metering", "params": {"station": worst, "max_load": ml, "hours": hrs,  # noqa: E731
                                                                   **({"to_station": to} if to else {})}}
        if nb:
            out.append({"key": "meter", "ivs": [meter(nb)], "ctx": {**ctx, "ml": round(ml * 100)}})
        out.append({"key": "meterq", "ivs": [meter(None)], "ctx": {**ctx, "ml": round(ml * 100)}})
    return out


def _name(sid: str | None, locale: str) -> str:
    if sid is None:
        return ""
    s = next(x for x in corridor()["stations"] if x["id"] == sid)
    return (s.get("name_ar") or s["name_en"]) if locale == "ar" else s["name_en"]


def _hours_text(hours: list[int]) -> str:
    return ", ".join(f"{h}:00" for h in hours)


GENERIC = {
    "en": {"extra_trains": "trains every {hw} minutes on the {line} Line from {h0}:00 to {h1}:00",
           "wayfinding_redirect": "guide {share}% of {a} riders to {b} on foot",
           "shuttle_bus": "{n} feeder shuttles from {a} to {b}",
           "robotaxi_staging": "{n} robotaxis staged at {a}",
           "staggered_exit": "venue exits spread over {spread} minutes",
           "station_metering": "admit riders at {a} only up to {ml}% load, the rest waiting outside",
           "station_metering_to": "admit riders at {a} only up to {ml}% load, the rest guided on foot to {b}",
           "station_closed": "close {a} from {h0}:00 to {h1}:00 and guide riders on foot to {b}",
           "extended_hours": "{line} Line service extended to {h0}:00–{h1}:00, a train every {hw} minutes",
           "join": "; ", "title": "Planner-proposed bundle",
           "risk": {"extra_trains": "Depends on spare trains and crew.", "wayfinding_redirect": "Relies on visitors following the signs.",
                    "shuttle_bus": "Can shift crowding to the receiving station.", "robotaxi_staging": "Depends on fleet availability.",
                    "staggered_exit": "Needs the organiser's cooperation.",
                    "station_metering": "Riders are held at the gates; watch the queue and the next station.",
                    "extended_hours": "Needs crews and maintenance windows to be moved."}},
    "ar": {"extra_trains": "قطارات كل {hw} دقائق على الخط {line} من {h0}:00 إلى {h1}:00",
           "wayfinding_redirect": "توجيه {share}% من ركاب {a} إلى {b} سيرًا",
           "shuttle_bus": "{n} حافلات مغذية من {a} إلى {b}",
           "robotaxi_staging": "{n} سيارة أجرة ذاتية القيادة عند {a}",
           "staggered_exit": "توزيع خروج الزوار على {spread} دقيقة",
           "station_metering": "السماح بالدخول إلى {a} حتى حمولة {ml}% فقط مع انتظار البقية في الخارج",
           "station_metering_to": "السماح بالدخول إلى {a} حتى حمولة {ml}% فقط وتوجيه البقية سيرًا إلى {b}",
           "station_closed": "إغلاق {a} من {h0}:00 إلى {h1}:00 وتوجيه الركاب سيرًا إلى {b}",
           "extended_hours": "تمديد تشغيل الخط {line} من {h0}:00 إلى {h1}:00، قطار كل {hw} دقائق",
           "join": "؛ ", "title": "حزمة مقترحة من المخطِّط",
           "risk": {"extra_trains": "يعتمد على توفر القطارات والطواقم.", "wayfinding_redirect": "يعتمد على استجابة الزوار.",
                    "shuttle_bus": "قد ينقل الازدحام إلى المحطة المستقبلة.", "robotaxi_staging": "يعتمد على توفر الأسطول.",
                    "staggered_exit": "يتطلب تعاون المنظمين.",
                    "station_metering": "يُوقَف الركاب عند البوابات؛ راقب الطابور والمحطة التالية.",
                    "extended_hours": "يتطلب نقل مواعيد الطواقم والصيانة."}},
}


def _num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def describe(ivs: list[dict], locale: str) -> tuple[str, str]:
    """Template description and risk for any bundle (used for LLM-proposed bundles and as the safe fallback)."""
    G, parts = GENERIC[locale], []
    for iv in ivs:
        p = iv["params"]
        hours = p.get("hours") or [0]
        ctx = {"hw": _num(p.get("headway_min", 0)), "line": LINE_AR.get(p.get("line", "Red"), p.get("line", "Red")) if locale == "ar" else p.get("line", "Red"),
               "h0": min(hours), "h1": max(hours) + 1, "share": _num(round(p.get("share", 0) * 100, 1)),
               "a": _name(p.get("from_station") or p.get("station"), locale), "b": _name(p.get("to_station"), locale),
               "n": p.get("buses") or p.get("vehicles") or 0, "spread": p.get("spread_minutes", 0),
               "ml": _num(round(p.get("max_load", 0) * 100, 1))}
        key = iv["type"]
        if key == "station_metering":
            key = "station_closed" if p.get("max_load") == 0 else ("station_metering_to" if p.get("to_station") else "station_metering")
        parts.append(G[key].format(**ctx))
    what = G["join"].join(parts)
    what = (what[0].upper() + what[1:] if locale == "en" else what) + ("." if locale == "en" else ".")
    return what, G["risk"][ivs[0]["type"]] if ivs else ""


def allowed_for(b_fig: dict, a_fig: dict, cost: str, thr_pct: str, ivs: list[dict], rank: int) -> set[str]:
    """Every number an option's text may contain: simulator figures (before/after), its added cost, the threshold,
    its rank and the parameters of its own interventions (as the template prints them)."""
    out = {*b_fig.values(), *a_fig.values(), cost, thr_pct, "00", str(rank)}
    for iv in ivs:
        for k, v in iv["params"].items():
            if v is None or isinstance(v, (bool, str)):
                continue
            for x in (v if isinstance(v, list) else [v]):
                out.add(_num(x))
                if k in ("share", "max_load"):
                    out.add(_num(round(x * 100, 1)))
                if k == "hours":
                    out.add(str(x + 1))
    return out


def _texts_ok(texts: dict, allowed: set[str]) -> tuple[int, bool]:
    n, ok = verify_numbers(" \n".join(texts[k] for k in ("title", "what", "risk", "rationale")), allowed)
    return n, ok


def make_plan(run: dict, req, run_simulation: Callable[..., dict]) -> dict:
    locale, thr_req = req.locale, req.threshold
    applied = [i.model_dump() if hasattr(i, "model_dump") else i for i in req.applied]
    key = {"fc": run["run_id"], "applied": applied, "thr": thr_req, "scope": req.scope, "priority": req.priority,
           "locale": locale, "config": config_hash(), "planner": PLANNER, "rev": PLANNER_REV}
    goal, notes = getattr(req, "goal", DEFAULT_GOAL) or DEFAULT_GOAL, getattr(req, "notes", None)
    if goal != DEFAULT_GOAL or notes:              # only the LLM steps read these; keep default ids stable
        key["input"] = {"goal": goal, "notes": notes}
    plan_id = make_run_id("plan", key)
    name = f"{plan_id}.json"
    offline = os.environ.get("DEMO_MODE", "offline") == "offline"
    if offline:
        for folder in (CACHE_WRITE, CACHE):
            try:
                return {**json.loads((folder / name).read_text(encoding="utf-8")), "cached": True}
            except (OSError, json.JSONDecodeError):
                continue                            # missing or torn entry: try the next folder, else recompute

    T = TEXT[locale]
    llm = LLM_FACTORY()                            # None unless DEMO_MODE=live and LLM_MODEL is configured
    llm_name = llm_mod.display_name(llm) if llm is not None else ""
    llm_used: list[str] = []
    llm_note: dict[str, str] = {}
    texts_for: list[dict] = []
    template_used: list[int] = []
    sim = lambda ivs: run_simulation(run["run_id"], ivs, False, thr_req, req.scope)               # noqa: E731
    base = sim(applied)
    thr = base["summary"]["threshold"]
    thr_pct = f_pct(thr)
    scope_ids = {r["station_id"] for r in base["hourly"]}
    hot = diagnose(base)
    lam = corridor()["interventions"].get("priority_lambda", {}).get(req.priority, corridor()["interventions"]["ranking_lambda"])
    details = {"intake": T["detail"]["intake"].format(thr=thr_pct, prio=T["prio"][req.priority]),
               "forecast": T["detail"]["forecast"].format(run=run["run_id"])}

    options, n_cand, checked, all_ok = [], 0, 0, True
    if hot is None:
        details["diagnose"] = T["detail"]["diagnose_none"].format(thr=thr_pct)
    else:
        details["diagnose"] = T["detail"]["diagnose"].format(worst=_name(hot["station"], locale), hours=_hours_text(hot["hours"]))
        cands = propose(hot, bool(run.get("event")), any(i["type"] == "staggered_exit" for i in applied), scope_ids, thr)
        if llm is not None:                        # the LLM may add bundles; code validates, simulates and ranks them
            try:
                ans = llm.complete_json(system=llm_mod.PROPOSER_SYSTEM, schema=llm_mod.PROPOSER_SCHEMA, effort="medium",
                                        max_tokens=16000, user=llm_mod.proposer_prompt(
                                            hot, scope_ids, cands, base["summary"], req.priority, goal, notes, bool(run.get("event"))))
                seen = {json.dumps(sorted(json.dumps(i, sort_keys=True) for i in c["ivs"])) for c in cands}
                added = dropped = 0
                for b in ans.get("bundles", [])[:5]:
                    try:
                        ivs = [iv.model_dump() for iv in validate_interventions([llm_mod.to_intervention(x) for x in b["interventions"][:3]])]
                    except (InterventionError, ValueError, KeyError, TypeError):
                        dropped += 1               # outside the menu or the bounds: never simulated
                        continue
                    sig = json.dumps(sorted(json.dumps(i, sort_keys=True) for i in ivs))
                    if ivs and sig not in seen:
                        seen.add(sig)
                        cands.append({"key": "llm", "ivs": ivs, "ctx": {}, "label": str(b.get("label", ""))[:80]})
                        added += 1
                llm_used.append("propose")
                llm_note["propose"] = T["detail"]["llm_propose"].format(llm=llm_name, n=added, d=dropped)
            except llm_mod.LLMUnavailable as e:
                llm_note["propose"] = T["detail"]["llm_off"].format(llm=llm_name, why=str(e)[:80])
        n_cand = len(cands)
        base_over, b_fig = over_sets(base), summary_figures(base["summary"])
        scored = []
        for c in cands:
            res = sim(merge(applied, c["ivs"]))
            relieved = base["summary"]["excess_pax"] - res["summary"]["excess_pax"]
            cost_added = round(res["summary"]["cost_proxy"] - base["summary"]["cost_proxy"], 2)
            if relieved <= 0:
                continue                           # an option that relieves nobody is not a recommendation
            new_hot = sorted(s for s in over_sets(res) if s not in base_over)
            worse = res["summary"]["overcap_station_hours"] > base["summary"]["overcap_station_hours"]
            scored.append({**c, "res": res, "score": round(relieved - lam * cost_added, 1), "cost_added": cost_added,
                           "new_hot": new_hot, "demote": worse})
        # Options that add over-threshold station-hours go last (docs/09 #27): a plan must not trade one hotspot for a bigger one.
        # Rank: options that add over-threshold station-hours last (docs/09 #27), then options that push another station
        # over the threshold (moving the hotspot is not solving it — eval/suites/agents.py top_no_new_hotspot), then
        # riders relieved − λ·cost.
        scored.sort(key=lambda o: (o["demote"], bool(o["new_hot"]), -o["score"], o["res"]["summary"]["overcap_station_hours"]))
        for rank, o in enumerate(scored[:3], 1):
            if o["key"] == "llm":
                title = GENERIC[locale]["title"]
                what, risk = describe(o["ivs"], locale)
            else:
                title, what_t, risk = T[o["key"]]
                ctx = {**o["ctx"], "worst": _name(o["ctx"]["worst"], locale), "nb": _name(o["ctx"]["nb"], locale),
                       "far": _name(o["ctx"]["far"], locale),
                       "line": LINE_AR.get(o["ctx"]["line"], o["ctx"]["line"]) if locale == "ar" else o["ctx"]["line"]}
                what = what_t.format(**ctx)
            a_fig = summary_figures(o["res"]["summary"])
            cost = f_num(o["cost_added"])
            rationale = T["rationale"].format(what=what, risk=risk, cost=cost, b_over=b_fig["over"], a_over=a_fig["over"],
                                              b_excess=b_fig["excess"], a_excess=a_fig["excess"],
                                              b_peak=b_fig["peak"], a_peak=a_fig["peak"])
            allowed = {*b_fig.values(), *a_fig.values(), cost, "00",
                       *(str(v) for k, v in o["ctx"].items() if isinstance(v, (int, float)))} | allowed_for(
                b_fig, a_fig, cost, thr_pct, o["ivs"], rank)
            n, ok = verify_numbers(rationale, allowed)
            if not ok:                              # cannot happen with the template; kept as a guard
                rationale, n = what, 0
            checked, all_ok = checked + n, all_ok and ok
            texts_for.append({"rank": rank, "allowed": allowed, "figures": {"before": b_fig, "after": a_fig, "added_cost": cost,
                                                                             "threshold_pct": thr_pct}})
            options.append({"rank": rank, "title": title, "interventions": o["ivs"], "summary": o["res"]["summary"],
                            "delta": {k: round(o["res"]["summary"][k] - base["summary"][k], 3)
                                      for k in o["res"]["summary"] if k not in ("bins_per_hour", "threshold")},
                            "score": o["score"], "rationale": rationale, "what": what, "risk": risk,
                            "cost_added": o["cost_added"], "new_hotspots": o["new_hot"], "figures": 7,
                            "sources": [o["res"]["source"], {"tool": "forecast", "run_id": run["run_id"]}]})
    if llm is not None and options:                # the LLM rewrites the texts; each must pass the number check
        try:
            items = [{"rank": o["rank"], "ACTIONS": o["interventions"], "FIGURES": t_["figures"],
                      "new_hotspots": [_name(x, locale) for x in o["new_hotspots"]], "template_what": o["what"]}
                     for o, t_ in zip(options, texts_for)]
            ans = llm.complete_json(system=llm_mod.EXPLAINER_SYSTEM.format(language="Arabic" if locale == "ar" else "British English"),
                                    schema=llm_mod.EXPLAINER_SCHEMA, effort="low", max_tokens=16000,
                                    user=llm_mod.explainer_prompt(items, goal, notes))
            by_rank = {int(x["rank"]): x for x in ans.get("options", []) if isinstance(x, dict)}
            kept = 0
            checked, all_ok = 0, True
            for o, t_ in zip(options, texts_for):
                x = by_rank.get(o["rank"])
                texts = {k: str((x or {}).get(k, "")).strip()[:900] for k in ("title", "what", "risk", "rationale")}
                n, ok = _texts_ok(texts, t_["allowed"]) if x and all(texts.values()) else (0, False)
                if ok:
                    o.update(texts)
                    kept += 1
                    checked += n
                else:                              # invented or missing numbers: keep the verified template text
                    template_used.append(o["rank"])
                    n2, _ = _texts_ok({k: o[k] for k in ("title", "what", "risk", "rationale")}, t_["allowed"])
                    checked += n2
            llm_used.append("explain")
            llm_note["explain"] = T["detail"]["llm_explain"].format(llm=llm_name, n=kept, m=len(options))
        except llm_mod.LLMUnavailable as e:
            llm_note["explain"] = T["detail"]["llm_off"].format(llm=llm_name, why=str(e)[:80])
    details.update({"propose": T["detail"]["propose"].format(n=n_cand), "simulate": T["detail"]["simulate"].format(n=n_cand + 1),
                    "rank": T["detail"]["rank"].format(n=len(options)), "explain": T["detail"]["explain"],
                    "verify": T["detail"]["verify"].format(n=checked, ok=T["ok"] if all_ok else T["bad"])})
    for k, v in llm_note.items():
        details[k] = f"{details.get(k, '')} · {v}" if details.get(k) else v
    live = bool(llm_used)
    plan = {"plan_id": plan_id, "forecast_run_id": run["run_id"], "mode": "live" if live else "offline", "is_synthetic": run["is_synthetic"],
            "baseline_summary": base["summary"], "options": options,
            "verify": {"numbers_checked": checked, "all_matched": all_ok,
                       "fallback_used": (not live) or "explain" not in llm_used or bool(template_used)},
            "steps": [{"key": k, "label": STEP_LABELS[locale][i], "detail": details.get(k, ""), "tool": STEP_TOOLS[i]}
                      for i, k in enumerate(STEP_KEYS)],
            "planner": f"{getattr(llm, 'provider', 'llm')}:{llm.model}" if live else PLANNER,
            "hotspot": None if hot is None else {"station": hot["station"], "hours": hot["hours"], "window": hot["window"],
                                                 "peak_lf": hot["peak_lf"]},
            "cached": False}
    try:
        CACHE_WRITE.mkdir(parents=True, exist_ok=True)
        (CACHE_WRITE / name).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass                                        # read-only filesystem: the plan is still returned
    return plan
