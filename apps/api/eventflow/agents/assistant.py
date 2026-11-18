"""The assistant: one conversation engine behind POST /agent/chat for the command centre and the kiosk (decision #147).

    question ─► screen ─► route (chip → follow-up → word rules → model, if one is recorded or live → documents)
             ─► ONE tool path for that intent ─► structured answer with the run or document behind every statement

Rules it keeps:
  * Numbers come only from the forecast, the simulator and the agent team (CLAUDE.md rule 2). Documents explain
    methods and quote what an authority publishes; they never supply a load, a capacity or a forecast.
  * It calls the least it can: "when is the peak?" is one simulation, not a mission. Only plan questions run the team,
    and a mission is reused while the scenario stays the same.
  * A natural-language instruction can change the scenario ("attendance to 60,000, exit window 45 minutes"): the
    values are extracted, validated against config/assistant.yaml, the new scenario is forecast and simulated here,
    and the answer carries a typed patch the client applies to the shared scenario state. Anything unclear, out of
    range or that would hide crowding is asked back instead of applied.
  * The kiosk audience gets visitor answers only. It can never change the scenario, see plans or read internal controls.
  * The conversation's memory travels with the client (`context`), so the API stays stateless and two sessions can
    never see each other's context.
  * Text from the user is data. Instruction-like text is logged as a finding and never followed; nothing is applied
    from a message that contains one.

Answers are keys plus parameters; the client words them in English or Arabic. Parameter names say what they hold:
`*_st` a station id, `*_pct` a percentage, `*_n` a count, `*_x` a decimal, `*_t` a clock time, `*_s` text, `*_list` station ids.
"""
from __future__ import annotations

import json
import re
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from typing import Callable

from ..breakpoint import break_points
from ..config import corridor
from ..travel import advice as travel_advice
from . import confidence as conf
from . import knowledge, objectives, planner
from .brief import AR_DIGITS, _aliases, _find, _Reader, screen
from .standing import _DENY, answer as legacy_answer

PLANNER = ["peak", "overcrowded", "why_risk", "station_status", "best_plan", "compare", "lens", "whatif_attendance", "whatif_threshold",
           "break_point", "if_hot", "if_rain", "road", "confidence", "evidence", "why_changed", "edit", "undo", "knowledge", "help"]
KIOSK = ["which_station", "quieter_station", "when_leave", "accessible", "travel_options", "reach", "busiest", "knowledge", "help"]
LENSES = ["safety", "crowd", "wait", "cost", "accessibility", "emissions", "resources", "balanced"]
STATION_INTENTS = {"why_risk", "station_status", "which_station", "quieter_station", "when_leave", "travel_options"}

HYPO = r"what if|what happens if|what would|what about if|suppose|imagine|how would|would it|ماذا لو|ماذا يحدث|ماذا سيحدث"
EDIT_VERB = (r"\b(set|increase|raise|reduce|lower|decrease|shorten|lengthen|extend|widen|narrow|change|make|switch|put|prioriti[sz]e|update|"
             r"cut|drop|bump|double|halve|apply)\b|زد|ارفع|اخفض|قلل|قلّل|اجعل|غيّر|غير |قصّر|اضبط|طبّق|طبق")
DOWN = r"\b(reduce|lower|decrease|cut|drop|fewer|less|shorten|narrow|halve)\b|اخفض|قلل|قلّل|قصّر|أقل"
F_ATT = r"attendance|visitors?|people|crowd size|crowd|fans|attendees|guests|الحضور|حضور|الزوار|زوار|زائر"
F_EXIT = r"exit window|exit spread|exit time|exits? over|leave over|venue exit|نافذة الخروج|فترة الخروج|الخروج"
F_THR = r"comfort (line|threshold|level)|threshold|comfort|خط الراحة|حد الراحة|الحد"
F_SHARE = r"metro share|share (by|on|of) (the )?metro|by metro|نسبة المترو|حصة المترو"
F_PRIO = r"prioriti[sz]e|priority|focus on|optimi[sz]e for|أولوية|الأولوية|ركّز على|ركز على"
PRIO_WORDS = [("impact", r"safety|safe|relief|impact|crowd reduction|whatever it takes|سلامة|أمان|تخفيف"),
              ("cost", r"cost|cheap|budget|money|التكلفة|اقتصادي|الميزانية"), ("balanced", r"balanced?|balance|متوازن|التوازن")]
NUM = r"(\d+(?:\.\d+)?)\s*(k\b|thousand|ألف|الف)?"
PCT = r"(\d+(?:\.\d+)?)\s*(?:%|٪|percent|per cent|في المئة|بالمئة|في المائة)"

# (intent, pattern, extra args). First match wins; `edit` and the what-ifs are decided before these.
ROUTES_PLANNER: list[tuple[str, str, dict]] = [
    ("undo", r"^\s*(undo|revert|go back|change it back)\b|تراجع|ألغ التغيير", {}),
    ("why_changed", r"why did .{0,40}(change|differ)|what changed|why (is|was) (it|the (plan|recommendation)) different|recommendation change|"
                    r"لماذا تغيّر|لماذا تغير|ما الذي تغيّر|ما الذي تغير", {}),
    ("compare", r"\bcompare\b|side by side|top (three|3|two|2)|versus|\bvs\b|قارن|مقارنة", {}),
    ("lens", r"safe(st|ty)|passenger safety|الأكثر أمان|السلامة|الأمان", {"lens": "safety"}),
    ("lens", r"fewe(r|st)|less(er)? (staff|resources)|least resources|operational resources|resource|أقل موارد|الموارد", {"lens": "resources"}),
    ("lens", r"cheap(est|er)?|lowest cost|least cost|costs? (the )?least|أرخص|أقل تكلفة", {"lens": "cost"}),
    ("lens", r"emission|carbon|co2|green(est)?|انبعاث|الكربون", {"lens": "emissions"}),
    ("lens", r"shortest wait|least wait(ing)?|journey time|waiting time|أقل انتظار|وقت الانتظار", {"lens": "wait"}),
    ("lens", r"accessib\w+ (plan|option)|least walking|أقل مشي", {"lens": "accessibility"}),
    ("confidence", r"confiden|how sure|how certain|can (i|we) trust|reliab|uncertain|الثقة|مدى التأكد|موثوق", {}),
    ("evidence", r"evidence|what supports|based on what|where (does|do|did) .{0,30}come from|which data|data source|provenance|"
                 r"الدليل|الأدلة|ما مصدر|مصدر البيانات", {}),
    ("why_risk", r"\bwhy\b|what makes|reason|cause|at risk|لماذا|ما سبب|السبب", {}),
    ("break_point", r"break ?point|tip over|how many (visitors|people) (can|before|until)|at what crowd|نقطة الانكسار|كم زائر", {}),
    ("road", r"\broads?\b|traffic|\bcars\b|taxi|الطرق|السيارات|المرور", {}),
    ("best_plan", r"most effective|best (plan|option|measure|intervention)|which (intervention|plan|measure|option)|what should (we|i) do|"
                  r"recommend|\bplan\b|what do you suggest|ماذا نفعل|أفضل خطة|أفضل إجراء|توصي|التوصية|خطة", {}),
    ("overcrowded", r"overcrowd|over ?capacity|over the line|which stations?|worst|busiest station|most crowded|become crowded|"
                    r"أي محطة|أكثر محطة|مزدحمة|الأكثر ازدحام", {}),
    ("peak", r"\bwhen\b|what time|peak|busiest (time|moment|hour)|متى|الذروة|أي ساعة", {}),
    ("station_status", r"how (busy|crowded|full)|status of|load at|كم الازدحام|ما حال", {}),
    ("help", r"^\s*(hi|hello|hey|help|what can you do|السلام عليكم|مرحبا|مساعدة)\b", {}),
]
ROUTES_KIOSK: list[tuple[str, str, dict]] = [
    ("accessible", r"accessib|wheelchair|step[- ]?free|\blifts?\b|elevator|disab|determination|stroller|pram|pushchair|"
                   r"كرسي متحرك|الكرسي المتحرك|مصعد|مصاعد|أصحاب الهمم|عربة أطفال", {}),
    ("reach", r"how (can|do|would) i (reach|get)|get to|\breach\b|directions?|route to|way to|كيف أصل|الوصول إلى|الطريق إلى", {}),
    ("when_leave", r"when should i|what time|best time|when (to|do i) (leave|go|depart)|\bdepart|متى أغادر|متى أذهب|أي وقت|أفضل وقت", {}),
    ("quieter_station", r"less crowded|quieter|alternative|nearby|another station|avoid the crowd|أهدأ|أقل ازدحام|بديل|قريبة", {}),
    ("which_station", r"which station|what station|where should i|where do i|best station|أي محطة|من أي محطة", {}),
    ("travel_options", r"travel options?|other ways|how else|what options|options|\bbus\b|taxi|خيارات|وسائل", {}),
    ("busiest", r"busiest|most crowded|peak|rush|الذروة|الأكثر ازدحام", {}),
    ("help", r"^\s*(hi|hello|hey|help|السلام عليكم|مرحبا|مساعدة)\b", {}),
]
OTHER_MODES = r"\btram\b|ferry|water ?bus|\babra\b|monorail|\bflight|\bplane\b|ترام|عبّارة|العبرة"    # the twin covers the metro only
PLANNER_ONLY = r"plan\b|intervention|measure|threshold|comfort line|attendance to|approve|reject|cost|agent|simulat|خطة|إجراء|اعتماد|التكلفة"


