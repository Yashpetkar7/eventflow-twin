# 03 — Architecture

```mermaid
flowchart LR
  subgraph Data
    A1[Dubai Pulse metro ridership CSVs] --> I[Ingest\nPolars/DuckDB]
    A2[Metro stations + GIS] --> I
    A3[GTFS feed] --> I
    A4[Metro/Tram capacity] --> I
    A5[events.yaml\nresearched + synthetic] --> F
    A6[Synthetic generator\nlabelled] --> I
    I --> F[Feature store\nhourly station panel parquet]
  end
  subgraph Models
    F --> M1[Seasonal-naive baseline]
    F --> M2[LightGBM + event features]
    M2 --> S[Capacity & Intervention Simulator\ndeterministic]
  end
  subgraph Agents[LangGraph agents]
    P[Planner] --> T1[forecast tool]
    P --> T2[simulate tool]
    P --> T3[rank tool]
    P --> X[Explainer\ncites tool run ids]
    X --> H{Human approval}
  end
  S --> T2
  M2 --> T1
  H -->|approved| S
  API[FastAPI] --> Agents
  API --> S
  WEB[Next.js + deck.gl/MapLibre\nEN/AR] --> API
  Cache[(demo_cache\noffline replay)] --- API
  E[eval suites + gate] --> R[(eval/results)]
```

## Components
| Component | Tech | Responsibility |
|---|---|---|
| Ingest | Polars, DuckDB | Read daily ridership CSVs, normalise station names, aggregate to station × hour entries/exits |
| Features | Polars | Calendar (hour, dow, UAE weekend regime, holiday, Ramadan flag), lags (t-24h, t-168h), event features (distance-weighted, time-to-start/end, attendance bucket) |
| Forecaster | LightGBM (quantile 0.1/0.5/0.9) + seasonal-naive | Hourly entries and exits per station, with intervals |
| Simulator | Pure Python/NumPy | Capacity per hour from headway × train capacity; applies interventions; computes load factor, over-capacity station-hours, peak LF, cost proxy |
| Agents | LangGraph + Anthropic SDK | Plan → call tools → rank → explain; no free-form numbers |
| API | FastAPI | `/healthz`, `/stations`, `/events`, `/forecast`, `/simulate`, `/agent/plan`, `/decisions`, `/evidence` |
| Web | Next.js, deck.gl, MapLibre, Recharts, next-intl | Map, timeline, inspector, scoreboard, evidence, EN/AR |
| Eval | pytest + eval suites | Forecast backtest, simulator invariants, agent faithfulness, red-team, latency |

## API contract (v1)
- `GET /stations` → `[{id, name_en, name_ar, line, lat, lon, capacity_per_train, in_corridor}]`
- `GET /events` → `[{id, name, venue, lat, lon, start, end, attendance, is_synthetic, source_url}]`
- `POST /forecast {event_id|null, date, hours:[0..23], stations:[...]}` → `{run_id, rows:[{station_id, hour, entries_p10,p50,p90, exits_p10,p50,p90}], model, is_synthetic}`
- `POST /simulate {forecast_run_id, interventions:[{type, params}]}` → `{run_id, rows:[{station_id, hour, demand, capacity, load_factor}], summary:{overcap_station_hours, peak_lf, cost_proxy}}`
- `POST /agent/plan {forecast_run_id, goal}` → `{plan_id, options:[{rank, title, interventions, summary_delta, rationale, sources:[run_id...]}]}`
- `POST /decisions {plan_id, option_rank, decision: approve|reject, user}` → logged
- `GET /evidence` → latest eval metrics + data provenance

## Offline mode
`DEMO_MODE=offline`: `/agent/plan` returns cached JSON keyed by (scenario_id, goal hash) from `data/demo_cache/`. Map tiles: use a bundled style with local vector/GeoJSON (no remote tiles), or a pre-rendered basemap PNG under the deck.gl layers.
