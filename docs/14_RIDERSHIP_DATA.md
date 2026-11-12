# 14 — Real ridership: download, ingest, check, calibrate

Written 12 Nov 2026. Owners: **Yash downloads the transaction files, Atharva downloads the official monthly
statistics and runs the ingest and checks.** Krishna decides (§4) whether the real panel replaces the synthetic one
before the exhibit. Never commit raw data: `data/raw/` is git-ignored (on some laptops a global gitignore hides it too —
`git add -f data/raw/MANIFEST.md` for the manifest only).

## 1. What RTA published (checked 12 Nov 2026)
| | |
|---|---|
| Dataset | **Dubai Metro Ridership**, RTA, tagged Open — <https://data.dubai/en/l/466403> (last updated 9 Nov 2026) |
| Licence | Dubai Open Data Licence (PDF linked on the page) — attribute "RTA, data.dubai" |
| Files | **3,141** files `metro_ridership_<export-time>_<NNNN>.csv.gz`, each **~155 MB** gzip (~490 GB in all); the same chunks are offered as `.json.gz` (~280 MB) — **take the CSV** |
| Rows | one fare-gate tap: `end_location, end_zone, line_name, start_location, start_zone, txn_date, txn_time, txn_type ("Check in"/"Check out"), load_timestamp`; station names like `Burj Khalifa/ Dubai Mall Metro Station` |
| Dates | 2017 → July 2026. **Every file is a mixed sample across all dates**, not a block of days: the first 2 MB of files 0001, 1487, 2987 and 3141 each spanned 2017–2026. So you cannot download "October 2025" — each file holds a slice of every day |
| Related | DDSE statistics (official monthly/quarterly **check-ins per station**): "Number of Metro Ridership by Station – Red Line" (<https://data.dubai/en/e/statistic/35681/726542>), "… by Lines" (<https://data.dubai/en/e/statistic/35681/726514>) |

Consequence: a few files give the **shape** of every day (hourly profile per station) but only a fraction of its
taps. Scale to absolute numbers with the official monthly station totals (best) or by `3141 / files read`.

## 2. Download (Yash: transaction files · Atharva: monthly statistics)
**Yash — 10 files to start (~1.5 GB), more later if the check says the sample is too thin.**
1. Open <https://data.dubai/en/l/466403>, choose **CSV**, press **Download**. A list of files opens (30 per page,
   105 pages). Download links expire after 10 minutes — download right after opening the list.
2. Take **one CSV file from each of 10 different pages** (e.g. pages 1, 11, 21 … 91), not 10 from one page, so the
   sample is spread out. If the site asks you to accept terms or request access, do it with your own account and note
   the date.
3. Save them unchanged (still `.csv.gz`) into `data/raw/ridership/`. Add a line per file to `data/raw/MANIFEST.md`
   (name, size, download date) and commit only the manifest (`git add -f data/raw/MANIFEST.md`).
4. Share the files with Atharva by USB or a private drive link — **not** in git, WhatsApp or GitHub.

**Atharva — official monthly check-ins per station.**
1. Open "Number of Metro Ridership by Station – Red Line" (link above) and download **CSV**.
2. Save it as `data/raw/ddse/ridership_by_station_raw.csv`, then make `data/raw/ddse/station_month.csv` with exactly
   three columns: `station,month,checkins` (month as `YYYY-MM`; station names as in the file — the ingest maps them).
   Keep 2025 months at least; note in `MANIFEST.md` which months it covers (the page said "last updated 31 Aug 2025",
   so October 2025 may be missing — then the file-count scale is used for those months).

## 3. Ingest and check (Atharva)
```bash
git pull
python tasks.py ingest                                    # report only: reads data/raw/ridership/*.csv.gz
python scripts/ingest.py --ddse data/raw/ddse/station_month.csv   # same, scaled to official station totals
```
It prints, and saves in `eval/results/ridership_check_<time>.json`:
- rows read, rows in the window (default 1 Jul – 31 Dec 2025), share of station names it could map — **add every
  name in "unmatched" to `config/station_aliases.yaml`** (old names: Rashidiya, Al Jafiliya, Al Karama …) and re-run;
- `median_sample_taps_per_corridor_station_hour` and `panel_ready` (needs ≥ 20) — how thin the sample is;
- per corridor station: real weekday entries per day (scaled) vs our synthetic panel, the ratio, and the correlation
  of the hourly shapes;
- **GITEX 2025 at World Trade Centre and Emirates Towers**: entries per GITEX day (13–17 Oct) vs the same weekdays four
  weeks either side, the uplift ratio and its 95 % range. A range that includes 1.0 = no effect detectable at this
  sample size (then download more files before claiming anything).

Each file takes a minute or two to read (about 20 million rows). Post the printed summary in the team chat.

## 4. Decide (Krishna, with Atharva) — before Mon 16 noon, or after the exhibit
| If the check shows | Then |
|---|---|
| `panel_ready: true`, names mapped ≥ 98 %, ratios and shapes look sane | `python scripts/ingest.py --ddse … --write-panel`, then §5. The twin now runs on **real** ridership |
| Too thin, or not enough time to redo §5 before the freeze | Keep the synthetic panel for the exhibit. Quote only what the report measured, e.g. "real weekday entries at World Trade Centre ≈ N per day (RTA open data, sample of 10 files)", and say calibration is next |
| GITEX uplift measured with a tight range | Use it to set the event model's metro share / timing for `gitex2025_d1` in `config/events.yaml` (one decision entry in `docs/09_DECISIONS.md`) |

## 5. After `--write-panel` (every number on screen changes)
```bash
python tasks.py test && python tasks.py eval-fast && python -m eval.gate   # forecast, simulator, agents, red team
python tasks.py cache                                   # offline agent cache for the booth
cd apps/web && node scripts/snapshot.mjs && cd ../..    # API-down snapshot (apps/web/public/cache)
python scripts/ui_metrics.py                            # docs/metrics.md
```
Then update the numbers in `exhibit/POSTER_CONTENT.md` §4, `exhibit/DEMO_SCRIPT_90S.md`, `exhibit/JURY_QA.md` and the
nomination text (`submission/tools/fill_template.py`) from the new API answers, reprint
(`python scripts/build_exhibit_print.py`), retake screenshots (C6), and change the "synthetic" wording everywhere to
"RTA ridership (open data, sample of N files, scaled to official station totals)". The UI's SYNTHETIC badge switches off
by itself because the panel has `is_synthetic = false`. Redeploy the live site only after Krishna's OK.