@dataclass
class Deps:
    """What the engine may call (the API wires these to its own functions, tests to fakes of the same shape)."""
    run_for: Callable[[dict], dict]                       # ForecastRequest dict → forecast run (rebuilt or cached)
    simulate: Callable[..., dict]                         # main.run_simulation
    mission: Callable[[dict, object], dict]               # (run, AgentRunRequest) → mission
    make_request: Callable[..., object]                   # (**fields) → AgentRunRequest
    route_model: Callable[[str, list[str]], str | None] | None = None


_MISSIONS: "OrderedDict[str, dict]" = OrderedDict()
_LOCK = Lock()


def _dump(x) -> dict:
    return x.model_dump() if hasattr(x, "model_dump") else dict(x or {})


def _pct(v: float | None) -> int | None:
    return None if v is None else round(v * 100)


def _run_ref(tool: str, run_id: str | None) -> dict:
    return {"kind": "run", "id": run_id, "tool": tool, "run_id": run_id}


def mission_for(deps: Deps, run: dict, settings: dict, applied: list[dict], scope: str, locale: str) -> dict:
    """The agent team's mission for one scenario. Deterministic, so it is reused while the scenario is the same."""
    key = json.dumps([run["run_id"], applied, settings["threshold"], scope, settings["priority"], settings["constraints"], locale], sort_keys=True)
    with _LOCK:
        m = _MISSIONS.get(key)
    if m is None:
        areq = deps.make_request(forecast_run_id=run["run_id"], forecast=run["_spec"], locale=locale, threshold=settings["threshold"],
                                 scope=scope, priority=settings["priority"], applied=applied, constraints=settings["constraints"])
        m = deps.mission(run, areq)
        with _LOCK:
            _MISSIONS[key] = m
            while len(_MISSIONS) > 24:
                _MISSIONS.popitem(last=False)
    return m


class Turn:
    """One turn's working state: the request, the tools it has called, and what it will answer."""

    def __init__(self, req, run: dict, deps: Deps):
        self.req, self.run, self.deps = req, run, deps
        self.locale, self.audience = req.locale, req.audience
        self.thr = req.threshold if req.threshold is not None else corridor()["capacity"]["overcap_threshold"]
        self.applied = [_dump(i) for i in req.applied]
        self.ctx = _dump(req.context) if req.context else {}
        self.tools: list[dict] = []
        self.evidence: list[dict] = []
        self._base: dict | None = None
        self._detail: dict | None = None
        self.focus_station = self.ctx.get("focus_station")
        self.focus_hour = self.ctx.get("focus_hour")
        self.corr = [s["id"] for s in corridor()["stations"] if s.get("in_corridor")]
        cur = current_settings(req)                       # the scenario moved since the last turn (sliders, or a patch the client applied)
        self.moved = bool(self.ctx.get("settings")) and self.ctx["settings"] != cur
        self.previous = self.ctx["settings"] if self.moved else self.ctx.get("previous")

    # ---- tools (each call is recorded: the answer shows what ran)
    def note(self, tool: str, run_id: str | None) -> None:
        if run_id and not any(t["run_id"] == run_id for t in self.tools):
            self.tools.append({"tool": tool, "run_id": run_id})
            self.evidence.append(_run_ref(tool, run_id))

    def base(self) -> dict:
        if self._base is None:
            self._base = self.deps.simulate(self.run["run_id"], self.applied, False, self.thr, self.req.scope)
        self.note("simulate", self._base["run_id"])
        return self._base

    def detail(self) -> dict:
        if self._detail is None:
            self._detail = self.deps.simulate(self.run["run_id"], self.applied, True, self.thr, self.req.scope)
        self.note("simulate", self._detail["run_id"])
        return self._detail

    def sim_of(self, run: dict, thr: float | None = None) -> dict:
        s = self.deps.simulate(run["run_id"], self.applied, False, self.thr if thr is None else thr, self.req.scope)
        self.note("forecast", run["run_id"])
        self.note("simulate", s["run_id"])
        return s

    def mission(self, run: dict | None = None, settings: dict | None = None) -> dict:
        run = run or self.run
        s = settings or {"threshold": self.req.threshold, "priority": self.req.priority, "constraints": _dump(self.req.constraints)}
        m = mission_for(self.deps, run, s, self.applied, self.req.scope, self.locale)
        self.note("agent_team", m["mission_id"])
        return m

    def worst(self) -> dict:
        return max(self.base()["hourly"], key=lambda r: (r["peak_lf"], -r["hour"]))

    def station_peak(self, station: str) -> dict | None:
        rows = [r for r in self.base()["hourly"] if r["station_id"] == station]
        return max(rows, key=lambda r: (r["peak_lf"], -r["hour"])) if rows else None

    def event_hour(self) -> int:
        end = (self.run.get("end_used") or "18:00")[:2]
        return max(5, min(23, int(end)))


# ---------------------------------------------------------------- reading the message
def clean(text: str) -> str:
    t = (text or "").translate(AR_DIGITS).lower().replace("’", "'")
    return re.sub(r"(?<=\d)[,٬](?=\d{3}\b)", "", t)                 # 60,000 → 60000


def find_station(text: str) -> str | None:
    for alias, sid in _aliases():
        if _find(text, alias):
            return sid
    m = re.search(r"\bmax\b(?! (impact|relief))", text)                # 'Max' the station, not 'max impact'
    return "MAX" if m else None


def _number(seg: str) -> float | None:
    m = re.search(NUM, seg)
    if not m:
        return None
    return float(m.group(1)) * (1000 if m.group(2) else 1)


def parse_edit(text: str, cur: dict, ranges: dict) -> list[dict]:
    """The scenario changes an instruction asks for: [{field, to, status}] with status ok | needs_value | out_of_range | confirm."""
    out: list[dict] = []

    def add(field: str, to, status: str = "ok", **extra) -> None:
        if not any(c["field"] == field for c in out):
            out.append({"field": field, "from": cur.get(field), "to": to, "status": status, **extra})

    for clause in re.split(r"[;.،؛]|,|\band\b|\bthen\b|\bو(?=[اأإقزغ])", text):
        c = clause.strip()
        if not c:
            continue
        pct, down = re.search(PCT, c), bool(re.search(DOWN, c))
        if re.search(F_EXIT, c):
            v = _number(re.sub(PCT, "", c))
            if v is None:
                add("exit_sigma_min", None, "needs_value", direction="down" if down else "up")
            else:
                add("exit_sigma_min", v)
        elif re.search(F_THR, c):
            v = float(pct.group(1)) / 100 if pct else _number(c)
            if v is not None and v > 1:
                v = v / 100
            add("threshold", None if v is None else round(v, 3), "ok" if v is not None else "needs_value")
        elif re.search(F_SHARE, c):
            v = float(pct.group(1)) / 100 if pct else _number(c)
            if v is not None and v > 1:
                v = v / 100
            add("metro_share", None if v is None else round(v, 3), "ok" if v is not None else "needs_value")
        elif re.search(F_ATT, c) or re.search(r"\bdouble\b|\bhalve\b", c):
            now = cur.get("attendance")
            if re.search(r"\bdouble\b", c):
                add("attendance", None if now is None else round(now * 2), "ok" if now else "needs_value")
            elif re.search(r"\bhalve\b", c):
                add("attendance", None if now is None else round(now / 2), "ok" if now else "needs_value")
            elif pct and now:
                add("attendance", round(now * (1 + (-1 if down else 1) * float(pct.group(1)) / 100)))
            else:
                v = _number(c)
                add("attendance", None if v is None else round(v), "ok" if v is not None else "needs_value", direction="down" if down else "up")
        if re.search(F_PRIO, c):
            p = next((k for k, pat in PRIO_WORDS if re.search(pat, c)), None)
            if p:
                add("priority", p, read_as="safety" if (p == "impact" and re.search(r"safe|سلامة|أمان", c)) else None)
        if re.search(r"\bhot\b|heat|حار|الحر", c) and not re.search(F_THR, c):
            add("weather", "hot")
        elif re.search(r"\brain|ممطر|المطر|مطر", c):
            add("weather", "rain")
        elif re.search(r"normal (weather|day)|clear (weather|day)|mild|طقس عادي|معتدل", c):
            add("weather", "normal")
    for c in out:                                                       # validate against the configured ranges
        if c["status"] != "ok":
            continue
        lo, hi = ranges.get(c["field"], (None, None))
        if c["field"] == "exit_sigma_min":
            step = ranges["exit_step"]
            c["to"] = int(round(c["to"] / step) * step)
        if c["field"] == "threshold":
            c["to"] = round(round(c["to"] / ranges["threshold_step"]) * ranges["threshold_step"], 2)
        if lo is not None and not (lo <= c["to"] <= hi):
            c.update(status="out_of_range", min=lo, max=hi)
        elif c["field"] == "threshold" and c["to"] > ranges["threshold_confirm_above"] and (cur.get("threshold") or 0) < c["to"]:
            c["status"] = "confirm"
    return [c for c in out if c["status"] != "ok" or c["to"] != c["from"]]


