"""What did visitors choose today? One line for the stand, in English and Arabic, from the anonymous decision log.

    python tasks.py visitors                       # today (Dubai time), the laptop's data/processed/decisions_log.jsonl
    python scripts/visitor_summary.py --date 2026-11-18
    python scripts/visitor_summary.py --all --json

Counts only decisions made by people: the guided demo's automatic approvals ("guided-demo") and test runs are left
out. The log holds no personal data (anonymous label, plan, option, interventions), so the summary has none either.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DUBAI = ZoneInfo("Asia/Dubai")
AUTOMATIC = {"guided-demo", "soak", "test", "playwright", "smoke"}
KIND = {"extra_trains": ("extra trains", "قطارات إضافية"), "wayfinding_redirect": ("wayfinding to a nearby station", "التوجيه إلى محطة قريبة"),
        "shuttle_bus": ("feeder shuttles", "حافلات ترددية"), "robotaxi_staging": ("robotaxi staging", "تجهيز سيارات الأجرة ذاتية القيادة"),
        "staggered_exit": ("staggered exits", "خروج متدرّج"), "station_metering": ("station entry metering", "تنظيم الدخول إلى المحطة"),
        "extended_hours": ("extended service hours", "تمديد ساعات التشغيل")}


def log_path() -> Path:
    return Path(os.environ.get("EVENTFLOW_DATA_DIR") or ROOT / "data") / "processed/decisions_log.jsonl"


def load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue                                         # a torn line must not hide the rest
    return out


def summarise(records: list[dict], day: str | None) -> dict:
    people = [r for r in records if str(r.get("user", "")).lower() not in AUTOMATIC
              and (day is None or str(r.get("timestamp", ""))[:10] == day)]
    approved = [r for r in people if r.get("decision") == "approve"]
    kinds = collections.Counter(iv.get("type") for r in approved for iv in r.get("interventions") or [])
    titles = collections.Counter(r.get("option_title") or "?" for r in approved)
    hours = collections.Counter(str(r.get("timestamp", ""))[11:13] for r in people)
    return {"date": day or "all", "decisions": len(people), "approved": len(approved),
            "rejected": sum(r.get("decision") == "reject" for r in people),
            "top_action": kinds.most_common(1)[0][0] if kinds else None, "actions": dict(kinds.most_common()),
            "top_option": titles.most_common(1)[0][0] if titles else None,
            "busiest_hour": f"{hours.most_common(1)[0][0]}:00" if hours else None}


def sentence(s: dict) -> tuple[str, str]:
    if not s["decisions"]:
        return ("No visitor decisions yet today — be the first to approve a plan!",
                "لا توجد قرارات من الزوار بعد اليوم — كن أول من يعتمد خطة!")
    en_kind, ar_kind = KIND.get(s["top_action"], (s["top_action"] or "—", s["top_action"] or "—"))
    when_en, when_ar = ("Today", "اليوم") if s["date"] != "all" else ("So far", "حتى الآن")
    en = (f"{when_en} visitors made {s['decisions']} decisions: {s['approved']} plans approved, {s['rejected']} rejected. "
          f"Most chosen action: {en_kind}.")
    ar = (f"اتخذ الزوار {when_ar} {s['decisions']} قرارًا: اعتُمدت {s['approved']} خطة ورُفضت {s['rejected']}. "
          f"الإجراء الأكثر اختيارًا: {ar_kind}.")
    return en, ar


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Summarise visitors' approve/reject decisions.")
    ap.add_argument("--date", default=None, help="YYYY-MM-DD (default: today in Dubai)")
    ap.add_argument("--all", action="store_true", help="every day in the log")
    ap.add_argument("--log", type=Path, default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    day = None if a.all else (a.date or dt.datetime.now(DUBAI).date().isoformat())
    s = summarise(load(a.log or log_path()), day)
    en, ar = sentence(s)
    print(json.dumps(s | {"en": en, "ar": ar}, ensure_ascii=False, indent=1) if a.json else f"{en}\n{ar}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
