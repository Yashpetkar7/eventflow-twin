# 01 — Brief and judging criteria

## What RTA asked for (from the email + template)
- RTA is setting up an **R&D & Innovation (RDI) Zone** at Dubai Future Week and UAE Innovates for the R&D ecosystem to showcase tangible, future-focused transport and mobility work.
- Formats: prototypes, models, demonstrators, simulations, research outcomes, posters, other tangible formats.
- Preference: **strong innovation, future relevance, potential impact, applicability to transport & mobility.**
- One template per nominated project. Sections: (1) Nomination profile, (2) Solution & supporting visuals (3–5 images), (3) Exhibition & logistics, plus a submission checklist.
- Submit "within this week" as a reply to RTA's email — **done by the university (Dr. Rachit), not by students.**

## How it will likely be judged (proxy rubric)
RTA's Dubai Award for Sustainable Transport scores applications as:
| Criterion | Weight | How EventFlow Twin answers it |
|---|---|---|
| Planning, implementation & feasibility | 30% | Working prototype, clear architecture, open data, deployable stack, honest readiness level |
| Standards alignment | 20% | Aligned to RTA AI Strategy KPIs; GTFS standard; human-in-the-loop; PDPL-aware (no personal data) |
| Community inclusivity | 20% | Arabic/English UI; crowding info helps People of Determination and families avoid peaks; accessible table views |
| Results & impact | 30% | Backtested forecast accuracy vs baseline; simulated reduction in over-capacity station-hours |
Source: https://www.rta.ae/wps/portal/rta/ae/home/dast/awards (checked 11 Nov 2026).

## RTA strategy hooks (use ONE prominently, others as support)
- **Updated RTA AI Strategy (launched 1 Nov 2026):** 41 areas; targets include 3–5% less traffic congestion; aim to move 50% of operations and services to an Agentic AI ecosystem in ~2.5 years; AED 300m+ annual value. Includes an Agentic AI Bus Network Planner (~20 agents) that analyses KPIs, finds service gaps, simulates alternatives, recommends options.
  Source: https://mediaoffice.ae/en/news/2026/novemebr/01-11/al-tayer-launches-rta-updated-ai-strategy
- **Event traffic analysis is already an RTA practice:** RTA's Transport Data Analysis Laboratory analysed GITEX 2025 traffic to reduce congestion and guide future event planning.
  Source: https://www.dubaieye1038.com/news/local/dubai-launches-transport-data-lab-to-improve-traffic-management
- **Autonomous mobility:** Dubai target of 25% of trips smart/driverless by 2030; Robotaxi fleet 144 vehicles (Aug 2026) with Baidu Apollo Go, WeRide, Pony.ai; Dubai Mobility Labs opened Sept 2026.
  Sources: https://www.wam.ae/en/article/c1t9txb-dubai-robotaxi-surpasses-million-kilometres · https://www.wam.ae/en/article/c2ghq6j-rta-diez-launch-dubai-mobility-labs-for-autonomous
- **Student AI challenges RTA ran recently:** traffic signal performance, congestion prediction, traffic flow analysis, smart intersections, proactive decision support (RTA × Canadian University Dubai × Mistral AI).
  Source: https://www.emirates247.com/technology/dubai-rta-hosts-ai-challenge-to-develop-smart-mobility-solutions/6954
- **Dubai Future Week 2026:** 18–21 Nov, Emirates Towers & Museum of the Future, tagline "For the human of the future".
  Source: https://www.dubaifutureweek.com/en

**Primary hook for EventFlow Twin:** the congestion KPI + agentic-AI shift ("from AI that supports operations to systems that predict outcomes and support decisions").

## The three KPIs to repeat everywhere (summary, poster, pitch)
1. **Congestion reduction** — RTA targets a 3–5% congestion cut; EventFlow Twin measures overcapacity station-hours removed by each plan (never claim it achieves RTA's target).
2. **Agentic AI** — RTA aims to move 50% of operations and services to an agentic-AI ecosystem; our agents plan end to end, the simulator produces every number.
3. **Human approval** — nothing applied without a planner's approval; every decision logged ("human leads, AI enables").

**Exhibit label:** *interactive digital twin demonstrator* on a touch screen visitors operate themselves.

## Positioning sentence (use everywhere)
> EventFlow Twin is a research prototype, designed for RTA's agentic-AI and congestion-reduction priorities, that forecasts event-driven crowding on Dubai's busiest corridor and lets a human planner test and approve interventions before the crowd arrives.

## Differentiation (why it is not a copy of RTA's own tools)
1. **Event-specific:** models the demand shock of events (start/end surges), not average network performance.
2. **Multimodal intervention menu:** metro headway, feeder shuttles, robotaxi staging, staggered event exits, in one comparable scoreboard.
3. **Explainable + auditable:** every number traced to a deterministic tool; every approval logged.
4. **Open-data, reproducible:** built entirely on public data + labelled synthetic scenarios.