def classify(text: str, audience: str, ctx: dict) -> tuple[str | None, dict, str]:
    """(intent, args, how) for a typed question. None = no rule matched (the model or the documents may still answer)."""
    st = find_station(text)
    args: dict = {"station": st} if st else {}
    hypo = bool(re.search(HYPO, text))
    pct, last = re.search(PCT, text), ctx.get("last_intent")
    if audience == "kiosk":
        if re.search(OTHER_MODES, text):                                # a tram or ferry question is not answered with metro figures
            return None, args, "rules"
        for intent, pat, extra in ROUTES_KIOSK:
            if re.search(pat, text):
                return intent, {**args, **extra}, "rules"
        if st and last in STATION_INTENTS:
            return last, args, "followup"
        return None, args, "rules"
    if re.search(r"^\s*(apply|do) (it|that|this)\b|^\s*(yes|ok|okay)[ ,.!]*(apply|do it)?\s*$|^\s*طبّقه|^\s*نعم", text) and last in ("whatif_attendance", "whatif_threshold"):
        return "edit", {**(ctx.get("last_args") or {}), "from_whatif": True}, "followup"
    wants_att, wants_thr = bool(re.search(F_ATT + r"|\bdouble\b|\bbigger\b|more come", text)), bool(re.search(F_THR, text))
    if hypo and (wants_att or wants_thr):
        return ("whatif_threshold" if wants_thr and not wants_att else "whatif_attendance"), args, "rules"
    if hypo and re.search(r"\bhot\b|heat|حار", text):
        return "if_hot", args, "rules"
    if hypo and re.search(r"\brain|مطر", text):
        return "if_rain", args, "rules"
    if not hypo and re.search(EDIT_VERB, text) and re.search("|".join([F_ATT, F_EXIT, F_THR, F_SHARE, F_PRIO, r"\bhot\b|\brain|heat|حار|مطر|\bdouble\b|\bhalve\b"]), text):
        return "edit", args, "rules"
    for intent, pat, extra in ROUTES_PLANNER:
        if re.search(pat, text):
            return intent, {**args, **extra}, "rules"
    # follow-ups: a bare station, a bare percentage, "and if it rains?"
    if re.search(r"\brain|مطر", text):
        return "if_rain", args, "followup"
    if re.search(r"\bhot\b|heat|حار", text):
        return "if_hot", args, "followup"
    if pct and last in ("whatif_attendance", "whatif_threshold"):
        return last, args, "followup"
    if st and len(text.split()) <= 6:                                 # "and Emirates Towers?": the last question, about another station
        return (last if last in STATION_INTENTS else "station_status"), args, "followup"
    return None, args, "rules"


# ---------------------------------------------------------------- settings
def current_settings(req) -> dict:
    return {"forecast": _dump(req.forecast), "threshold": req.threshold, "priority": req.priority, "constraints": _dump(req.constraints)}


def _flat(settings: dict, run: dict | None = None) -> dict:
    """The scenario's adjustable values, as the planner sees them (the run fills in the event's own defaults)."""
    f = settings["forecast"]
    custom = f.get("custom_event") or {}
    att = custom.get("attendance") if custom else f.get("attendance")
    return {"event": "custom" if custom else f.get("event_id"), "attendance": att if att is not None else (run or {}).get("attendance_used"),
            "exit_sigma_min": f.get("exit_sigma_min") if f.get("exit_sigma_min") is not None else (run or {}).get("exit_sigma_used"),
            "weather": f.get("weather", "normal"),
            "metro_share": f.get("metro_share") if f.get("metro_share") is not None else (run or {}).get("metro_share_used"),
            "threshold": settings["threshold"], "priority": settings["priority"],
            "forbid": sorted(settings["constraints"].get("forbid_types") or []), "protect": sorted(settings["constraints"].get("protect_stations") or []),
            "cost_cap": settings["constraints"].get("cost_cap")}


def apply_changes(settings: dict, changes: list[dict]) -> dict:
    s = json.loads(json.dumps(settings))
    f = s["forecast"]
    for c in changes:
        k, v = c["field"], c["to"]
        if k == "attendance":
            if f.get("custom_event"):
                f["custom_event"]["attendance"] = int(v)
            else:
                f["attendance"] = int(v)
        elif k == "exit_sigma_min":
            f["exit_sigma_min"] = float(v)
        elif k == "metro_share":
            f["metro_share"] = float(v)
        elif k == "weather":
            f["weather"] = v
        elif k == "threshold":
            s["threshold"] = float(v)
        elif k == "priority":
            s["priority"] = v
        elif k == "forbid":
            s["constraints"]["forbid_types"] = list(v)
        elif k == "protect":
            s["constraints"]["protect_stations"] = list(v)
        elif k == "cost_cap":
            s["constraints"]["cost_cap"] = v
    return s


# ---------------------------------------------------------------- planner answers
def a_peak(t: Turn, a: dict) -> dict:
    w = t.worst()
    t.focus_station, t.focus_hour = w["station_id"], w["hour"]
    return {"blocks": [{"key": "chat.peak", "params": {"station_st": w["station_id"], "hour_t": f"{w['hour']:02d}:00", "peak_pct": _pct(w["peak_lf"])}}],
            "suggestions": ["why_risk", "best_plan", "whatif_attendance"]}


def a_overcrowded(t: Turn, a: dict) -> dict:
    b = t.base()
    over: dict[str, float] = {}
    for r in b["hourly"]:
        if r["overcap_bins"]:
            over[r["station_id"]] = over.get(r["station_id"], 0.0) + r["overcap_bins"] / b["summary"]["bins_per_hour"]
    w = t.worst()
    t.focus_station, t.focus_hour = w["station_id"], w["hour"]
    if not over:
        return {"blocks": [{"key": "chat.noneOver", "params": {"station_st": w["station_id"], "peak_pct": _pct(w["peak_lf"]), "thr_pct": _pct(t.thr),
                                                             "hour_t": f"{w['hour']:02d}:00"}}],
                "suggestions": ["break_point", "whatif_attendance", "confidence"]}
    order = sorted(over, key=lambda s: (-over[s], s))
    top = t.station_peak(order[0])
    t.focus_station, t.focus_hour = order[0], top["hour"]
    blocks = [{"key": "chat.overcrowded", "params": {"station_st": order[0], "over_x": round(over[order[0]], 2), "peak_pct": _pct(top["peak_lf"]),
                                                     "hour_t": f"{top['hour']:02d}:00", "thr_pct": _pct(t.thr)}}]
    if len(order) > 1:
        blocks.append({"key": "chat.alsoOver", "params": {"others_list": order[1:]}})
    return {"blocks": blocks, "suggestions": ["why_risk", "best_plan", "confidence"]}


