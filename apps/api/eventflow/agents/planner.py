"""Planner pipeline behind POST /agent/plan (docs/06).

    intake → forecast → diagnose → propose → simulate ×N → critic ⟲ replan (≤ 2 more rounds) → rank → explain → verify_numbers

The critic is code: after each round it checks whether any tested plan meets the goal (no station over the
threshold, none newly pushed over it). If none does, the planner replans — stronger settings and combinations
aimed at what is still over the threshold — and tests those. Every tool call is recorded in `trace`.

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
import time
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
PLANNER_REV = 4
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


def target_context(hot: dict, has_event: bool, has_stagger: bool, scope_ids: set[str], thr: float | None = None) -> dict:
    """Where and when to act, from the diagnosis: the worst station, its quietest walkable neighbour, the quietest
    station a shuttle can reach, the line, the hours and the menu settings every proposer starts from."""
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
    ml = round(float(thr if thr is not None else cap["overcap_threshold"]), 2)
    return {"worst": worst, "nb": nb, "far": far, "hw": hw, "line": by_id[worst]["line"], "hrs": hrs, "win": win,
            "spread": min(60, b["stagger_minutes"][1]), "can_stag": has_event and not has_stagger,
            "over_full": hot["peak_lf"] > 1.0, "ml": ml,
            "ctx": {"worst": worst, "nb": nb, "far": far, "hw": hw, "h0": win[0], "h1": win[-1] + 1, "line": by_id[worst]["line"],
                    "spread": min(60, b["stagger_minutes"][1])}}


# The measures each proposer owns (docs/15): rail service, station & crowd, venue, first/last mile.
def _stag(t: dict) -> dict:
    return {"type": "staggered_exit", "params": {"spread_minutes": t["spread"]}}


def _trains(t: dict) -> dict:
    return {"type": "extra_trains", "params": {"headway_min": t["hw"], "hours": t["win"], "line": t["line"]}}


def _way(t: dict, share: float) -> dict:
    return {"type": "wayfinding_redirect", "params": {"from_station": t["worst"], "to_station": t["nb"], "share": share, "hours": t["hrs"]}}


def _meter(t: dict, to: str | None) -> dict:
    return {"type": "station_metering", "params": {"station": t["worst"], "max_load": t["ml"], "hours": t["hrs"],
                                                   **({"to_station": to} if to else {})}}


def _last_mile(t: dict) -> list[dict]:
    return [{"type": "shuttle_bus", "params": {"from_station": t["worst"], "to_station": t["far"], "buses": 6, "hours": t["hrs"]}},
            {"type": "robotaxi_staging", "params": {"station": t["worst"], "vehicles": 30, "hours": t["hrs"]}}]


# Every menu bundle, in the order the planner has always tested them. `agent` is the proposer that owns it: the four
# specialists own the single-domain bundles; the composer builds the cross-domain ones from their measures.
# (ord, key, agent, applies, build → (interventions, extra template values))
RECIPES: list[tuple[int, str, str, Callable[[dict], bool], Callable[[dict], tuple[list[dict], dict]]]] = [
    (1, "stagway", "composer", lambda t: t["can_stag"] and bool(t["nb"]), lambda t: ([_stag(t), _way(t, 0.25)], {"share": 25})),
    (2, "trains", "rail", lambda t: True, lambda t: ([_trains(t)], {})),
    (3, "busrt", "last_mile", lambda t: bool(t["far"]), lambda t: (_last_mile(t), {"buses": 6, "veh": 30})),
    (4, "way", "station_crowd", lambda t: bool(t["nb"]), lambda t: ([_way(t, 0.35)], {"share": 35})),
    (5, "trainstag", "composer", lambda t: t["can_stag"], lambda t: ([_trains(t), _stag(t)], {})),
    (6, "trainsway", "composer", lambda t: bool(t["nb"]), lambda t: ([_trains(t), _way(t, 0.2)], {"share": 20})),
    # Platform over its full capacity (not just the comfort line): offer RTA's New Year's Eve measure, entry metering
    # at the gates — with riders guided to the walkable neighbour, or kept waiting outside.
    (7, "meter", "station_crowd", lambda t: t["over_full"] and bool(t["nb"]), lambda t: ([_meter(t, t["nb"])], {"ml": round(t["ml"] * 100)})),
    (8, "meterq", "station_crowd", lambda t: t["over_full"], lambda t: ([_meter(t, None)], {"ml": round(t["ml"] * 100)})),
]


def recipe_bundles(t: dict, agents: set[str] | None = None) -> list[dict]:
    """The menu bundles that apply to this target, optionally only those one agent owns, in the planner's order."""
    out = []
    for ord_, key, agent, applies, build in RECIPES:
        if (agents is None or agent in agents) and applies(t):
            ivs, extra = build(t)
            out.append({"ord": ord_, "key": key, "agent": agent, "ivs": ivs, "ctx": {**t["ctx"], **extra}})
    return out


