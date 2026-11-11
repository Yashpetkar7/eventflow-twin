# EventFlow Twin — Project Kit (START HERE)

**EventFlow Twin** is an agentic-AI digital twin that forecasts metro-station crowding and road pressure around large events on Dubai's Sheikh Zayed Road / Trade Centre corridor, and recommends interventions that a human planner approves.

Built as a candidate exhibit for the **RTA R&D & Innovation (RDI) Zone**:
- 18–21 Nov 2026 · Emirates Towers · Dubai Future Week
- 23–25 Nov 2026 · RTA Headquarters · UAE Innovates

> ⚠️ **Internal rule from the faculty email:** do NOT share the RTA nomination template with anyone and do NOT submit it to RTA yourself. Everything goes through Dr. Rachit Garg. Keep this repo **private**. Never commit the RTA template PDF.

---

## What is in this kit

| Folder / file | What it is | When you use it |
|---|---|---|
| `CLAUDE.md` | Project memory for Claude Code (rules, stack, commands) | Claude Code reads it automatically |
| `MASTER_BUILD_PROMPT.md` | The phased build prompt to paste into Claude Code | Day 2 onwards |
| `docs/00_TIMELINE.md` | Day-by-day plan with hard deadlines | Today |
| `docs/01_BRIEF_AND_CRITERIA.md` | What RTA asked for, how it will be judged, RTA strategy alignment (with sources) | Before writing anything |
| `docs/02_PRD.md` | Product requirements, scope (must / should / won't), demo flow | Build |
| `docs/03_ARCHITECTURE.md` | System diagram, components, API contract | Build |
| `docs/04_DATA_SOURCES.md` | Every dataset, URL, schema notes, download steps, licence notes | Day 1–2 |
| `docs/05_MODELING_SPEC.md` | Forecasting + capacity/intervention simulator maths | Build |
| `docs/06_AGENTS_SPEC.md` | LangGraph agents, tools, prompts, guardrails, human-in-the-loop | Build |
| `docs/07_UI_SPEC.md` | Screens, design tokens, 3D, Arabic/RTL, booth mode, offline mode | Build |
| `docs/08_EVAL_PLAN.md` | Metrics, gold sets, thresholds, CI gate | Build |
| `docs/09_DECISIONS.md` | Decision log (ADR) | Ongoing |
| `docs/10_RISKS_AND_INTEGRITY.md` | Risks, mitigations, honesty rules | Ongoing |
| `submission/` | Email to Dr. Rachit, full nomination content, image shot-list, checklist | Day 1–3 |
| `submission/EventFlow_Twin_RTA_Nomination_DRAFT.pdf` | **Filled RTA template** (KPI-focused summary, touch-screen demonstrator, 4 images). Private: git-ignored | Attach to the email today |
| `submission/images/` | 4 concept images (hero UI, AI options, simulator chart, architecture) | In the PDF; replace with real screenshots later |
| `submission/IMAGE_GEN_PROMPTS.md` | ChatGPT / text-to-image prompts for poster, booth and social visuals | Poster + social |
| `submission/tools/` | `fill_template.py` (regenerates the filled PDF) + HTML sources of the images | When you edit text/images |
| `exhibit/` | Booth plan, 90-second demo script, A1 poster copy, jury Q&A | Day 6–7 |
| `apps/`, `scripts/`, `eval/`, `config/` | Starter code scaffold (runs today on synthetic data) | Build |

## Quick start (15 minutes)

```bash
unzip eventflow-twin-kit.zip && cd eventflow-twin
git init && git add . && git commit -m "kit: initial"          # keep the repo PRIVATE
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-min.txt
make synth            # generates clearly-labelled SYNTHETIC demo data (works offline)
make baseline         # trains seasonal-naive + LightGBM baseline on synthetic data, writes eval/results
make api              # FastAPI on http://localhost:8000/docs
```

Then open Claude Code in this folder:

```bash
claude
```

and paste the **Phase 0** block from `MASTER_BUILD_PROMPT.md`. Run one phase at a time; each phase ends with acceptance checks.

## The order of operations

1. **Today:** send `submission/EMAIL_TO_DR_RACHIT.md` with the filled PDF attached (add your mobile + programme first).
2. **Day 1–2:** download real data (`docs/04_DATA_SOURCES.md`) into `data/raw/`. Run Phases 0–2.
3. **By Fri 13 Nov:** give Dr. Rachit the filled content from `submission/NOMINATION_CONTENT.md` + 3–5 images. He submits.
4. **14–17 Nov:** Phases 3–6 (agents, UI, eval, booth mode).
5. **17 Nov:** rehearse `exhibit/DEMO_SCRIPT_90S.md`; pack per `exhibit/BOOTH_PLAN.md`.

## Honesty rules (non-negotiable)

- Synthetic data is labelled **SYNTHETIC** in data files, UI badges and every document.
- Say "designed for" / "aligned with" RTA priorities. Never "used by", "approved by" or "in partnership with" RTA.
- Every number in the poster, nomination or README must come from a file in `eval/results/`.