def a_why_risk(t: Turn, a: dict) -> dict:
    st = a.get("station") or t.focus_station or t.worst()["station_id"]
    pk = t.station_peak(st)
    if pk is None:
        return {"status": "insufficient_evidence", "blocks": [{"key": "chat.outsideCorridor", "params": {}}], "suggestions": ["overcrowded"]}
    t.focus_station, t.focus_hour = st, pk["hour"]
    row = next((r for r in t.run["rows"] if r["station_id"] == st and r["hour"] == pk["hour"]), None)
    t.note("forecast", t.run["run_id"])
    share = round(row["event_entries_p50"] / row["entries_p50"] * 100) if row and row["entries_p50"] else 0
    over = pk["peak_lf"] > t.thr
    blocks = [{"key": "chat.why" if over else "chat.whyOk",
               "params": {"station_st": st, "hour_t": f"{pk['hour']:02d}:00", "peak_pct": _pct(pk["peak_lf"]), "thr_pct": _pct(t.thr),
                          "demand_n": round(pk["demand"]), "capacity_n": round(pk["capacity"]), "trains_n": round(pk["trains_per_hour"])}}]
    if share > 0:
        blocks.append({"key": "chat.whyEvent", "params": {"share_pct": share, "att_n": t.run.get("attendance_used") or 0}})
    bp = break_points(t.run, t.thr, [st])
    t.note("breakpoint", bp["run_id"])
    brk = next((s["break_attendance"] for s in bp["stations"] if s["station_id"] == st), None)
    if brk and t.run.get("attendance_used"):
        blocks.append({"key": "chat.whyBreak", "params": {"brk_n": brk, "att_n": t.run["attendance_used"]}})
    hit = knowledge.by_id("model.capacity")
    if hit:
        t.evidence.append(knowledge.cite(hit, t.locale))
    return {"blocks": blocks, "suggestions": ["best_plan", "break_point", "evidence"]}


def a_station_status(t: Turn, a: dict) -> dict:
    st = a.get("station") or t.focus_station or t.req.station or t.worst()["station_id"]
    pk = t.station_peak(st)
    if pk is None:
        return {"status": "insufficient_evidence", "blocks": [{"key": "chat.outsideCorridor", "params": {}}], "suggestions": ["overcrowded"]}
    t.focus_station, t.focus_hour = st, pk["hour"]
    return {"blocks": [{"key": "chat.station", "params": {"station_st": st, "hour_t": f"{pk['hour']:02d}:00", "peak_pct": _pct(pk["peak_lf"]),
                                                          "thr_pct": _pct(t.thr), "trains_n": round(pk["trains_per_hour"])}}],
            "suggestions": ["why_risk", "best_plan"]}


def _option(mission: dict, rank: int | None) -> dict | None:
    return next((o for o in mission["plan"]["options"] if o["rank"] == rank), None)


def a_best_plan(t: Turn, a: dict) -> dict:
    m = t.mission()
    plan, rank = m["plan"], m.get("recommended_rank")
    o = _option(m, rank) or (plan["options"][0] if plan["options"] else None)
    if not o:
        w = t.worst()
        return {"blocks": [{"key": "chat.noPlanNeeded", "params": {"station_st": w["station_id"], "peak_pct": _pct(w["peak_lf"]), "thr_pct": _pct(t.thr)}}],
                "suggestions": ["break_point", "whatif_attendance"], "confidence": conf.report(t.run, t.base(), m, None)}
    b, rec = plan["baseline_summary"], m.get("recommendation") or {}
    t.note("simulate", o["sources"][0]["run_id"])
    blocks = [{"key": "chat.best", "params": {"title_s": o["title"], "rank_n": o["rank"], "excess_b_n": round(b["excess_pax"]),
                                              "excess_a_n": round(o["summary"]["excess_pax"]), "peak_b_pct": _pct(b["peak_lf"]),
                                              "peak_a_pct": _pct(o["summary"]["peak_lf"])}}]
    asm = next((x for x in m.get("assessments", []) if x["rank"] == o["rank"]), None)
    if asm:
        blocks.append({"key": "chat.bestChecks", "params": {"passed_n": rec.get("passed", 0), "applicable_n": rec.get("applicable", 0),
                                                            "holds_n": asm.get("holds") or 0, "total_n": asm.get("total") or 0}})
    return {"blocks": blocks, "confidence": conf.report(t.run, t.base(), m, o["rank"]), "suggestions": ["compare", "lens:safety", "confidence"],
            "last_args": {"rank": o["rank"]}}


def _table(cmp: dict, limit: int | None = None) -> dict:
    rows = cmp["rows"][:limit] if limit else cmp["rows"]
    return {"lens": cmp["lens"], "weights": cmp["weights"], "ignored": cmp["ignored"], "objectives": cmp["objectives"],
            "considered": cmp["considered"], "blocked": cmp["blocked"], "recommended_rank": cmp["recommended_rank"], "note": cmp["note"],
            "rows": [{k: r[k] for k in ("id", "rank", "title", "offered", "eligible", "blocked_by", "goal_met", "pareto", "score", "values",
                                        "parts", "lifecycle", "run_id", "parties", "quantities", "holds", "stress_total", "failed_checks")} for r in rows]}


def a_compare(t: Turn, a: dict) -> dict:
    m = t.mission()
    if not m["plan"]["options"]:
        return a_best_plan(t, a)
    cmp = objectives.compare(m, "balanced", locale=t.locale, applied_sig=planner._sig(t.applied) if t.applied else None, offered_only=True)
    cmp["rows"].sort(key=lambda r: r["rank"] or 99)
    for r in cmp["rows"]:
        t.note("simulate", r["run_id"])
    return {"blocks": [{"key": "chat.compare", "params": {"shown_n": len(cmp["rows"]), "tested_n": len(m.get("rejected", [])) + len(cmp["rows"])}}],
            "table": _table(cmp), "suggestions": ["lens:safety", "lens:cost", "lens:resources", "confidence"]}


def a_lens(t: Turn, a: dict) -> dict:
    lens = a.get("lens") if a.get("lens") in LENSES else "balanced"
    m = t.mission()
    if not m["plan"]["options"]:
        return a_best_plan(t, a)
    cmp = objectives.compare(m, lens, weights=a.get("weights"), locale=t.locale, applied_sig=planner._sig(t.applied) if t.applied else None)
    top = cmp["rows"][0] if cmp["rows"] and cmp["rows"][0]["eligible"] else None
    rec = _option(m, m.get("recommended_rank"))
    blocks, status = [], "answered"
    if lens in cmp["ignored"]:                                       # asked for something the twin does not measure: say so first
        status = "insufficient_evidence"
        blocks.append({"key": "chat.notMeasured", "params": {"what_s": lens}})
        hit = knowledge.by_id("model.road")
        if hit:
            t.evidence.append(knowledge.cite(hit, t.locale))
    if top:
        t.note("simulate", top["run_id"])
        blocks.append({"key": "chat.lensClosest" if lens in cmp["ignored"] else "chat.lensTop", "params": {"lens_s": lens, "title_s": top["title"], "peak_pct": _pct(top["values"]["safety"]),
                                                         "excess_n": round(top["values"]["crowd"]), "wait_x": top["values"]["wait"],
                                                         "cost_x": top["values"]["cost"], "parties_n": top["values"]["resources"]}})
        if lens in cmp["ignored"]:
            pass
        elif rec and top["rank"] == rec["rank"]:
            blocks.append({"key": "chat.lensSame", "params": {}})
        elif rec:
            blocks.append({"key": "chat.lensDiffers" if top["offered"] else "chat.lensNotOffered", "params": {"rec_s": rec["title"]}})
    if cmp["blocked"]:
        blocks.append({"key": "chat.lensBlocked", "params": {"blocked_n": cmp["blocked"]}})
    return {"status": status, "blocks": blocks, "table": _table(cmp, 5), "suggestions": ["compare", "confidence", "best_plan"], "last_args": {"lens": lens}}


def _headline(sim: dict) -> dict:
    w = max(sim["hourly"], key=lambda r: (r["peak_lf"], -r["hour"]))
    return {"worst": w["station_id"], "peak": w["peak_lf"], "over": sim["summary"]["overcap_station_hours"],
            "stations_over": len({r["station_id"] for r in sim["hourly"] if r["overcap_bins"]})}