def propose(hot: dict, has_event: bool, has_stagger: bool, scope_ids: set[str], thr: float | None = None) -> list[dict]:
    """Candidate bundles from the fixed menu, inside the bounds of corridor.yaml."""
    t = target_context(hot, has_event, has_stagger, scope_ids, thr)
    return [{"key": c["key"], "ivs": c["ivs"], "ctx": c["ctx"]} for c in recipe_bundles(t)]


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


# ---------- replanning (the critic's loop) ----------
MAX_ROUNDS = 3                 # round 1 plus at most two replans
MAX_SIMS_PER_ROUND = 16        # bounds the work of one request (public demo)
MAX_BUNDLE = 5                 # interventions in one combined bundle
TYPE_NAME = {
    "en": {"extra_trains": "extra trains", "wayfinding_redirect": "wayfinding", "shuttle_bus": "feeder shuttles",
           "robotaxi_staging": "robotaxi staging", "staggered_exit": "staggered exit", "station_metering": "entry metering",
           "extended_hours": "extended hours", "join": " + ", "strong": "{names}, strongest setting"},
    "ar": {"extra_trains": "قطارات إضافية", "wayfinding_redirect": "توجيه المشاة", "shuttle_bus": "حافلات مغذية",
           "robotaxi_staging": "سيارات أجرة ذاتية القيادة", "staggered_exit": "خروج متدرج", "station_metering": "تنظيم الدخول",
           "extended_hours": "تمديد ساعات التشغيل", "join": " + ", "strong": "{names}، بأقصى إعداد"},
}


def bundle_title(ivs: list[dict], locale: str, strong: bool = False) -> str:
    """A title that names what is in a replanned bundle (no digits), e.g. "Extra trains + wayfinding"."""
    N, names = TYPE_NAME[locale], []
    for iv in ivs:
        if N[iv["type"]] not in names:
            names.append(N[iv["type"]])
    text = N["join"].join(names)
    text = text[0].upper() + text[1:] if locale == "en" else text
    return N["strong"].format(names=text) if strong else text


def _sig(ivs: list[dict]) -> str:
    return json.dumps(sorted(json.dumps(i, sort_keys=True) for i in ivs))


def _slot(iv: dict) -> tuple:
    p = iv["params"]
    return (iv["type"], p.get("from_station") or p.get("station"), p.get("to_station"), p.get("line"))


def intensify(ivs: list[dict]) -> list[dict]:
    """The same bundle with every setting moved to its bound in corridor.yaml: the strongest version allowed."""
    cfg = corridor()
    b, cap = cfg["interventions"]["bounds"], cfg["capacity"]
    out = []
    for iv in ivs:
        p, t = dict(iv["params"]), iv["type"]
        if t == "extra_trains":
            p["headway_min"] = min(p["headway_min"], float(cap["min_headway_min"]))
        elif t == "wayfinding_redirect":
            p["share"] = max(p["share"], float(b["max_redirect_share"]))
        elif t == "shuttle_bus":
            p["buses"] = min(int(b["max_buses"]), p["buses"] * 2)
        elif t == "robotaxi_staging":
            p["vehicles"] = min(int(b["max_robotaxi_vehicles"]), p["vehicles"] * 2)
        elif t == "staggered_exit":
            p["spread_minutes"] = max(p["spread_minutes"], int(b["stagger_minutes"][1]))
        out.append({"type": t, "params": p})
    return out


