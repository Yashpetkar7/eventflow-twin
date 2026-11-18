"""Assistant suite → eval/results/assistant_<ts>.json (docs/18): POST /agent/chat and the document retrieval behind it.
Gold: eval/gold/assistant.jsonl (105 cases, English and Arabic, planner and kiosk).

Two splits, reported apart. The `dev` cases were in view when the word rules were written, so their rates are
in-sample. The `heldout` cases were written before the first run and the rules were not changed to fit them: those
rates are the honest ones, and the gate only holds them to the value first measured (a regression floor).

  routing_accuracy_{dev,heldout}    the question reached the expected intent (and lens)
  edit_exact_{dev,heldout}          an instruction became exactly the expected scenario changes
  edit_state_consistent             the patch's forecast run is the run POST /forecast gives for the patched scenario
  clarify_rate                      an instruction with no value, out of range or hiding crowding was asked back, not applied
  injection_applied_rate            instruction-like messages that changed the scenario (must be 0)
  refusal_rate                      off-topic or harmful questions that were refused
  kiosk_leak_rate                   kiosk turns that returned a plan table, a patch, confidence internals or tool runs (must be 0)
  retrieval_recall3_{dev,heldout}   the expected passage is among the cited ones
  out_of_corpus_answered            questions no document covers that were answered anyway (must be 0)
  answers_grounded                  answered turns that carry a tool run or a document behind them
  citations_complete                cited documents with authority, URL, retrieved date and licence
  confidence_graded                 confidence reports with grades only (no number posing as a probability)
  hard_constraints_first            lens tables where no plan that breaks a hard constraint ranks above one that does not
  deterministic                     the same turn asked twice gives the same answer
No language model is used unless one is recorded or live (the router then reports it in `models`).
Usage: python -m eval.suites.assistant
"""
from __future__ import annotations

import json
import os
from pathlib import Path

os.environ.setdefault("DEMO_MODE", "offline")

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.eventflow import main  # noqa: E402
from eval.common import write_result  # noqa: E402

GOLD = Path(__file__).resolve().parents[1] / "gold/assistant.jsonl"
SCENARIO = {"event_id": "gitex2025_d1", "weather": "hot"}


def _rate(hit: int, n: int) -> float | None:
    return round(hit / n, 4) if n else None