def a_whatif_attendance(t: Turn, a: dict, text: str = "") -> dict:
    cfg = objectives.settings()
    now = t.run.get("attendance_used")
    if not now:
        return {"status": "insufficient_evidence", "blocks": [{"key": "chat.noEvent", "params": {}}], "suggestions": ["peak"]}
    to = a.get("attendance")
    if to is None:
        pct = re.search(PCT, text)
        n = _number(re.sub(PCT, "", text)) if not pct else None
        if pct:
            to = round(now * (1 + (-1 if re.search(DOWN, text) else 1) * float(pct.group(1)) / 100))
        elif n and n >= 1000:
            to = round(n)
        elif re.search(r"\bdouble\b", text):
            to = now * 2
        else:
            to = round(now * (1 + cfg["default_whatif_pct"] / 100))
    lo, hi = cfg["ranges"]["attendance"]
    if not lo <= to <= hi:
        return {"status": "clarify", "blocks": [{"key": "chat.outOfRange", "params": {"field_s": "attendance", "min_n": lo, "max_n": hi, "value_n": to}}],
                "suggestions": ["whatif_attendance"]}
    new = apply_changes(current_settings(t.req), [{"field": "attendance", "to": to}])
    run2 = t.deps.run_for(new["forecast"])
    b, s2 = _headline(t.base()), _headline(t.sim_of(run2))
    return {"blocks": [{"key": "chat.whatifAtt", "params": {"att_b_n": now, "att_a_n": to, "over_b_x": b["over"], "over_a_x": s2["over"],
                                                            "peak_b_pct": _pct(b["peak"]), "peak_a_pct": _pct(s2["peak"]), "worst_st": s2["worst"]}},
                       {"key": "chat.notApplied", "params": {}}],
            "options": [{"label_key": "chat.opt.apply", "params": {}, "intent": "edit", "args": {"attendance": to}}],
            "suggestions": ["best_plan", "break_point"], "last_args": {"attendance": to}}


def a_whatif_threshold(t: Turn, a: dict, text: str = "") -> dict:
    to = a.get("threshold")
    if to is None:
        pct = re.search(PCT, text)
        v = float(pct.group(1)) / 100 if pct else _number(text)
        if v is not None and v > 1:
            v /= 100
        to = round(v, 3) if v is not None else None
    if to is None or not 0.5 <= to <= 1.0:
        lo, hi = objectives.settings()["ranges"]["threshold"]
        return {"status": "clarify", "blocks": [{"key": "chat.needThreshold", "params": {"min_pct": _pct(lo), "max_pct": _pct(hi)}}],
                "options": [{"label_key": "chat.opt.pct", "params": {"v_pct": p}, "intent": "whatif_threshold", "args": {"threshold": p / 100}} for p in (80, 90)],
                "suggestions": []}
    b = _headline(t.base())
    s2 = _headline(t.sim_of(t.run, to))
    return {"blocks": [{"key": "chat.whatifThr", "params": {"thr_b_pct": _pct(t.thr), "thr_a_pct": _pct(to), "over_b_x": b["over"], "over_a_x": s2["over"],
                                                            "st_b_n": b["stations_over"], "st_a_n": s2["stations_over"]}},
                       {"key": "chat.notApplied", "params": {}}],
            "options": [{"label_key": "chat.opt.apply", "params": {}, "intent": "edit", "args": {"threshold": to}}],
            "suggestions": ["overcrowded", "best_plan"], "last_args": {"threshold": to}}


def a_legacy(intent: str):
    def run(t: Turn, a: dict) -> dict:
        r = legacy_answer(intent, t.run, t.req, t.base(), t.deps.simulate, None)
        for s in r["sources"]:
            t.note(s["tool"], s["run_id"])
        p = r["params"]
        named = {"station_st": p.get("station"), "hour_t": f"{p['hour']:02d}:00" if p.get("hour") is not None else None, "peak_pct": p.get("peak_pct"),
                 "att_n": p.get("attendance"), "now_n": p.get("now"), "over_b_x": p.get("over_before"), "over_a_x": p.get("over_after"),
                 "peak_b_pct": p.get("peak_before_pct"), "peak_a_pct": p.get("peak_after_pct"), "veh_n": p.get("veh"), "pressure_pct": p.get("pressure_pct")}
        return {"blocks": [{"key": r["key"].replace("ask.", "chat."), "params": {k: v for k, v in named.items() if v is not None}}],
                "suggestions": ["best_plan", "confidence"]}
    return run


def a_confidence(t: Turn, a: dict) -> dict:
    m = t.mission()
    rank = a.get("rank") or m.get("recommended_rank")
    rep = conf.report(t.run, t.base(), m, rank if m["plan"]["options"] else None)
    hit = knowledge.by_id("agents.confidence")
    if hit:
        t.evidence.append(knowledge.cite(hit, t.locale))
    if rep["forecast"].get("backtest"):
        t.evidence.append({"kind": "eval", "id": rep["forecast"]["backtest"]["file"], "tool": "backtest", "run_id": None})
    return {"blocks": [{"key": "chat.confidence", "params": {"overall_s": rep["overall"], "limiting_s": ",".join(rep["limiting"])}},
                       {"key": "chat.confidenceSynthetic" if t.run["is_synthetic"] else "chat.confidenceReal", "params": {}}],
            "confidence": rep, "suggestions": ["evidence", "compare"]}


def a_evidence(t: Turn, a: dict) -> dict:
    t.note("forecast", t.run["run_id"])
    f = conf.forecast_part(t.run, t.base())
    bt = f.get("backtest") or {}
    blocks = [{"key": "chat.evidenceData" if t.run["is_synthetic"] else "chat.evidenceReal", "params": {"dataset_s": t.run.get("dataset_version") or ""}},
              {"key": "chat.evidenceBand", "params": {"station_st": f["station"], "hour_t": f"{f['hour']:02d}:00", "p10_n": f["p10"] or 0, "p50_n": f["p50"] or 0,
                                                      "p90_n": f["p90"] or 0}}]
    if bt.get("mase") is not None:
        blocks.append({"key": "chat.evidenceBacktestServed" if bt.get("model") == "served_profile" else "chat.evidenceBacktest", "params": {"mase_x": round(bt["mase"], 2), "naive_x": round(bt["naive_mase"], 2),
                                                                  "coverage_pct": _pct(bt["coverage80"]), "rows_n": bt["n"]}})
        t.evidence.append({"kind": "eval", "id": bt["file"], "tool": "backtest", "run_id": None})
        if f.get("band_too_narrow"):
            blocks.append({"key": "chat.evidenceNarrow", "params": {"coverage_pct": _pct(bt["coverage80"])}})
    for pid in ("model.forecast", "model.data", "data.gtfs"):
        hit = knowledge.by_id(pid)
        if hit:
            t.evidence.append(knowledge.cite(hit, t.locale))
    return {"blocks": blocks, "confidence": conf.report(t.run, t.base()), "suggestions": ["confidence", "why_risk"]}


def a_why_changed(t: Turn, a: dict) -> dict:
    prev = t.previous
    cur = current_settings(t.req)
    if not prev or prev == cur:
        return {"blocks": [{"key": "chat.noChange", "params": {}}], "suggestions": ["best_plan", "edit"]}
    run_b = t.deps.run_for(prev["forecast"])
    fb, fa = _flat(prev, run_b), _flat(cur, t.run)
    blocks = [{"key": "chat.changed", "params": {"field_s": k, "from_s": _show(fb[k]), "to_s": _show(fa[k])}} for k in fa if fb.get(k) != fa[k]]
    sim_b = t.deps.simulate(run_b["run_id"], t.applied, False, prev["threshold"] if prev["threshold"] is not None else t.thr, t.req.scope)
    t.note("simulate", sim_b["run_id"])
    hb, ha = _headline(sim_b), _headline(t.base())
    blocks.append({"key": "chat.changedEffect", "params": {"peak_b_pct": _pct(hb["peak"]), "peak_a_pct": _pct(ha["peak"]), "over_b_x": hb["over"],
                                                           "over_a_x": ha["over"], "worst_st": ha["worst"]}})
    mb = t.mission(run_b, {"threshold": prev["threshold"], "priority": prev["priority"], "constraints": prev["constraints"]})
    ma = t.mission()
    ob, oa = _option(mb, mb.get("recommended_rank")), _option(ma, ma.get("recommended_rank"))
    if ob and oa:
        same = planner._sig(ob["interventions"]) == planner._sig(oa["interventions"])
        blocks.append({"key": "chat.changedPlanSame" if same else "chat.changedPlan", "params": {"rec_b_s": ob["title"], "rec_a_s": oa["title"]}})
    elif ob or oa:
        blocks.append({"key": "chat.changedPlanNow" if oa else "chat.changedPlanGone", "params": {"rec_s": (oa or ob)["title"]}})
    return {"blocks": blocks, "suggestions": ["compare", "confidence"]}


def _show(v) -> str:
    if isinstance(v, list):
        return ", ".join(str(x) for x in v) or "-"
    return "-" if v is None else str(v)


