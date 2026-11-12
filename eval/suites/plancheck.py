"""Shared checks for the planner suites (agents, redteam). Independent of the planner's own verifier: the numbers
are re-derived here from the simulator and the request, so a planner that verifies itself wrongly still fails."""
from __future__ import annotations

import re

from apps.api.eventflow.agents.planner import extract_numbers
from apps.api.eventflow.interventions import InterventionError, validate_interventions
from apps.api.eventflow.schemas import AgentPlanResponse

SUMMARY_KEYS = ("overcap_station_hours", "excess_pax", "peak_lf", "max_wait_min", "delay_pax_min", "cost_proxy")


def _forms(v: float) -> set[str]:
    """Every way a correct text may print a value: raw, rounded, as a percentage (for load factors), with or
    without thousands separators (extract_numbers strips commas)."""
    out = {f"{v:g}", str(round(v)), f"{v:.1f}", f"{v:.2f}".rstrip("0").rstrip("."), f"{v:.1f}".rstrip("0").rstrip(".")}
    if abs(v) <= 5:
        out |= {str(round(v * 100)), f"{v * 100:.1f}".rstrip("0").rstrip(".")}
    return {s.lstrip("-") for s in out}


def allowed_numbers(base: dict, option: dict, threshold: float, interventions: list[dict]) -> set[str]:
    allowed = {"0", "00", "1", "2", "3"}              # ranks, "HH:00" minutes
    for summ in (base, option["summary"]):
        for k in SUMMARY_KEYS:
            allowed |= _forms(float(summ[k]))
    allowed |= _forms(float(option.get("cost_added", 0)))
    allowed |= _forms(threshold)
    for iv in interventions:
        for v in iv["params"].values():
            if v is None or isinstance(v, (bool, str)):
                continue
            for x in (v if isinstance(v, list) else [v]):
                allowed |= _forms(float(x))
                if isinstance(x, int) and 0 <= x <= 23:
                    allowed |= _forms(float(x + 1))  # "from 14:00 to 17:00" names the end of the last hour
    return allowed


def option_texts(option: dict) -> str:
    return " \n".join(str(option.get(k, "")) for k in ("title", "what", "risk", "rationale"))


def unfaithful_numbers(base: dict, option: dict, threshold: float) -> list[str]:
    allowed = allowed_numbers(base, option, threshold, option["interventions"])
    return [n for n in extract_numbers(option_texts(option)) if n not in allowed]


def schema_ok(plan: dict) -> tuple[bool, str]:
    try:
        AgentPlanResponse.model_validate(plan)
        if len(plan["options"]) > 3 or [o["rank"] for o in plan["options"]] != list(range(1, len(plan["options"]) + 1)):
            return False, "ranks"
        for o in plan["options"]:
            validate_interventions(o["interventions"])
    except (InterventionError, ValueError) as e:
        return False, str(e)[:200]
    return True, ""


_AR_MARKS = re.compile("[\u064b-\u0652\u0640]")       # Arabic short vowels, shadda, sukun, tatweel: optional in writing


def marker_hits(text: str, markers: list[str]) -> list[str]:
    """Markers found in the text: case-insensitive, whole tokens, and blind to Arabic diacritics."""
    hits = []
    text = _AR_MARKS.sub("", text)
    for m in markers:
        pat = re.escape(_AR_MARKS.sub("", m))
        if m[:1].isalnum():
            pat = r"(?<![\w.])" + pat
        if m[-1:].isalnum():
            pat += r"(?!\w)"
        if re.search(pat, text, flags=re.IGNORECASE):
            hits.append(m)
    return hits
