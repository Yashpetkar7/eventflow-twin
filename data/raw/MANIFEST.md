# data/raw manifest (raw files are git-ignored; this file is committed)

| File | Source URL | Downloaded | Coverage | Size | Licence / terms | Used for |
|---|---|---|---|---|---|---|
| `gtfs_official_2021/mdb-904-202406071531.zip` | https://files.mobilitydatabase.org/mdb-904/mdb-904-202406071531/mdb-904-202406071531.zip (Mobility Database mirror of RTA's official GTFS, dataset `rta_gtfs-open`) | 2026-11-11 | Service 2021-09-09 … 2021-12-31 (Fri–Sat weekend era) | 11,009,074 B zipped (~119 MB unzipped); SHA-256 `81cb16433bc1865a29f8bd67a5cbb4bfedaf8ea380799358be587f5476e07546` | Dubai Pulse / RTA open data terms; credit "RTA open data" | Scheduled trains per hour per corridor platform → `config/capacity_gtfs.yaml`; station names, stop ids, coordinates |

Contents: agency, calendar (4 service patterns: Mon–Wed+Sun, Thu, Fri, Sat), routes (3 metro: MRed, MGrn, MBrch),
stops (2,584), trips, stop_times (111.8 MB), shapes, transfers, translations (Arabic names available here).

Not yet obtained: **metro ridership** (`rta_metro_ridership-open`, ~3,100 daily files). On 2026-11-11
dubaipulse.gov.ae 301-redirected to data.dubai (marked "under development") and the dataset was not visible there.

**Update 2026-11-12 (K3):** the dataset is now listed on the new portal as **"Dubai Metro Ridership"** —
<https://data.dubai/en/l/466403> — issuing entity RTA, tagged **Open**, last updated 9 Nov 2026, formats CSV / XLSX /
JSON, licence: Dubai Open Data Licence (PDF linked on the page). Content: transaction records (check-in/check-out,
date and time, start and end station, line, fare zone). The old Dubai Pulse URL still redirects to the portal home.
The download is a JavaScript button that does not show the file size, and the page also mentions a "data access
request via Dubai Data Exchange Hub" for download privileges — so the first download must be done by hand (Krishna),
filtered to **13 Oct – 31 Dec 2025** if the portal allows, saved under `data/raw/ridership/` with the exact file names
and download date recorded here. Related aggregates on the same portal (DDSE): "Number of Metro Ridership by
Station – Red Line", "Number of Metro Ridership by Lines".
Next once downloaded: `python tasks.py ingest` → calibrate the event model on GITEX 2025 (roadmap Phase 4).

## OpenStreetMap extract for the 3D twin (added 12 Nov 2026)
- `data/raw/osm/*.json` — Overpass API responses for the corridor box (buildings in 9 tiles, roads, rail/footbridges, water/parks),
  fetched by `python scripts/fetch_osm_corridor.py` (git-ignored; refetch any time, results differ slightly as OSM changes).
- Licence: © OpenStreetMap contributors, ODbL — credited in the UI (canvas corner + footer).
- Baked by `python scripts/build_scene.py` into `apps/web/public/geo/corridor_scene.json` + `ground.png` (committed, so the
  exhibit needs no network).