def a_edit(t: Turn, a: dict, text: str = "") -> dict:
    cfg = objectives.settings()
    cur = current_settings(t.req)
    flat = _flat(cur, t.run)
    explicit = {k: a[k] for k in ("attendance", "exit_sigma_min", "threshold", "metro_share", "weather", "priority") if a.get(k) is not None}
    if explicit:                                                     # a button: values already chosen, still validated below
        changes = [{"field": k, "from": flat.get(k), "to": v, "status": "ok"} for k, v in explicit.items() if v != flat.get(k)]
        for c in changes:
            lo, hi = cfg["ranges"].get(c["field"], (None, None))
            if c["field"] == "threshold":
                c["to"] = round(round(float(c["to"]) / cfg["ranges"]["threshold_step"]) * cfg["ranges"]["threshold_step"], 2)
            if lo is not None and not (lo <= c["to"] <= hi):
                c.update(status="out_of_range", min=lo, max=hi)
            elif c["field"] == "threshold" and c["to"] > cfg["ranges"]["threshold_confirm_above"] and not a.get("confirmed") and (flat["threshold"] or 0) < c["to"]:
                c["status"] = "confirm"
    else:
        changes = parse_edit(text, flat, cfg["ranges"])
        fields = _Reader(text, __import__("datetime").date.today()).read()        # measures to avoid, stations to protect, a cost cap
        for key, field in (("forbid", "forbid"), ("protect", "protect")):
            got = (fields.get(field) or {}).get("value")
            if got:
                merged = sorted(set(flat[key]) | set(got))
                if merged != flat[key]:
                    changes.append({"field": key, "from": flat[key], "to": merged, "status": "ok"})
        cap = (fields.get("cost_cap") or {}).get("value")
        if cap is not None and cap != flat["cost_cap"]:
            changes.append({"field": "cost_cap", "from": flat["cost_cap"], "to": cap, "status": "ok"})
    if not changes:
        return {"status": "clarify", "blocks": [{"key": "chat.editNothing", "params": {}}], "suggestions": ["help"]}
    ok = [c for c in changes if c["status"] == "ok"]
    carry = {c["field"]: c["to"] for c in ok if c["field"] in ("attendance", "exit_sigma_min", "threshold", "metro_share", "weather", "priority")}
    bad = [c for c in changes if c["status"] != "ok"]
    if bad:                                                          # ask back; one tap then applies everything that was understood
        c, blocks, options = bad[0], [], []
        if c["status"] == "out_of_range":
            pctf = c["field"] in ("threshold", "metro_share")
            blocks.append({"key": "chat.outOfRangePct" if pctf else "chat.outOfRange",
                           "params": ({"field_s": c["field"], "min_pct": _pct(c["min"]), "max_pct": _pct(c["max"]), "value_pct": _pct(c["to"])} if pctf else
                                      {"field_s": c["field"], "min_n": c["min"], "max_n": c["max"], "value_n": c["to"]})})
            near = c["min"] if c["to"] < c["min"] else c["max"]
            options.append({"label_key": "chat.opt.pct" if pctf else "chat.opt.value", "params": {"v_pct": _pct(near)} if pctf else {"v_n": near},
                            "intent": "edit", "args": {**carry, c["field"]: near}})
        elif c["status"] == "confirm":
            blocks.append({"key": "chat.confirmThreshold", "params": {"to_pct": _pct(c["to"]), "limit_pct": _pct(cfg["ranges"]["threshold_confirm_above"])}})
            options.append({"label_key": "chat.opt.confirm", "params": {"v_pct": _pct(c["to"])}, "intent": "edit", "args": {**carry, "threshold": c["to"], "confirmed": True}})
        else:
            blocks.append({"key": "chat.needValue", "params": {"field_s": c["field"]}})
            if c["field"] == "attendance" and flat["attendance"]:
                sign = -1 if c.get("direction") == "down" else 1
                options += [{"label_key": "chat.opt.value", "params": {"v_n": round(flat["attendance"] * (1 + sign * p / 100))}, "intent": "edit",
                             "args": {**carry, "attendance": round(flat["attendance"] * (1 + sign * p / 100))}} for p in cfg["clarify_attendance_pct"]]
            elif c["field"] == "exit_sigma_min" and flat["exit_sigma_min"]:
                lo, hi = cfg["ranges"]["exit_sigma_min"]
                for d in ((-15, -30) if c.get("direction") == "down" else (15, 30)):
                    v = int(flat["exit_sigma_min"] + d)
                    if lo <= v <= hi:
                        options.append({"label_key": "chat.opt.minutes", "params": {"v_n": v}, "intent": "edit", "args": {**carry, "exit_sigma_min": v}})
            elif c["field"] == "threshold":
                options += [{"label_key": "chat.opt.pct", "params": {"v_pct": p}, "intent": "edit", "args": {**carry, "threshold": p / 100}} for p in (80, 85, 90)]
        options.append({"label_key": "chat.opt.cancel", "params": {}, "intent": "help", "args": {}})
        return {"status": "clarify", "blocks": blocks, "options": options, "suggestions": []}
    return _patch(t, cur, apply_changes(cur, ok), ok, "chat.applied")


def _patch(t: Turn, cur: dict, new: dict, changes: list[dict], headline: str) -> dict:
    """Forecast and simulate the new scenario here, and hand the client the typed patch that makes it the shared state."""
    try:
        run2 = t.deps.run_for(new["forecast"])
    except Exception as e:                                           # the forecast refused the values: nothing is applied
        return {"status": "clarify", "blocks": [{"key": "chat.editRejected", "params": {"why_s": str(e)[:160]}}], "suggestions": ["help"]}
    thr2 = new["threshold"] if new["threshold"] is not None else t.thr
    sim2 = t.deps.simulate(run2["run_id"], t.applied, False, thr2, t.req.scope)
    bp = break_points(run2, thr2, t.corr)
    hb, ha = _headline(t.base()), _headline(sim2)
    for tool, rid in (("forecast", run2["run_id"]), ("simulate", sim2["run_id"]), ("breakpoint", bp["run_id"])):
        t.note(tool, rid)
    version = int(t.req.scenario_version) + 1
    blocks = [{"key": headline, "params": {"changes_n": len(changes), "version_n": version}}]
    for c in changes:
        pctf = c["field"] in ("threshold", "metro_share")
        blocks.append({"key": f"chat.set.{c['field']}", "params": ({"from_pct": _pct(c["from"]), "to_pct": _pct(c["to"])} if pctf and c["from"] is not None else
                                                                 {"to_pct": _pct(c["to"])} if pctf else {"from_s": _show(c["from"]), "to_s": _show(c["to"])})})
        if c.get("read_as"):
            blocks.append({"key": "chat.readAs.safety", "params": {}})
    blocks.append({"key": "chat.effect", "params": {"peak_b_pct": _pct(hb["peak"]), "peak_a_pct": _pct(ha["peak"]), "over_b_x": hb["over"], "over_a_x": ha["over"],
                                                    "worst_st": ha["worst"]}})
    blocks.append({"key": "chat.plansCleared", "params": {}})
    return {"status": "applied", "blocks": blocks,
            "patch": {"version": version, "changes": [{"field": c["field"], "was": c["from"], "to": c["to"]} for c in changes],
                      "forecast": new["forecast"], "threshold": new["threshold"], "priority": new["priority"], "constraints": new["constraints"],
                      "recalculated": [{"what": "forecast", "run_id": run2["run_id"]}, {"what": "simulation", "run_id": sim2["run_id"]},
                                       {"what": "break_point", "run_id": bp["run_id"]}],
                      "cleared": ["plan", "mission"]},
            "undo": cur, "suggestions": ["best_plan", "why_changed", "undo"]}


def a_undo(t: Turn, a: dict) -> dict:
    back, cur = t.ctx.get("undo"), current_settings(t.req)
    if not back or back == cur:
        return {"blocks": [{"key": "chat.nothingToUndo", "params": {}}], "suggestions": ["help"]}
    run_b = t.deps.run_for(back["forecast"])
    fb, fa = _flat(cur, t.run), _flat(back, run_b)
    changes = [{"field": k, "from": fb[k], "to": fa[k], "status": "ok"} for k in fa if fb[k] != fa[k] and k != "event"]
    return _patch(t, cur, back, changes, "chat.undone")


def a_knowledge(t: Turn, a: dict, text: str = "") -> dict:
    r = knowledge.search(text or a.get("query", ""), t.audience)
    t.tools.append({"tool": "retrieve", "run_id": f"corpus:{r['corpus_hash']}"})
    if r["insufficient"]:
        return {"status": "insufficient_evidence", "blocks": [{"key": "kiosk.noAnswer" if t.audience == "kiosk" else "chat.noDocument", "params": {}}],
                "suggestions": ["help"]}
    for h in r["hits"]:
        t.evidence.append(knowledge.cite(h, t.locale))
    return {"blocks": [{"key": "chat.fromDocuments", "params": {"docs_n": len(r["hits"])}}], "passages": True,
            "suggestions": ["help"] if t.audience == "kiosk" else ["evidence", "confidence"]}


