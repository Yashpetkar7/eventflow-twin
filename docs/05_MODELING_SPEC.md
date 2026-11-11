# 05 — Modelling spec

## 5.1 Target panel
`station_hour` table: station_id × local hour (Asia/Dubai) with `entries`, `exits`, `is_synthetic`, `source_file`.
Aggregation from transactions: entries counted at entry station by entry timestamp hour; exits at exit station by exit timestamp hour (if only one timestamp exists, document the assumption).

## 5.2 Hybrid forecast = background ML + event overlay
Historical data rarely has enough labelled events to learn event effects alone, so:

**Background demand** (learned): LightGBM per target (entries, exits), global model across stations.
Features: hour, day-of-week, UAE weekend regime (Fri–Sat before 1 Jan 2022, Sat–Sun after), public holiday flag, Ramadan flag, school-term flag (optional), station id (categorical), lags y(t-24h), y(t-168h), rolling 7-day same-hour mean. Quantile objectives at 0.1 / 0.5 / 0.9.

**Event overlay** (parametric, transparent, labelled "scenario model"):
```
extra_trips(event) = attendance × metro_share × (1 + return_factor)
arrivals(t)   = extra_trips_in  × N(t; start - 60 min, σ=45 min)
departures(t) = extra_trips_out × N(t; end + 20 min, σ=30 min)   # exit surge is sharper
station split: w_s ∝ exp(-walk_minutes(venue, s) / τ),  τ = 8 min
entries at station s get departures × w_s; exits at s get arrivals × w_s
```
Parameters (`metro_share`, `return_factor`, σ, τ) live in `config/corridor.yaml` as assumptions with a comment. **Calibrate** on any historical event day in your data: fit metro_share so overlay + background matches observed uplift; report the calibration error.

## 5.3 Validation
- Rolling-origin backtest: 4 folds, each forecasting the next 7 days hourly.
- Metrics: MASE vs seasonal-naive (t-168h), sMAPE, 80% interval coverage. Report overall, per station, and **event days separately**.
- Baselines in the results file: seasonal-naive, (optional) Prophet-free simple ETS. Do not over-tune; keep the last fold as test split.

## 5.4 Capacity & intervention simulator (deterministic)
Per station s, hour h:
```
trains_per_hour(s,h) = 60 / headway_min(line, h)        # from GTFS if available else corridor.yaml
cap(s,h) = trains_per_hour × train_capacity × boardable_share   # boardable_share (default 0.35) = share of a train's capacity realistically available at one station; assumption
demand(s,h) = entries(s,h) (platform-loading proxy); also report exits
LF(s,h) = demand / cap
overcap if LF > 0.85
excess_pax = Σ max(0, demand − 0.85·cap)
```
Interventions (each has param bounds in corridor.yaml and a cost proxy in "relative units"):
| type | params | effect |
|---|---|---|
| `extra_trains` | line, hours, headway_min (≥ min headway) | raises cap |
| `shuttle_bus` | from_station, to_station, buses, hours | moves min(demand_excess, buses × bus_cap × trips_per_hour) to a station with spare capacity |
| `robotaxi_staging` | station, vehicles, hours | diverts vehicles × avg_occupancy × trips_per_hour away from metro |
| `staggered_exit` | event_id, spread_minutes | widens departure σ, flattening the peak |
| `wayfinding_redirect` | from_station, to_station, share | moves share of demand to a walkable alternative station |

Outputs: per-hour rows + summary {overcap_station_hours, excess_pax, peak_lf, cost_proxy}. Invariants (tested): total demand conserved (except robotaxi diversion, which is accounted for separately); LF never negative; applying no interventions returns the baseline exactly.

## 5.5 Ranking (deterministic)
`score = Δexcess_pax − λ·cost_proxy` (λ in config). Ties broken by Δovercap_station_hours. The LLM never computes or edits these numbers.