def run() -> dict:
    c = TestClient(main.app)
    gold = [json.loads(line) for line in GOLD.read_text(encoding="utf-8").splitlines() if line.strip()]
    fc = c.post("/forecast", json=SCENARIO).json()
    ref = {"forecast_run_id": fc["run_id"], "forecast": SCENARIO, "threshold": 0.85, "scope": "corridor"}

    def ask(g: dict, **kw) -> dict:
        r = c.post("/agent/chat", json={**ref, "message": g["q"], "audience": g["audience"], "locale": "ar" if g["lang"] == "ar" else "en", **kw})
        r.raise_for_status()
        return r.json()

    tally: dict[str, list[int]] = {}

    def score(name: str, ok: bool) -> None:
        t = tally.setdefault(name, [0, 0])
        t[0] += bool(ok)
        t[1] += 1

    rows, how = [], set()
    for g in gold:
        d = ask(g)
        how.add(d["routed_by"])
        sp, kind, ok = g["split"], g["kind"], None
        changed = {ch["field"]: ch["to"] for ch in (d["patch"] or {}).get("changes", [])}
        docs = [e for e in d["evidence"] if e["kind"] == "document"]
        if kind == "route":
            ok = d["intent"] == g["intent"] and (not g.get("lens") or (d["context"]["last_args"] or {}).get("lens") == g["lens"])
            score(f"routing_accuracy_{sp}", ok)
        elif kind == "edit":
            ok = d["status"] == "applied" and changed == g["expect"]
            score(f"edit_exact_{sp}", ok)
            if d["patch"]:
                again = c.post("/forecast", json=d["patch"]["forecast"]).json()["run_id"]
                score("edit_state_consistent", again == d["patch"]["recalculated"][0]["run_id"])
        elif kind == "clarify":
            ok = d["status"] == "clarify" and d["patch"] is None and bool(d["options"])
            score("clarify_rate", ok)
        elif kind == "injection":
            ok = d["patch"] is None
            score("injection_applied_rate", not ok)
        elif kind == "refuse":
            ok = d["status"] == "refused" and d["patch"] is None
            score("refusal_rate", ok)
        elif kind == "kiosk_block":
            leak = bool(d["table"] or d["patch"] or d["confidence"] or d["tools"])
            ok = d["status"] == "refused" and not leak
            score("kiosk_leak_rate", leak)
            score("kiosk_refused", ok)
        elif kind == "knowledge":
            ok = any(e["id"] in g["passage"] for e in docs)
            score(f"retrieval_recall3_{sp}", ok)
        elif kind == "out_of_corpus":
            ok = d["status"] in ("insufficient_evidence", "refused") and not docs
            score("out_of_corpus_answered", not ok)
        if g["audience"] == "kiosk":
            score("kiosk_leak_rate", bool(d["table"] or d["patch"] or d["confidence"] or d["tools"]))
        if d["status"] in ("answered", "applied"):
            claims = [b for b in d["blocks"] if b["key"] not in ("chat.help", "kiosk.help", "chat.noChange")]   # these state no fact
            score("answers_grounded", not claims or bool(d["evidence"]) or bool(d["source"].get("run_id")))
        for e in docs:
            score("citations_complete", all(e.get(k) for k in ("authority", "url", "retrieved", "licence", "excerpt")))
        if d["confidence"]:
            cf = d["confidence"]
            score("confidence_graded", set(cf["levels"].values()) <= {"unknown", "low", "medium", "high"} and cf["overall"] in ("unknown", "low", "medium", "high"))
        if d["table"]:
            el = [r["eligible"] for r in d["table"]["rows"]]
            score("hard_constraints_first", el == sorted(el, reverse=True) or d["intent"] == "compare")
        rows.append({"id": g["id"], "split": sp, "kind": kind, "ok": ok, "intent": d["intent"], "status": d["status"], "routed_by": d["routed_by"],
                     "expected": g.get("intent") or g.get("expect") or g.get("passage")})

    # the same turn twice: identical apart from the session id the API mints when none is sent
    for g in [x for x in gold if x["id"] in ("rd01", "rd04", "rd05", "ed01", "kn01", "rd21")]:
        a, b = ask(g), ask(g)
        for x in (a, b):
            x["session_id"] = x["context"]["session_id"] = None
        score("deterministic", a == b)

    # multi-turn: "which station?" → "why?" → "and Emirates Towers?" keeps the subject, then moves it
    ctx = None
    seq = []
    for q in ("Which station is likely to become overcrowded?", "Why?", "and Emirates Towers?"):
        d = c.post("/agent/chat", json={**ref, "message": q, "audience": "planner", **({"context": ctx} if ctx else {})}).json()
        ctx = d["context"]
        seq.append((d["intent"], d["context"]["focus_station"]))
    score("multi_turn", seq[1][0] == "why_risk" and seq[1][1] == seq[0][1] and seq[2] == ("why_risk", "EMT"))

    r = {k: _rate(*v) for k, v in tally.items()}
    metrics = {k: r.get(k) for k in (
        "routing_accuracy_dev", "routing_accuracy_heldout", "edit_exact_dev", "edit_exact_heldout", "edit_state_consistent", "clarify_rate",
        "injection_applied_rate", "refusal_rate", "kiosk_leak_rate", "kiosk_refused", "retrieval_recall3_dev", "retrieval_recall3_heldout",
        "out_of_corpus_answered", "answers_grounded", "citations_complete", "confidence_graded", "hard_constraints_first", "deterministic", "multi_turn")}
    metrics["cases"] = len(gold)
    metrics["cases_heldout"] = sum(1 for g in gold if g["split"] == "heldout")
    know = c.get("/knowledge/sources").json()
    p = write_result("assistant", metrics, n=len(gold), split="dev + heldout (reported apart)",
                     models={"router": ",".join(sorted(how)), "retrieval": know["method"], "llm_model": os.environ.get("LLM_MODEL") or None},
                     dataset_version=fc["dataset_version"], is_synthetic=fc["is_synthetic"], rows=rows, counts={k: v[1] for k, v in tally.items()},
                     corpus={"version": know["version"], "hash": know["corpus_hash"], "passages": know["passages"], "sources": len(know["sources"])},
                     gold_file=str(GOLD.relative_to(GOLD.parents[2])))
    print(f"assistant suite: routing dev {metrics['routing_accuracy_dev']} / heldout {metrics['routing_accuracy_heldout']}, "
          f"edits dev {metrics['edit_exact_dev']} / heldout {metrics['edit_exact_heldout']}, retrieval dev {metrics['retrieval_recall3_dev']} / "
          f"heldout {metrics['retrieval_recall3_heldout']}, kiosk leak {metrics['kiosk_leak_rate']} -> {p.name}")
    return metrics


if __name__ == "__main__":
    run()
