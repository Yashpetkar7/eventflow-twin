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

## Metro ridership — first download (12 Nov 2026, Atharva with Claude Code)
| File(s) | Source | Downloaded | Size | Licence |
|---|---|---|---|---|
| `ridership/metro_ridership_2026-07-21_18-21-58_{0001,0301,0617,0917,1217,1517,1817,2117,2417,2717}.csv.gz` — the first CSV on pages 1, 11, 21 … 91 of the file list | https://data.dubai/en/l/466403 (RTA, "Dubai Metro Ridership", tagged Open; no login asked) | 2026-11-12 | 10 files × ~8.07 MB gzip (80.7 MB); each unpacks to ~154.5 MB and ~1.05 million rows — the "147 MB" on the portal is the **unpacked** size | Dubai Open Data Licence; attribute "RTA, data.dubai" |
| `ddse/ridership_by_station_raw.json` → `ddse/station_month.csv` (`station,month,checkins`) | https://data.dubai/en/e/statistic/35681/726542 ("Number of Metro Ridership by Station – Red Line", DDSE); the page's download is this JSON | 2026-11-12 | 1.6 MB; 6,074 rows, 35 Red Line station names, monthly Apr 2010 – Aug 2026, **all of 2025 included** | Dubai Open Data Licence; attribute "DDSE, data.dubai" |

What the files really contain (10.48 million rows read): dates 2017-01-01 … 2026-07-11, every file a mix of all years.
**Time of day is missing for whole periods** (`txn_time` = `00:00:00.000`): all of Jan – Jul 2024, Mar 2025, and
**Jun 2025 – Mar 2026** (so GITEX 2025 has daily counts only). Fully timed: Sep 2024 – Jan 2025 and Apr – Jul 2026.
Some older rows have no station name. Check report: `eval/results/ridership_check_20261112-1947.json`.

## OpenStreetMap extract for the 3D twin (added 12 Nov 2026)
- `data/raw/osm/*.json` — Overpass API responses for the corridor box (buildings in 9 tiles, roads, rail/footbridges, water/parks),
  fetched by `python scripts/fetch_osm_corridor.py` (git-ignored; refetch any time, results differ slightly as OSM changes).
- Licence: © OpenStreetMap contributors, ODbL — credited in the UI (canvas corner + footer).
- Baked by `python scripts/build_scene.py` into `apps/web/public/geo/corridor_scene.json` + `ground.png` (committed, so the
  exhibit needs no network).

**Structure (checked 12 Nov 2026):** 3,141 files × ~155 MB `.csv.gz`; every file is a mixed sample of 2017–2026 (not a
block of days). Download plan and ingest: `docs/14_RIDERSHIP_DATA.md`. Files downloaded so far: 10 (table above); the "~155 MB" is the unpacked size, the download is ~8 MB per file.

## Realism ring for the 3D twin (added 12 Nov 2026, docs/13 R1)
`data/raw/realism/` (git-ignored, ~710 MB), fetched by `python scripts/fetch_realism_data.py` (needs `pip install -r requirements-realism.txt`, no account):

| Folder | Source | Licence | Fetched |
|---|---|---|---|
| `overture/` | Overture Maps release 2026-10-21.0, `s3://overturemaps-us-west-2` — buildings, building parts (ring bbox), water (40 km bbox) | ODbL 1.0 | 2026-11-12 |
| `s2/ring`, `s2/wide` | Sentinel-2 L2A B04/B03/B02 crops, 8 clearest dates 13 Oct – 30 Nov 2025 (`s2/ITEMS.json`), Microsoft Planetary Computer STAC | Copernicus Sentinel data (free and open) | 2026-11-12 |
| `worldcover/` | ESA WorldCover 10 m 2021 v200, tile N24E054 (crop) | CC BY 4.0 | 2026-11-12 |
| `dem/` | Copernicus DEM GLO-30, tiles N24/N25 E055 (crop) | Copernicus DEM free licence | 2026-11-12 |
| `globfp/` | 3D-GloBFP grid cell 1638 (Zenodo 15487006 → figshare), 67 MB zipped | CC BY 4.0 | 2026-11-12 |

Baked by `python scripts/build_scene.py --only v2` into `apps/web/public/geo/v2/` (committed, 10.5 MB).