def combine(a: list[dict], b: list[dict]) -> list[dict]:
    """Two bundles as one. Measures aimed at the same place are merged into the stronger one, never stacked,
    so a combined bundle stays inside the bounds a single measure has (e.g. the maximum redirect share)."""
    out = [{"type": i["type"], "params": dict(i["params"])} for i in a]
    for iv in b:
        same = next((o for o in out if _slot(o) == _slot(iv)), None)
        if same is None:
            out.append({"type": iv["type"], "params": dict(iv["params"])})
            continue
        p, q = same["params"], iv["params"]
        if "hours" in p and "hours" in q:
            p["hours"] = sorted(set(p["hours"]) | set(q["hours"]))
        for k, pick in (("share", max), ("buses", max), ("vehicles", max), ("spread_minutes", max), ("headway_min", min),
                        ("max_load", min)):
            if k in p and k in q:
                p[k] = pick(p[k], q[k])
    return out


def goal_met(o: dict) -> bool:
    """The planner's goal: no station over the threshold, and no station newly pushed over it."""
    return o["res"]["summary"]["overcap_station_hours"] == 0 and not o["new_hot"] and not o["demote"]


def _llm_bundles(llm, hot: dict, scope_ids: set[str], cands: list[dict], base_summary: dict, priority: str, goal: str,
                 notes: str | None, has_event: bool, seen: set[str], feedback: dict | None = None) -> tuple[list[dict], int]:
    """Bundles suggested by the model that are inside the menu and its bounds, and not already tested."""
    ans = llm.complete_json(system=llm_mod.PROPOSER_SYSTEM, schema=llm_mod.PROPOSER_SCHEMA, effort="medium", max_tokens=16000,
                            user=llm_mod.proposer_prompt(hot, scope_ids, cands, base_summary, priority, goal, notes, has_event,
                                                         feedback=feedback))
    out, dropped = [], 0
    for b in ans.get("bundles", [])[:5]:
        try:
            ivs = [iv.model_dump() for iv in validate_interventions([llm_mod.to_intervention(x) for x in b["interventions"][:3]])]
        except (InterventionError, ValueError, KeyError, TypeError):
            dropped += 1                               # outside the menu or the bounds: never simulated
            continue
        if ivs and _sig(ivs) not in seen:
            seen.add(_sig(ivs))
            out.append({"key": "llm", "ivs": ivs, "ctx": {}, "label": str(b.get("label", ""))[:80]})
    return out, dropped


def _effect(o: dict) -> tuple:
    """How good a tested plan is for the critic's purposes: not worse, no new hotspot, fewest riders left over, cheapest."""
    return (o["demote"], bool(o["new_hot"]), o["res"]["summary"]["excess_pax"], o["cost_added"])


def _has_stag(ivs: list[dict]) -> bool:
    return any(i["type"] == "staggered_exit" for i in ivs)