def a_help(t: Turn, a: dict) -> dict:
    return {"blocks": [{"key": "kiosk.help" if t.audience == "kiosk" else "chat.help", "params": {}}],
            "suggestions": ["which_station", "when_leave", "accessible"] if t.audience == "kiosk" else ["overcrowded", "best_plan", "compare", "confidence"]}


# ---------------------------------------------------------------- kiosk answers
def _rider(t: Turn, a: dict) -> tuple[str, int, dict]:
    st = a.get("station") or t.req.station or t.focus_station or knowledge.event_station((t.run.get("event") or {}).get("id")) or t.worst()["station_id"]
    if st not in t.corr:
        st = t.worst()["station_id"]
    pk = t.station_peak(st)
    hour = (a.get("hour") if a.get("hour") is not None else t.req.hour if t.req.hour is not None else t.focus_hour if t.focus_hour is not None
            else pk["hour"] if pk else t.event_hour())                # no hour given: the station's own busiest hour
    adv = travel_advice(t.detail(), st, int(hour), t.thr, t.applied, [])
    t.focus_station, t.focus_hour = st, int(hour)
    return st, int(hour), adv


def _access_note(t: Turn) -> list[dict]:
    if not (t.ctx.get("prefs") or {}).get("step_free"):
        return []
    hit = knowledge.by_id("access.limits")
    if hit:
        t.evidence.append(knowledge.cite(hit, t.locale))
    return [{"key": "kiosk.accessNote", "params": {}}]


def k_which(t: Turn, a: dict) -> dict:
    st, hour, adv = _rider(t, a)
    better = next((x for x in adv["alternatives"] if x["better"]), None)
    now = adv["now"]
    if better and adv["status"] in ("busy", "crowded"):
        blocks = [{"key": "kiosk.useAlt", "params": {"station_st": st, "alt_st": better["station"], "walk_n": better["walk_min"], "load_pct": _pct(now["load"]),
                                                    "alt_pct": _pct(better["load"]), "hour_t": f"{hour:02d}:00"}}]
    else:
        blocks = [{"key": f"kiosk.use.{adv['status']}", "params": {"station_st": st, "load_pct": _pct(now["load"]) or 0, "wait_x": now["wait_min"],
                                                                  "hour_t": f"{hour:02d}:00"}}]
    return {"blocks": blocks + _access_note(t), "suggestions": ["when_leave", "travel_options", "accessible"]}


def k_when(t: Turn, a: dict) -> dict:
    st, hour, adv = _rider(t, a)
    later = adv["leave_later"]
    if adv["status"] == "easy":
        blocks = [{"key": "kiosk.leaveNow", "params": {"station_st": st, "hour_t": f"{hour:02d}:00", "load_pct": _pct(adv["now"]["load"]) or 0}}]
    elif later:
        blocks = [{"key": "kiosk.leaveLater", "params": {"station_st": st, "hour_t": f"{hour:02d}:00", "later_t": f"{later['hour']:02d}:00",
                                                        "load_pct": _pct(adv["now"]["load"]) or 0}}]
    else:
        blocks = [{"key": "kiosk.leaveBusy", "params": {"station_st": st, "hour_t": f"{hour:02d}:00", "load_pct": _pct(adv["now"]["load"]) or 0}}]
    return {"blocks": blocks + _access_note(t), "suggestions": ["quieter_station", "accessible"]}


def k_options(t: Turn, a: dict) -> dict:
    st, hour, adv = _rider(t, a)
    alts = adv["alternatives"]
    if not alts:
        return {"blocks": [{"key": "kiosk.noOptions", "params": {"station_st": st}}], "suggestions": ["when_leave", "accessible"]}
    blocks = [{"key": "kiosk.options", "params": {"station_st": st, "hour_t": f"{hour:02d}:00"}}]
    blocks += [{"key": "kiosk.option", "params": {"alt_st": x["station"], "walk_n": x["walk_min"], "alt_pct": _pct(x["load"])}} for x in alts]
    blocks.append({"key": "kiosk.optionsNote", "params": {}})
    return {"blocks": blocks + _access_note(t), "suggestions": ["when_leave", "accessible"]}


def k_accessible(t: Turn, a: dict, text: str = "") -> dict:
    found = knowledge.search(text, "kiosk", 2)["hits"] if text else []
    hits = [h for h in found if "accessibility" in (h["passage"].get("tags") or [])] or [knowledge.by_id("rta_pod.metro")]
    hits += [h for h in [knowledge.by_id("access.limits")] if h and h["passage"]["id"] not in {x["passage"]["id"] for x in hits}]
    for hit in hits:
        if hit:
            t.evidence.append(knowledge.cite(hit, t.locale))
    t.tools.append({"tool": "retrieve", "run_id": f"corpus:{knowledge.index().corp['corpus_hash']}"})
    st, hour, adv = _rider(t, a)
    better = next((x for x in adv["alternatives"] if x["better"]), None)
    blocks = [{"key": "kiosk.access", "params": {}}]
    if adv["status"] in ("busy", "crowded") and better:
        blocks.append({"key": "kiosk.accessQuieter", "params": {"station_st": st, "alt_st": better["station"], "walk_n": better["walk_min"],
                                                               "hour_t": f"{hour:02d}:00"}})
    else:
        blocks.append({"key": "kiosk.accessHere", "params": {"station_st": st, "load_pct": _pct(adv["now"]["load"]) or 0, "hour_t": f"{hour:02d}:00"}})
    return {"blocks": blocks, "passages": True, "prefs": {"step_free": True}, "suggestions": ["when_leave", "which_station"]}


def k_reach(t: Turn, a: dict, text: str = "") -> dict:
    to = a.get("to") or a.get("station")
    frm = t.req.station or t.focus_station or knowledge.event_station((t.run.get("event") or {}).get("id")) or t.corr[0]
    if not to:
        named = re.search(r"\b(?:to|إلى|الى)\s+(?!my\b|the venue\b|there\b|a station\b|وجهتي)\S+", text)   # a place the twin does not know
        return {"status": "clarify", "blocks": [{"key": "kiosk.reachUnknown" if named else "kiosk.reachAsk", "params": {}}],
                "options": [{"label_key": "kiosk.opt.station", "params": {"to_st": s}, "intent": "reach", "args": {"to": s}} for s in t.corr if s != frm],
                "suggestions": []}
    r = knowledge.route(frm, to)
    t.tools.append({"tool": "graph", "run_id": "graph:config"})
    t.evidence.append({"kind": "config", "id": "config/corridor.yaml", "tool": "graph", "run_id": None, "title": "Metro lines and stations (RTA GTFS)"})
    if not r:
        return {"status": "insufficient_evidence", "blocks": [{"key": "kiosk.reachUnknown", "params": {}}], "suggestions": ["which_station"]}
    if r["stops"] == 0:
        return {"blocks": [{"key": "kiosk.reachHere", "params": {"to_st": to}}], "suggestions": ["when_leave"]}
    key = "kiosk.reach" if r["changes"] == 0 else "kiosk.reachChange"
    return {"blocks": [{"key": key, "params": {"from_st": frm, "to_st": to, "stops_n": r["stops"], "line_s": r["lines"][0], "changes_n": r["changes"]}},
                       {"key": "kiosk.reachNote", "params": {}}], "suggestions": ["when_leave", "accessible"]}


def k_busiest(t: Turn, a: dict) -> dict:
    w = t.worst()
    return {"blocks": [{"key": "kiosk.busiest", "params": {"station_st": w["station_id"], "hour_t": f"{w['hour']:02d}:00", "peak_pct": _pct(w["peak_lf"])}}],
            "suggestions": ["quieter_station", "when_leave"]}


HANDLERS: dict[str, Callable] = {
    "peak": a_peak, "overcrowded": a_overcrowded, "why_risk": a_why_risk, "station_status": a_station_status, "best_plan": a_best_plan,
    "compare": a_compare, "lens": a_lens, "whatif_attendance": a_whatif_attendance, "whatif_threshold": a_whatif_threshold,
    "break_point": a_legacy("break_point"), "if_hot": a_legacy("if_hot"), "if_rain": a_legacy("if_rain"), "road": a_legacy("road"),
    "confidence": a_confidence, "evidence": a_evidence, "why_changed": a_why_changed, "edit": a_edit, "undo": a_undo,
    "knowledge": a_knowledge, "help": a_help,
    "which_station": k_which, "quieter_station": k_which, "when_leave": k_when, "accessible": k_accessible, "travel_options": k_options,
    "reach": k_reach, "busiest": k_busiest,
}
TAKES_TEXT = {"whatif_attendance", "whatif_threshold", "edit", "knowledge", "reach", "accessible"}
EXEMPT_SCREEN = ("threshold (to|is|=)",)             # a planner may set the comfort line in words; the value is range-checked instead


