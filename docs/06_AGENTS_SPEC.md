# 06 — Agents spec (as built)

Updated 16 Nov 2026 to match the code. Full description, logic and measured accuracy: `docs/15_AGENT_ARCHITECTURE.md`.

## Graph (LangGraph `StateGraph`, `apps/api/eventflow/agents/engine.py`)
```
intake → forecast → diagnosis → [rail ∥ station_crowd ∥ venue ∥ last_mile] → composer → simulation → critic → supervisor
   supervisor ─(goal not met, budget left, < 3 rounds)→ composer (replan) → simulation → critic → supervisor
   supervisor ─(otherwise)→ ranker → [explainer ∥ stress] → verifier → conclude → [human approval in the UI]
   diagnosis ─(no station over the threshold)→ conclude
```
- **Nodes** are plain functions (`agents/nodes.py`) that call the planner's steps (`agents/planner.py::PlanRun`) and
  the tools; the same functions run in sequence without LangGraph (`seq`), and the original planner stays (`classic`).
  All three are gated to give identical plans (`eval/suites/orchestration.py`).
- **Parallel agents** return proposals and events; the next agent merges them in roster order (deterministic).
- **Budget** (`config/agents.yaml`): 60 steps, 80 simulations, 12 model calls, 45 s.

## Agents
Roster, layers and tools: `agents/roster.py` (served by `GET /agent/roster`). Eight agents may call a model: intake,
rail, station & crowd, venue, first & last mile, explainer, messenger, ask.

## Model personas (`agents/personas.py`)
| Agent | Prompt | Output schema | Checked by code |
|---|---|---|---|
| Intake | restate the objective; *suggest* constraints; flag instruction-like text | summary, suggest_forbid (menu enum), suggest_protect, suggest_cost_cap, instruction_like | suggestions shown "not applied"; constraints only from typed fields |
| Specialists (4) | propose ≤ 2 bundles of ≤ 2 measures, own measures only, inside the bounds | bundles of flat interventions, `type` limited to the specialist's measures | `validate_interventions`; anything else dropped before simulation |
| Explainer | title, what, risk, rationale; only the given figures | options[rank, title, what, risk, rationale] | every number must be a simulator figure or input (`verify_numbers`), no endorsement claim, else the template |
| Messenger | reword the passenger notice, EN + AR, no new numbers | notice_en, notice_ar | same number and claim checks, else the template |
| Ask | pick one tool or out_of_scope | tool (enum) | unknown tool → code router; harmful questions refused before routing |

Untrusted text (goal, notes, question) is always wrapped as `<untrusted_…>` data. Live, record and replay modes:
`DEMO_MODE=live` + `LLM_MODEL` (+ `LLM_MODEL_FAST`), `RECORD_AGENTS=1` → `data/demo_cache/llm/`, replay by default.

## Guardrails
- Numbers only from tools; every figure carries its run id; verifier gate (number faithfulness 1.0 in the eval gate).
- Constraints only from typed controls; injection attempts logged as findings (red-team suite: 0 / 53 on both endpoints).
- Out-of-scope and harmful questions refused (safety suite).
- No personal data accepted or produced. Nothing is applied without an Approve click; decisions logged with time,
  option, measures and an anonymous label. Messenger drafts are never sent.

## Offline cache
`python tasks.py cache` rebuilds `data/demo_cache/plan_*.json` (classic plans); `python tasks.py record-missions`
records the agents' model answers for the demo scenarios (needs the key in `.env`).