class PlanRun:
    """One planning request, as a sequence of steps over shared state.

    `make_plan` runs the steps in order (the classic planner). The agent engine (agents/engine.py) runs the very same
    steps as named agents in a graph, so both produce identical plans when no language model is used. Every step reads
    this module's globals when it runs (goal_met, LLM_FACTORY, MAX_ROUNDS, CACHE_WRITE …), so tests that monkeypatch
    them apply to both. Numbers come only from `run_simulation` (CLAUDE.md rule 2).
    """

    def __init__(self, run: dict, req, run_simulation: Callable[..., dict]):
        self.run, self.req, self.run_simulation = run, req, run_simulation
        self.locale, self.thr_req = req.locale, req.threshold
        self.applied = [i.model_dump() if hasattr(i, "model_dump") else i for i in req.applied]
        key = {"fc": run["run_id"], "applied": self.applied, "thr": self.thr_req, "scope": req.scope, "priority": req.priority,
               "locale": self.locale, "config": config_hash(), "planner": PLANNER, "rev": PLANNER_REV}
        self.goal = getattr(req, "goal", DEFAULT_GOAL) or DEFAULT_GOAL
        self.notes = getattr(req, "notes", None)
        if self.goal != DEFAULT_GOAL or self.notes:     # only the LLM steps read these; keep default ids stable
            key["input"] = {"goal": self.goal, "notes": self.notes}
        self.plan_id = make_run_id("plan", key)
        self.name = f"{self.plan_id}.json"
        self.T = TEXT[self.locale]
        self.llm = None
        self.llm_name = ""
        self.llm_used: list[str] = []
        self.llm_note: dict[str, str] = {}
        self.llm_added = self.llm_dropped = 0
        self.texts_for: list[dict] = []
        self.template_used: list[int] = []
        self.trace: list[dict] = []                     # every tool call of this request, with the run id behind each number
        self.options: list[dict] = []
        self.n_cand, self.n_sims, self.checked, self.all_ok, self.rounds = 0, 1, 0, True, 1
        self.pool: list[dict] = []
        self.cands: list[dict] = []
        self.seen: set[str] = set()
        self.dropped: list[dict] = []                   # tested and dropped: relieved nobody, or outside the menu's rules
        self.hot: dict | None = None
        self.details: dict[str, str] = {}

    # ---------- plumbing
    def cached(self) -> dict | None:
        """The stored plan for this request when the booth runs offline (DEMO_MODE=offline), else None."""
        if os.environ.get("DEMO_MODE", "offline") != "offline":
            return None
        for folder in (CACHE_WRITE, CACHE):
            try:
                return {**json.loads((folder / self.name).read_text(encoding="utf-8")), "cached": True}
            except (OSError, json.JSONDecodeError):
                continue                                # missing or torn entry: try the next folder, else recompute
        return None

    def log(self, role: str, tool: str, rnd: int, t0: float, run_id: str | None = None, **data) -> None:
        self.trace.append({"n": len(self.trace) + 1, "round": rnd, "role": role, "tool": tool, "run_id": run_id,
                           "ms": round((time.perf_counter() - t0) * 1000, 1), "data": data})

    def sim(self, ivs: list[dict]) -> dict:
        return self.run_simulation(self.run["run_id"], ivs, False, self.thr_req, self.req.scope)

    # ---------- steps
    def start(self, llm=None, use_factory: bool = True) -> None:
        """Forecast + baseline simulation. `llm` None and use_factory: the configured model (or none, offline)."""
        self.llm = LLM_FACTORY() if use_factory and llm is None else llm
        self.llm_name = llm_mod.display_name(self.llm) if self.llm is not None else ""
        self.log("planner", "forecast", 1, time.perf_counter(), self.run["run_id"], event=(self.run.get("event") or {}).get("id"))
        t0 = time.perf_counter()
        self.base = self.sim(self.applied)
        b = self.base["summary"]
        self.log("simulator", "simulate", 1, t0, self.base["run_id"], label="baseline", over=b["overcap_station_hours"],
                 excess=b["excess_pax"], peak_lf=b["peak_lf"])
        self.thr = b["threshold"]
        self.thr_pct = f_pct(self.thr)
        self.scope_ids = {r["station_id"] for r in self.base["hourly"]}

    def diagnose(self) -> dict | None:
        t0 = time.perf_counter()
        self.hot = hot = diagnose(self.base)
        self.log("planner", "diagnose", 1, t0, self.base["run_id"], station=hot["station"] if hot else None,
                 hours=hot["hours"] if hot else [], peak_lf=hot["peak_lf"] if hot else None)
        cfg = corridor()["interventions"]
        self.lam = cfg.get("priority_lambda", {}).get(self.req.priority, cfg["ranking_lambda"])
        T = self.T
        self.details = {"intake": T["detail"]["intake"].format(thr=self.thr_pct, prio=T["prio"][self.req.priority]),
                        "forecast": T["detail"]["forecast"].format(run=self.run["run_id"])}
        if hot is None:
            self.details["diagnose"] = T["detail"]["diagnose_none"].format(thr=self.thr_pct)
            self.log("critic", "check_goal", 1, time.perf_counter(), verdict="no_action")
            return None
        self.details["diagnose"] = T["detail"]["diagnose"].format(worst=_name(hot["station"], self.locale), hours=_hours_text(hot["hours"]))
        self.has_event = bool(self.run.get("event"))
        self.target = target_context(hot, self.has_event, _has_stag(self.applied), self.scope_ids, self.thr)
        return hot

    def set_candidates(self, cands: list[dict], t0: float) -> None:
        """The menu bundles every proposer offered, in the planner's order (the composer's hand-off to the simulator)."""
        self.cands = [{"key": c["key"], "ivs": c["ivs"], "ctx": c["ctx"]} for c in cands]
        self.seen = {_sig(c["ivs"]) for c in self.cands}
        self.log("proposer", "propose", 1, t0, source="menu", candidates=len(self.cands))

    def model_bundles(self) -> list[dict]:
        """Round 1: bundles the language model adds (validated against the menu; nothing outside it is simulated)."""
        if self.llm is None:
            return []
        t0 = time.perf_counter()
        try:
            more, self.llm_dropped = _llm_bundles(self.llm, self.hot, self.scope_ids, self.cands, self.base["summary"],
                                                  self.req.priority, self.goal, self.notes, self.has_event, self.seen)
            self.llm_added = len(more)
            self.llm_used.append("propose")
            self.log("proposer", "propose", 1, t0, source=self.llm_name, candidates=self.llm_added, dropped=self.llm_dropped)
            return more
        except llm_mod.LLMUnavailable as e:
            self.llm_note["propose"] = self.T["detail"]["llm_off"].format(llm=self.llm_name, why=str(e)[:80])
            self.log("proposer", "propose", 1, t0, source=self.llm_name, candidates=0, error=str(e)[:80])
            return []

    def begin_testing(self) -> None:
        self.base_over, self.b_fig = over_sets(self.base), summary_figures(self.base["summary"])

    def score_one(self, c: dict, rnd: int) -> dict | None:
        t0 = time.perf_counter()
        try:
            res = self.sim(merge(self.applied, c["ivs"]))
        except InterventionError as e:
            self.dropped.append({"key": c["key"], "ivs": c["ivs"], "round": rnd, "reason": "bounds", "detail": str(e)[:160]})
            return None                                # a combination the menu does not allow: never shown
        self.n_sims += 1
        base = self.base["summary"]
        relieved = base["excess_pax"] - res["summary"]["excess_pax"]
        cost_added = round(res["summary"]["cost_proxy"] - base["cost_proxy"], 2)
        new_hot = sorted(s for s in over_sets(res) if s not in self.base_over)
        self.log("simulator", "simulate", rnd, t0, res["run_id"], label=c["key"], types=[i["type"] for i in c["ivs"]],
                 over=res["summary"]["overcap_station_hours"], excess=res["summary"]["excess_pax"],
                 peak_lf=res["summary"]["peak_lf"], cost_added=cost_added, new_hotspots=new_hot)
        if relieved <= 0:
            self.dropped.append({"key": c["key"], "ivs": c["ivs"], "round": rnd, "reason": "no_relief", "run_id": res["run_id"],
                                 "summary": res["summary"]})
            return None                                # an option that relieves nobody is not a recommendation
        worse = res["summary"]["overcap_station_hours"] > base["overcap_station_hours"]
        return {**c, "res": res, "score": round(relieved - self.lam * cost_added, 1), "cost_added": cost_added,
                "new_hot": new_hot, "demote": worse, "round": rnd}

    def test(self, cands: list[dict], rnd: int) -> list[dict]:
        """Simulate every candidate of a round; the useful ones join the pool."""
        self.n_cand += len(cands)
        got = [s for s in (self.score_one(c, rnd) for c in cands) if s]
        self.pool += got
        return got

    def critic(self, rnd: int) -> bool:
        """Does any plan tested so far meet the goal? If not, what is left, and where?"""
        t0 = time.perf_counter()
        meeting = [o for o in self.pool if goal_met(o)]
        data: dict = {"verdict": "goal_met" if meeting else ("residual" if self.pool else "no_relief"),
                      "meeting": len(meeting), "tested": len(self.pool)}
        if self.pool and not meeting:
            best = min(self.pool, key=_effect)
            left = diagnose(best["res"])
            data.update(best=best["key"], excess=best["res"]["summary"]["excess_pax"],
                        over=best["res"]["summary"]["overcap_station_hours"], station=left["station"] if left else None)
        self.log("critic", "check_goal", rnd, t0, **data)
        self.last_verdict = data
        return bool(meeting)

    def can_replan(self, met: bool) -> bool:
        return not met and bool(self.pool) and self.rounds < MAX_ROUNDS

    def replan_variants(self) -> tuple[list[dict], list[dict]]:
        """A replanning round: stronger settings and combinations aimed at what the best plans still leave over the
        threshold. Returns (variants, seeds); the caller may add model bundles before `finish_variants`."""
        self.rounds += 1
        t0 = time.perf_counter()
        seeds = sorted(self.pool, key=_effect)[:2]
        variants: list[dict] = []
        for seed in seeds:
            strong = intensify(seed["ivs"])
            if _sig(strong) not in self.seen:
                self.seen.add(_sig(strong))
                variants.append({"key": "strong", "ivs": strong, "ctx": {}})
            left = diagnose(seed["res"])
            if left is None:
                continue
            for c2 in propose(left, self.has_event, _has_stag(self.applied) or _has_stag(seed["ivs"]), self.scope_ids, self.thr):
                both = combine(seed["ivs"], c2["ivs"])
                if len(both) <= MAX_BUNDLE and _sig(both) not in self.seen:
                    self.seen.add(_sig(both))
                    variants.append({"key": "combo", "ivs": both, "ctx": {}})
        self.log("planner", "replan", self.rounds, t0, seeds=[s["key"] for s in seeds], candidates=len(variants))
        return variants, seeds

    def model_replan_bundles(self, seeds: list[dict], variants: list[dict]) -> list[dict]:
        """A replanning round's model bundles, told what the critic found (CRITIC_FEEDBACK)."""
        if self.llm is None or not seeds:
            return []
        t0 = time.perf_counter()
        left = diagnose(seeds[0]["res"]) or self.hot
        try:
            more, d2 = _llm_bundles(self.llm, left, self.scope_ids, variants, self.base["summary"], self.req.priority, self.goal,
                                    self.notes, self.has_event, self.seen,
                                    feedback={"round": self.rounds, "best_bundle_so_far": seeds[0]["ivs"],
                                              "riders_still_over_threshold": seeds[0]["res"]["summary"]["excess_pax"],
                                              "station_still_over": left["station"], "hours": left["hours"]})
            self.llm_added, self.llm_dropped = self.llm_added + len(more), self.llm_dropped + d2
            if "propose" not in self.llm_used:
                self.llm_used.append("propose")
            self.log("proposer", "propose", self.rounds, t0, source=self.llm_name, candidates=len(more), dropped=d2)
            return more
        except llm_mod.LLMUnavailable as e:
            self.log("proposer", "propose", self.rounds, t0, source=self.llm_name, candidates=0, error=str(e)[:80])
            return []

    def rank(self) -> list[dict]:
        """Order every useful plan and keep three. Options that add over-threshold station-hours go last (docs/09 #27),
        then options that push another station over the threshold (moving the hotspot is not solving it); after a
        replan, plans that meet the goal come before plans that do not; then riders relieved − λ·cost."""
        if "propose" in self.llm_used:
            self.llm_note["propose"] = self.T["detail"]["llm_propose"].format(llm=self.llm_name, n=self.llm_added, d=self.llm_dropped)
        replanned = self.rounds > 1
        t0 = time.perf_counter()
        pool = self.pool
        pool.sort(key=lambda o: (o["demote"], bool(o["new_hot"]), replanned and not goal_met(o), -o["score"],
                                 o["res"]["summary"]["overcap_station_hours"]))
        top = pool[:3]
        if replanned:                                  # replanning tests many near-identical bundles: offer three different kinds
            kinds: set[tuple] = set()
            top = []
            for o in pool:
                kind = tuple(sorted({i["type"] for i in o["ivs"]}))
                if kind not in kinds:
                    kinds.add(kind)
                    top.append(o)
                if len(top) == 3:
                    break
            top += [o for o in pool if o not in top][:3 - len(top)]
        if top and not any(goal_met(o) for o in top):
            # The critic found a plan that meets the goal, but its cost keeps it out of the top three: offer it third,
            # so the planner always sees the plan that clears the goal next to the cheaper ones.
            clears = next((o for o in pool if goal_met(o)), None)
            if clears is not None:
                top = [*top[:2], clears]
        self.log("planner", "rank", self.rounds, t0, kept=len(top), tested=len(pool), order=[o["key"] for o in top])
        self.top = top
        return top

    def render(self) -> list[dict]:
        """Template text for each kept option, with every number checked against the simulator's figures."""
        locale, T, b_fig = self.locale, self.T, self.b_fig
        for rank, o in enumerate(self.top, 1):
            if o["key"] in ("llm", "combo", "strong"):
                title = GENERIC[locale]["title"] if o["key"] == "llm" else bundle_title(o["ivs"], locale, o["key"] == "strong")
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
                b_fig, a_fig, cost, self.thr_pct, o["ivs"], rank)
            n, ok = verify_numbers(rationale, allowed)
            if not ok:                                  # cannot happen with the template; kept as a guard
                rationale, n = what, 0
            self.checked, self.all_ok = self.checked + n, self.all_ok and ok
            self.texts_for.append({"rank": rank, "allowed": allowed, "figures": {"before": b_fig, "after": a_fig, "added_cost": cost,
                                                                                  "threshold_pct": self.thr_pct}})
            base = self.base["summary"]
            self.options.append({"rank": rank, "title": title, "interventions": o["ivs"], "summary": o["res"]["summary"],
                                 "delta": {k: round(o["res"]["summary"][k] - base[k], 3)
                                           for k in o["res"]["summary"] if k not in ("bins_per_hour", "threshold")},
                                 "score": o["score"], "rationale": rationale, "what": what, "risk": risk,
                                 "cost_added": o["cost_added"], "new_hotspots": o["new_hot"], "figures": 7,
                                 "goal_met": goal_met(o), "round": o["round"], "road": o["res"].get("road"),
                                 "sources": [o["res"]["source"], {"tool": "forecast", "run_id": self.run["run_id"]}]})
        return self.options

    def model_explain(self) -> float:
        """The language model rewrites the option texts; each must pass the number check, else keeps the template."""
        t0 = time.perf_counter()
        if self.llm is None or not self.options:
            return t0
        locale = self.locale
        try:
            items = [{"rank": o["rank"], "ACTIONS": o["interventions"], "FIGURES": t_["figures"],
                      "new_hotspots": [_name(x, locale) for x in o["new_hotspots"]], "template_what": o["what"]}
                     for o, t_ in zip(self.options, self.texts_for)]
            ans = self.llm.complete_json(system=llm_mod.EXPLAINER_SYSTEM.format(language="Arabic" if locale == "ar" else "British English"),
                                         schema=llm_mod.EXPLAINER_SCHEMA, effort="low", max_tokens=16000,
                                         user=llm_mod.explainer_prompt(items, self.goal, self.notes))
            by_rank = {int(x["rank"]): x for x in ans.get("options", []) if isinstance(x, dict)}
            kept = 0
            self.checked, self.all_ok = 0, True
            for o, t_ in zip(self.options, self.texts_for):
                x = by_rank.get(o["rank"])
                texts = {k: str((x or {}).get(k, "")).strip()[:900] for k in ("title", "what", "risk", "rationale")}
                n, ok = _texts_ok(texts, t_["allowed"]) if x and all(texts.values()) else (0, False)
                if ok:
                    o.update(texts)
                    kept += 1
                    self.checked += n
                else:                                  # invented or missing numbers: keep the verified template text
                    self.template_used.append(o["rank"])
                    n2, _ = _texts_ok({k: o[k] for k in ("title", "what", "risk", "rationale")}, t_["allowed"])
                    self.checked += n2
            self.llm_used.append("explain")
            self.llm_note["explain"] = self.T["detail"]["llm_explain"].format(llm=self.llm_name, n=kept, m=len(self.options))
        except llm_mod.LLMUnavailable as e:
            self.llm_note["explain"] = self.T["detail"]["llm_off"].format(llm=self.llm_name, why=str(e)[:80])
        return t0

    def log_explain_verify(self, t0: float) -> None:
        if self.options:
            self.log("explainer", "explain", self.rounds, t0, source=self.llm_name if "explain" in self.llm_used else "template",
                     options=len(self.options), template_fallback=sorted(self.template_used))
            self.log("verifier", "verify_numbers", self.rounds, time.perf_counter(), checked=self.checked, all_matched=self.all_ok)

    def assemble(self) -> dict:
        """The plan, in the AgentPlanResponse shape, stored in the plan cache."""
        T, options = self.T, self.options
        self.details.update({"propose": T["detail"]["propose"].format(n=self.n_cand), "simulate": T["detail"]["simulate"].format(n=self.n_sims),
                             "rank": T["detail"]["rank"].format(n=len(options)), "explain": T["detail"]["explain"],
                             "verify": T["detail"]["verify"].format(n=self.checked, ok=T["ok"] if self.all_ok else T["bad"])})
        for k, v in self.llm_note.items():
            self.details[k] = f"{self.details.get(k, '')} · {v}" if self.details.get(k) else v
        live = bool(self.llm_used)
        # The critic's verdict on what is offered. `residual` is what the most effective offered plan still leaves.
        meets = [o["rank"] for o in options if o["goal_met"]]
        strongest = min(options, key=lambda o: o["summary"]["excess_pax"]) if options else None
        critic = {"rounds": self.rounds, "replanned": self.rounds > 1, "simulations": self.n_sims, "goal_met_ranks": meets,
                  "top_meets_goal": bool(options and options[0]["goal_met"]), "checked_by": "code",
                  "residual": None if (meets or strongest is None) else {
                      "rank": strongest["rank"], "excess_pax": strongest["summary"]["excess_pax"],
                      "overcap_station_hours": strongest["summary"]["overcap_station_hours"]}}
        hot, llm = self.hot, self.llm
        plan = {"plan_id": self.plan_id, "forecast_run_id": self.run["run_id"], "mode": "live" if live else "offline",
                "is_synthetic": self.run["is_synthetic"], "baseline_summary": self.base["summary"], "baseline_road": self.base.get("road"),
                "options": options,
                "verify": {"numbers_checked": self.checked, "all_matched": self.all_ok,
                           "fallback_used": (not live) or "explain" not in self.llm_used or bool(self.template_used)},
                "steps": [{"key": k, "label": STEP_LABELS[self.locale][i], "detail": self.details.get(k, ""), "tool": STEP_TOOLS[i]}
                          for i, k in enumerate(STEP_KEYS)],
                "planner": f"{getattr(llm, 'provider', 'llm')}:{llm.model}" if live else PLANNER,
                "hotspot": None if hot is None else {"station": hot["station"], "hours": hot["hours"], "window": hot["window"],
                                                     "peak_lf": hot["peak_lf"]},
                "critic": critic, "trace": self.trace, "cached": False}
        try:
            CACHE_WRITE.mkdir(parents=True, exist_ok=True)
            # newline="\n": LF on Windows too, so rebuilding the cache does not rewrite every file (booth laptop, 14 Nov)
            (CACHE_WRITE / self.name).write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
        except OSError:
            pass                                        # read-only filesystem: the plan is still returned
        return plan


def make_plan(run: dict, req, run_simulation: Callable[..., dict]) -> dict:
    """The classic planner: the PlanRun steps in order (docs/06). The agent engine runs the same steps as agents."""
    p = PlanRun(run, req, run_simulation)
    hit = p.cached()
    if hit is not None:
        return hit
    p.start()
    if p.diagnose() is not None:
        t0 = time.perf_counter()
        p.set_candidates(recipe_bundles(p.target), t0)
        p.cands += p.model_bundles()
        p.begin_testing()
        p.test(p.cands, 1)
        p.n_cand = len(p.cands)                         # round 1 counts every candidate, simulated or not
        while True:
            met = p.critic(p.rounds)
            if not p.can_replan(met):
                break
            variants, seeds = p.replan_variants()
            variants += p.model_replan_bundles(seeds, variants)
            variants = variants[:MAX_SIMS_PER_ROUND]
            if not variants:
                break
            p.test(variants, p.rounds)
        p.rank()
        p.render()
    t0 = p.model_explain()
    p.log_explain_verify(t0)
    return p.assemble()
