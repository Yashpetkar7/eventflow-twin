"""The agent team (docs/15_AGENT_ARCHITECTURE.md): who exists, in which layer, what each may do.

Eighteen agents in five layers plus two standing agents. Eight of them can call a language model; every number they
show comes from code (CLAUDE.md rule 2). `kind`: "code" never calls a model; "model" may call one and falls back to its
code policy (or a recorded answer) when none is available; "human" is the planner's own approval.
"""
from __future__ import annotations

from functools import lru_cache

import yaml

from ..config import ROOT

LAYERS = [
    {"id": 1, "key": "command", "name": "Command", "name_ar": "القيادة"},
    {"id": 2, "key": "understand", "name": "Understand", "name_ar": "الفهم"},
    {"id": 3, "key": "propose", "name": "Propose", "name_ar": "الاقتراح"},
    {"id": 4, "key": "test", "name": "Test & challenge", "name_ar": "الاختبار والمراجعة"},
    {"id": 5, "key": "govern", "name": "Explain & govern", "name_ar": "الشرح والحوكمة"},
    {"id": 6, "key": "standing", "name": "Standing", "name_ar": "دائم"},
]

# id, layer, kind, tools, role (en), role (ar draft for native review)
_AGENTS = [
    ("supervisor", 1, "code", ["budget", "route"], "Routes the work between layers, enforces the budget, decides to replan, stop or hand over to a human",
     "يوزّع العمل بين الطبقات ويطبّق الميزانية ويقرر إعادة التخطيط أو التوقف أو التسليم للإنسان"),
    ("intake", 2, "model", ["objective", "screen_injection"], "Turns the goal and the planner's constraints into an objective; logs instruction-like text as a finding",
     "يحوّل الهدف وقيود المخطِّط إلى هدف محدد ويسجّل أي نص يشبه التعليمات كملاحظة"),
    ("forecast", 2, "code", ["forecast"], "Hourly demand per station with its p10–p90 band",
     "الطلب كل ساعة لكل محطة مع نطاق p10–p90"),
    ("diagnosis", 2, "code", ["simulate", "diagnose", "breakpoint", "road_pressure"], "Baseline simulation, every station over the threshold, break points and road pressure",
     "محاكاة الوضع الحالي وكل محطة فوق الحد ونقاط الانكسار وضغط الطرق"),
    ("rail", 3, "model", ["extra_trains", "extended_hours"], "Rail service: more trains, longer hours",
     "خدمة القطارات: قطارات إضافية وساعات أطول"),
    ("station_crowd", 3, "model", ["station_metering", "wayfinding_redirect"], "Station & crowd: entry metering, guiding riders to a quieter station",
     "المحطة والحشود: تنظيم الدخول وتوجيه الركاب إلى محطة أهدأ"),
    ("venue", 3, "model", ["staggered_exit"], "Venue: spreading the exit over time",
     "مكان الفعالية: توزيع الخروج على مدى زمني"),
    ("last_mile", 3, "model", ["shuttle_bus", "robotaxi_staging"], "First and last mile: feeder shuttles and robotaxis",
     "الميل الأول والأخير: حافلات مغذية وسيارات أجرة ذاتية القيادة"),
    ("composer", 3, "code", ["combine", "intensify", "dedupe"], "Builds cross-domain bundles from the specialists' measures, removes duplicates, keeps the simulation budget",
     "يبني حزمًا مشتركة من مقترحات المتخصصين ويزيل التكرار ويلتزم بميزانية المحاكاة"),
    ("simulation", 4, "code", ["simulate"], "Runs every bundle through the deterministic simulator",
     "يشغّل كل حزمة في المحاكي الحتمي"),
    ("critic", 4, "code", ["check_goal"], "Applies criteria C1–C7, rejects plans with a named reason, asks for a replan",
     "يطبّق المعايير C1–C7 ويرفض الخطط بسبب محدد ويطلب إعادة التخطيط"),
    ("stress", 4, "code", ["forecast", "simulate"], "Re-tests the finalists under changed assumptions: more visitors, more metro riders, heat, rain, real totals",
     "يعيد اختبار الخطط النهائية بافتراضات مختلفة: زوار أكثر وركاب مترو أكثر وحر ومطر وأعداد حقيقية"),
    ("ranker", 4, "code", ["rank"], "Orders the plans by relief and cost, three different kinds",
     "يرتّب الخطط حسب التخفيف والتكلفة، ثلاثة أنواع مختلفة"),
    ("explainer", 5, "model", ["explain"], "Writes each option in plain English and Arabic, numbers copied from the simulator",
     "يكتب كل خيار بالإنجليزية والعربية بلغة بسيطة والأرقام منسوخة من المحاكي"),
    ("verifier", 5, "code", ["verify_numbers", "claim_policy"], "Checks every number against the simulator and blocks endorsement claims",
     "يتحقق من كل رقم مقابل المحاكي ويمنع ادعاءات الاعتماد"),
    ("messenger", 5, "model", ["draft_message"], "After approval: passenger notice, signage line and operations briefing, as drafts never sent",
     "بعد الموافقة: إشعار للركاب وسطر للافتات وموجز للتشغيل، كمسودات لا تُرسل"),
    ("watcher", 6, "code", ["forecast", "simulate", "alert"], "Duty view: scans the next hours on the scenario clock and raises alerts before a station crosses the threshold",
     "عرض المناوب: يراقب الساعات القادمة وينبّه قبل أن تتجاوز أي محطة الحد"),
    ("ask", 6, "model", ["route_question", "forecast", "simulate", "breakpoint"], "Answers questions only from tool results, with the run behind each figure; refuses anything out of scope",
     "يجيب عن الأسئلة من نتائج الأدوات فقط مع مصدر كل رقم، ويرفض ما هو خارج النطاق"),
]
HUMAN = {"id": "human", "layer": 5, "kind": "human", "tools": ["approve", "reject"], "can_call_model": False,
         "role": "The planner: approves or rejects each option; nothing is applied without this click",
         "role_ar": "المخطِّط: يوافق على كل خيار أو يرفضه، ولا يُطبَّق شيء دون هذه النقرة"}

AGENTS = [{"id": a, "layer": layer, "kind": kind, "tools": tools, "can_call_model": kind == "model", "role": en, "role_ar": ar}
          for a, layer, kind, tools, en, ar in _AGENTS]
AGENT_IDS = [a["id"] for a in AGENTS]
BY_ID = {a["id"]: a for a in AGENTS} | {"human": HUMAN}
SPECIALISTS = ["rail", "station_crowd", "venue", "last_mile"]
SPECIALIST_TYPES = {"rail": ["extra_trains", "extended_hours"], "station_crowd": ["station_metering", "wayfinding_redirect"],
                    "venue": ["staggered_exit"], "last_mile": ["shuttle_bus", "robotaxi_staging"]}


@lru_cache(maxsize=1)
def settings() -> dict:
    """config/agents.yaml (budget, critic limits, stress cases, intake patterns)."""
    return yaml.safe_load((ROOT / "config/agents.yaml").read_text(encoding="utf-8"))


def layer_of(agent: str) -> int:
    return BY_ID[agent]["layer"]


def counts() -> dict[str, int]:
    return {"agents": len(AGENTS), "model_capable": sum(a["can_call_model"] for a in AGENTS),
            "code_only": sum(not a["can_call_model"] for a in AGENTS)}
