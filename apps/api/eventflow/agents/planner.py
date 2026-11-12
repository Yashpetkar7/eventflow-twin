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
from typing import Callable

from ..config import ROOT, corridor
from ..forecast import config_hash, make_run_id

CACHE = ROOT / "data/demo_cache"
PLANNER = "deterministic-template"

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
        "rationale": ("{what} Simulated result: station-hours over the threshold go from {b_over} to {a_over}, "
                      "riders above the threshold from {b_excess} to {a_excess}, and the peak station load from "
                      "{b_peak}% to {a_peak}%. Added cost proxy: {cost}. Risk: {risk}"),
        "detail": {"intake": "Keep every station under {thr}% · priority: {prio}", "forecast": "Run {run}",
                   "diagnose": "{worst}, {hours}", "diagnose_none": "No station over {thr}%",
                   "propose": "{n} candidate plans from the fixed menu", "simulate": "{n} simulator runs",
                   "rank": "Top {n} by riders relieved − λ × cost", "explain": "Template text, numbers copied from the simulator",
                   "verify": "{n} figures checked, {ok}"},
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
        "rationale": ("{what} نتيجة المحاكاة: ساعات المحطات فوق الحد من {b_over} إلى {a_over}، والركاب فوق الحد من "
                      "{b_excess} إلى {a_excess}، وأعلى حمولة محطة من {b_peak}% إلى {a_peak}%. "
                      "مؤشر التكلفة المضافة: {cost}. المخاطر: {risk}"),
        "detail": {"intake": "إبقاء كل المحطات تحت {thr}% · الأولوية: {prio}", "forecast": "التشغيل {run}",
                   "diagnose": "{worst}، {hours}", "diagnose_none": "لا توجد محطة فوق {thr}%",
                   "propose": "{n} خطط مرشحة من القائمة المحددة", "simulate": "{n} عمليات محاكاة",
                   "rank": "أفضل {n} حسب الركاب المخفَّف عنهم − λ × التكلفة", "explain": "نص قالب، والأرقام منسوخة من المحاكي",
                   "verify": "تم التحقق من {n} رقمًا، {ok}"},
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


def propose(hot: dict, has_event: bool, has_stagger: bool, scope_ids: set[str]) -> list[dict]:
    """Candidate bundles from the fixed menu, inside the bounds of corridor.yaml."""
    cfg = corridor()
    by_id = {s["id"]: s for s in cfg["stations"]}
    b, cap = cfg["interventions"]["bounds"], cfg["capacity"]
    worst, hrs, win, pk = hot["station"], hot["hours"], hot["window"], hot["peak_hour"]
    load = lambda s: hot["load_at"].get(s, {}).get(pk, 0.0)                                      # noqa: E731
    nbs = [n for n in cfg["neighbours"].get(worst, []) if n in scope_ids]
    nb = min(nbs, key=load) if nbs else None
    far_pool = [s for s in scope_ids if s not in (worst, nb) and _km(by_id[worst], by_id[s]) <= b.get("max_shuttle_km", 8)]
    far = min(far_pool, key=load) if far_pool else nb
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
    return out


def _name(sid: str | None, locale: str) -> str:
    if sid is None:
        return ""
    s = next(x for x in corridor()["stations"] if x["id"] == sid)
    return (s.get("name_ar") or s["name_en"]) if locale == "ar" else s["name_en"]


def _hours_text(hours: list[int]) -> str:
    return ", ".join(f"{h}:00" for h in hours)


def make_plan(run: dict, req, run_simulation: Callable[..., dict]) -> dict:
    locale, thr_req = req.locale, req.threshold
    applied = [i.model_dump() if hasattr(i, "model_dump") else i for i in req.applied]
    key = {"fc": run["run_id"], "applied": applied, "thr": thr_req, "scope": req.scope, "priority": req.priority,
           "locale": locale, "config": config_hash(), "planner": PLANNER}
    plan_id = make_run_id("plan", key)
    cache_file = CACHE / f"{plan_id}.json"
    offline = os.environ.get("DEMO_MODE", "offline") == "offline"
    if offline and cache_file.exists():
        try:
            return {**json.loads(cache_file.read_text(encoding="utf-8")), "cached": True}
        except (OSError, json.JSONDecodeError):
            pass                                    # a torn cache file must never break the demo: recompute

    T = TEXT[locale]
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
        cands = propose(hot, bool(run.get("event")), any(i["type"] == "staggered_exit" for i in applied), scope_ids)
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
        scored.sort(key=lambda o: (o["demote"], -o["score"], o["res"]["summary"]["overcap_station_hours"]))
        for rank, o in enumerate(scored[:3], 1):
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
                       *(str(v) for k, v in o["ctx"].items() if isinstance(v, (int, float)))}
            n, ok = verify_numbers(rationale, allowed)
            if not ok:                              # cannot happen with the template; an LLM explainer would land here
                rationale, n = what, 0
            checked, all_ok = checked + n, all_ok and ok
            options.append({"rank": rank, "title": title, "interventions": o["ivs"], "summary": o["res"]["summary"],
                            "delta": {k: round(o["res"]["summary"][k] - base["summary"][k], 3)
                                      for k in o["res"]["summary"] if k not in ("bins_per_hour", "threshold")},
                            "score": o["score"], "rationale": rationale, "what": what, "risk": risk,
                            "cost_added": o["cost_added"], "new_hotspots": o["new_hot"], "figures": 7,
                            "sources": [o["res"]["source"], {"tool": "forecast", "run_id": run["run_id"]}]})
    details.update({"propose": T["detail"]["propose"].format(n=n_cand), "simulate": T["detail"]["simulate"].format(n=n_cand + 1),
                    "rank": T["detail"]["rank"].format(n=len(options)), "explain": T["detail"]["explain"],
                    "verify": T["detail"]["verify"].format(n=checked, ok=T["ok"] if all_ok else T["bad"])})
    plan = {"plan_id": plan_id, "forecast_run_id": run["run_id"], "mode": "offline", "is_synthetic": run["is_synthetic"],
            "baseline_summary": base["summary"], "options": options,
            "verify": {"numbers_checked": checked, "all_matched": all_ok, "fallback_used": True},
            "steps": [{"key": k, "label": STEP_LABELS[locale][i], "detail": details.get(k, ""), "tool": STEP_TOOLS[i]}
                      for i, k in enumerate(STEP_KEYS)],
            "planner": PLANNER,
            "hotspot": None if hot is None else {"station": hot["station"], "hours": hot["hours"], "window": hot["window"],
                                                 "peak_lf": hot["peak_lf"]},
            "cached": False}
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass
    return plan
