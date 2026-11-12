# 04 — Data sources (checked 11 Nov 2026 — re-verify links before quoting publicly)

> Download these **on your laptop** into `data/raw/` (Claude's sandbox cannot reach these sites). Some Dubai Pulse resources show a "Request Permission" / terms dialog — accept the terms with your own account. Read and respect each dataset's terms of use. RTA's open-data page states RTA is not liable for use of the data.

## Core (needed for MUST scope)
| # | Dataset | Where | Use | Notes |
|---|---|---|---|---|
| D1 | **Metro ridership** — now on data.dubai (<https://data.dubai/en/l/466403>), 3,141 mixed-sample files; see `docs/14_RIDERSHIP_DATA.md` (supersedes this row) | https://www.dubaipulse.gov.ae/data/rta-rail/rta_metro_ridership-open | Hourly entries/exits per station | Thousands of daily CSV resources. Columns seen include entry station (`start_location`), exit station (`end_location`), `line_name`, zones; confirm timestamp columns by inspecting a file. Download a **contiguous window of 8–12 weeks** that includes at least one big event (e.g., New Year's Eve, a GITEX week). Note coverage dates in `data/raw/MANIFEST.md`. |
| D2 | **Metro stations** | https://www.dubaipulse.gov.ae/data/rta-rail/rta_metro_stations-open | Station list, line, lat/lon, opening/closing dates | Use station names from here as the canonical key; build an alias table for spelling variants and renamed stations. |
| D3 | **Metro & tram capacity (annual)** | https://www.dubaipulse.gov.ae/data/rta-rail/rta_dubai_metro_and_tram_capacity-open | Passengers per trip / carts per train | Gives capacity per train; headway is a configurable assumption in `config/corridor.yaml`. |
| D4 | **GTFS (metro, tram, bus, ferry)** | Official: https://www.dubaipulse.gov.ae (dataset `rta_gtfs-open`); mirror catalogue: https://mobilitydatabase.org/feeds/gtfs/mdb-904 ; community republish: https://mobilitydatabase.org/feeds/mdb-3359 | Scheduled trips per hour per station → capacity baseline; bus routes for shuttle options | Official GTFS on the mirror covers late 2021; the community feed is newer but unofficial — record which you used in DECISIONS.md. |

## Helpful (SHOULD)
| # | Dataset | Where | Use |
|---|---|---|---|
| D5 | RTA GIS layers (metro lines, stations, bus stops, bus routes, cycle tracks) | https://www.dubaipulse.gov.ae/organisation/rta/service/rta-location | Map geometry |
| D6 | Public transport stations register (opening hours) | https://www.dubaipulse.gov.ae/data/rta-registers/rta_public_transportation_stations-open | Operating-hour constraints |
| D7 | Tram ridership / stations | https://www.dubaipulse.gov.ae/organisation/rta/service/rta-tram | Optional second mode |
| D8 | OpenStreetMap roads (Sheikh Zayed Rd corridor) | via `osmnx` (Overpass) — ODbL licence, attribute "© OpenStreetMap contributors" | Road segments for the road-pressure proxy layer |
| D9 | Traffic accidents (federal) | https://data.bayanat.ae (search "traffic accidents") | Optional context only |

## Platform note
Dubai Pulse is being succeeded by the Dubai Data & AI Platform / **Data.Dubai** (https://connect.smartdubai.ae/). If a Dubai Pulse link fails, search the same dataset name there.

## Event calendar (`config/events.yaml`)
- **Historical events for backtesting:** only add events whose dates you verify from an official or news source; store `source_url`. Good candidates inside your ridership window: New Year's Eve (Burj Khalifa), GITEX week (Dubai World Trade Centre), Dubai Shopping Festival opening, major concerts at Coca-Cola Arena.
- **Demo events (future):** Dubai Future Week 2026 (18–21 Nov, Emirates Towers & Museum of the Future — https://www.dubaifutureweek.com/en). Attendance figures you use for scenarios are **assumptions** — label `is_assumption: true`.

## Synthetic data (`make synth`)
Generates a realistic hourly panel for corridor stations with weekday/weekend shape, AM/PM peaks, and event surges. Every row has `is_synthetic=true`. It exists so the demo works before real data is ready and as a fallback. Never present synthetic results as real.

## Privacy
Ridership is aggregated to station × hour; no card IDs or personal data are stored. This keeps the project outside PDPL personal-data scope (Federal Decree-Law No. 45 of 2021) — still, do not join with any personal data.

## Manifest
Create `data/raw/MANIFEST.md`: file name, source URL, download date, date coverage, row count, licence/terms note.