def scenario_compare(a: dict, b: dict, applied: list[dict], scope: str, locale: str, deps: Deps) -> dict:
    """Two scenarios side by side (decision #152): what differs in their settings, what that does before any plan, and
    what the team recommends for each. Both sides are forecast, simulated and planned here; nothing is taken on trust
    from the caller except the settings themselves. Used by the run history ("compare with now")."""
    default = corridor()["capacity"]["overcap_threshold"]

    def side(s: dict) -> dict:
        run = deps.run_for(s["forecast"])
        thr = s["threshold"] if s["threshold"] is not None else default
        sim = deps.simulate(run["run_id"], applied, False, thr, scope)
        m = mission_for(deps, run, s, applied, scope, locale)
        o = _option(m, m.get("recommended_rank"))
        h = _headline(sim)
        return {"settings": _flat(s, run), "forecast_run_id": run["run_id"], "simulation_run_id": sim["run_id"], "mission_id": m["mission_id"],
                "headline": {"worst_station": h["worst"], "peak_lf": round(h["peak"], 4), "overcap_station_hours": h["over"], "stations_over": h["stations_over"]},
                "options": len(m["plan"]["options"]), "stop_reason": m.get("stop_reason"),
                "recommended": o and {"rank": o["rank"], "title": o["title"], "peak_lf": round(o["summary"]["peak_lf"], 4),
                                      "excess_pax": round(o["summary"]["excess_pax"], 1), "cost_added": o["cost_added"],
                                      "run_id": o["sources"][0]["run_id"], "signature": planner._sig(o["interventions"])},
                "is_synthetic": run["is_synthetic"]}
    x, y = side(a), side(b)
    changes = [{"field": k, "was": x["settings"][k], "to": y["settings"][k]} for k in y["settings"] if x["settings"].get(k) != y["settings"][k]]
    rx, ry = x["recommended"], y["recommended"]
    return {"a": x, "b": y, "changes": changes, "identical": not changes,
            "same_recommendation": (rx is None and ry is None) or bool(rx and ry and rx["signature"] == ry["signature"]),
            "delta": {"peak_lf": round(y["headline"]["peak_lf"] - x["headline"]["peak_lf"], 4),
                      "overcap_station_hours": round(y["headline"]["overcap_station_hours"] - x["headline"]["overcap_station_hours"], 3),
                      "stations_over": y["headline"]["stations_over"] - x["headline"]["stations_over"]},
            "is_synthetic": x["is_synthetic"] or y["is_synthetic"],
            "note": "Both scenarios were forecast, simulated and planned for this answer. Runs are deterministic: the same settings always give the same run ids."}


def clean_args(a: dict) -> dict:
    """A button's arguments, typed. Anything of the wrong type or outside the known names is dropped, never trusted."""
    out: dict = {}
    for k, cast in (("attendance", int), ("exit_sigma_min", int), ("hour", int), ("rank", int), ("threshold", float), ("metro_share", float)):
        v = a.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) < 1e9:
            out[k] = cast(v)
    for k, allowed in (("weather", ("normal", "hot", "rain")), ("priority", ("cost", "balanced", "impact")), ("lens", tuple(LENSES))):
        if a.get(k) in allowed:
            out[k] = a[k]
    for k in ("station", "to"):
        if isinstance(a.get(k), str) and 0 < len(a[k]) <= 40:
            out[k] = a[k]
    for k in ("confirmed", "from_whatif"):
        if a.get(k) is True:
            out[k] = True
    if isinstance(a.get("query"), str):
        out["query"] = a["query"][:300]
    w = a.get("weights")
    if isinstance(w, dict):
        ok = {k: float(v) for k, v in w.items() if k in objectives.OBJECTIVES and isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 100}
        if ok:
            out["weights"] = ok
    return out


def chat(req, run: dict, deps: Deps) -> dict:
    """One turn. `run` is the forecast run of the scenario on screen (with `_spec`, its request, attached)."""
    t = Turn(req, run, deps)
    allowed = KIOSK if req.audience == "kiosk" else PLANNER
    text = clean(req.message or "")
    findings = [f for f in screen(req.message or "") if not any(x in f["pattern"] for x in EXEMPT_SCREEN)] if req.message else []
    intent, args, how = None, clean_args(_dump(req.args) if req.args else {}), "chip"
    refused: str | None = None
    if req.intent:
        name = req.intent.split(":", 1)
        intent = name[0]
        if len(name) == 2 and intent == "lens":
            args.setdefault("lens", name[1])
    elif text:
        if re.search(_DENY, text):
            refused = "harm"
        else:
            intent, found, how = classify(text, req.audience, {**t.ctx, "last_args": clean_args(t.ctx.get("last_args") or {})})
            args = {**found, **args}
            if intent is None and deps.route_model is not None:
                m = deps.route_model(req.message[:300], allowed)
                if m in allowed:
                    intent, how = m, "model"
                elif m == "out_of_scope":
                    refused = "scope"
            if intent is None and refused is None:
                intent, how = "knowledge", "retrieval"               # last resort: the documents, or "not enough evidence"
    else:
        intent = "help"
    if intent is not None and intent not in allowed:
        refused, intent = ("staff" if req.audience == "kiosk" else "scope"), None
    if req.audience == "kiosk" and intent == "knowledge" and re.search(PLANNER_ONLY, text):
        refused, intent = "staff", None
    if findings and intent in ("edit", "undo"):
        refused, intent = "injection", None                         # nothing is applied from a message that reads like an instruction to the system

    if intent is None:
        res = {"status": "refused", "blocks": [{"key": {"harm": "chat.refuseHarm", "staff": "kiosk.staffOnly", "injection": "chat.refuseInjection"}.get(refused, "chat.refuse"),
                                               "params": {}}],
               "suggestions": ["which_station", "when_leave", "accessible"] if req.audience == "kiosk" else ["overcrowded", "best_plan", "confidence"]}
    else:
        h = HANDLERS[intent]
        res = h(t, args, text) if intent in TAKES_TEXT else h(t, args)
        if res.get("status") == "insufficient_evidence" and intent == "knowledge" and how == "retrieval" and req.audience == "planner":
            res = {"status": "refused", "blocks": [{"key": "chat.refuse", "params": {}}], "suggestions": ["overcrowded", "best_plan", "confidence"]}
            intent = None

    # ---- the context the client sends back next turn (the API keeps nothing)
    cur = current_settings(req)
    ctx = {"session_id": t.ctx.get("session_id") or uuid.uuid4().hex[:16], "turn": int(t.ctx.get("turn") or 0) + 1,
           "focus_station": t.focus_station, "focus_hour": t.focus_hour,
           "last_intent": intent or t.ctx.get("last_intent"), "last_args": res.get("last_args") or ({k: v for k, v in args.items() if k in ("lens", "station")} if intent else {}),
           "settings": t.ctx.get("settings") or cur, "previous": t.ctx.get("previous"), "undo": t.ctx.get("undo"),
           "prefs": {**(t.ctx.get("prefs") or {}), **(res.get("prefs") or {})}}
    if t.moved:
        ctx["previous"], ctx["settings"] = t.previous, cur
    if res.get("undo"):
        ctx["undo"] = res["undo"]
    kiosk = req.audience == "kiosk"
    return {"session_id": ctx["session_id"], "turn": ctx["turn"], "audience": req.audience, "intent": intent, "status": res.get("status", "answered"),
            "blocks": res["blocks"][:4] if kiosk else res["blocks"], "table": None if kiosk else res.get("table"),
            "evidence": [e for e in t.evidence if e["kind"] in ("document", "config")] if kiosk else t.evidence,
            "passages": bool(res.get("passages")), "confidence": None if kiosk else res.get("confidence"), "patch": None if kiosk else res.get("patch"),
            "options": res.get("options") or [], "suggestions": [s for s in res.get("suggestions", []) if s.split(":")[0] in allowed],
            "routed_by": how, "tools": [] if kiosk else t.tools, "findings": [{"field": "message", "pattern": f["pattern"]} for f in findings],
            "scenario_version": int(req.scenario_version), "context": ctx, "is_synthetic": run["is_synthetic"],
            "source": {"tool": "simulate", "run_id": t._base["run_id"] if t._base else (t._detail or {}).get("run_id")}}
