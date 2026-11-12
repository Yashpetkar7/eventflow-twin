"""scripts/ingest.py on a tiny file in the data.dubai format (no download needed)."""
import gzip
import importlib.util
import json
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ingest", ROOT / "scripts/ingest.py")
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)

HEADER = '"end_location","end_zone","line_name","start_location","start_zone","txn_date","txn_time","txn_type","load_timestamp"'


def row(station, date, time, typ):
    return f'"{station}","Zone 6","Red Metro Line","{station}","Zone 6","{date}","{time}","{typ}","2025-10-30T00:00:00.000Z"'


def write_chunk(path: Path, rows: list[str]) -> Path:
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write("\n".join([HEADER, *rows]) + "\n")
    return path


@pytest.fixture
def chunk(tmp_path):
    rows = []
    # World Trade Centre: 4 check-ins at 15:xx on each GITEX day, 2 on the same weekdays a week before
    for d in ingest.GITEX_DAYS:
        rows += [row("World Trade Centre Metro Station", d, "15:10:00.000", "Check in")] * 4
    for d in ["2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-10-10"]:
        rows += [row("World Trade Centre Metro Station", d, "15:20:00.000", "Check in")] * 2
        rows += [row("Burj Khalifa/ Dubai Mall Metro Station", d, "18:05:00.000", "Check out")] * 3
    rows += [row("Al Jafiliya Metro Station", "2025-10-06", "08:00:00.000", "Check in")]          # old name → MAX
    rows += [row("Mystery Metro Station", "2025-10-06", "09:00:00.000", "Check in")] * 2        # unmatched
    rows += [row("World Trade Centre Metro Station", "2019-01-01", "09:00:00.000", "Check in")]  # outside the window
    return write_chunk(tmp_path / "metro_ridership_x_0001.csv.gz", rows)


def test_station_names_map_including_old_names():
    to_id = ingest.station_mapper()
    assert to_id("Burj Khalifa/ Dubai Mall Metro Station") == "BKD"
    assert to_id("World Trade Centre Metro Station") == "WTC"
    assert to_id("Al Jafiliya Metro Station") == "MAX"
    assert to_id("Mystery Metro Station") is None


def test_counts_are_entries_at_start_and_exits_at_end(chunk):
    counts, st = ingest.read_counts([chunk], "2025-07-01", "2025-12-31")
    wtc = counts[(counts.station_id == "WTC") & (counts.date == "2025-10-13")]
    assert wtc.entries.sum() == 4 and wtc.hour.tolist() == [15]
    bkd = counts[counts.station_id == "BKD"]
    assert bkd.exits.sum() == 15 and bkd.entries.sum() == 0
    assert counts[counts.station_id == "MAX"].entries.sum() == 1
    assert st["rows_in_window"] == st["rows_read"] - 1                  # the 2019 row is dropped
    assert dict(st["unmatched_top"])["Mystery Metro Station"] == 2


def test_report_measures_the_gitex_uplift(chunk):
    counts, st = ingest.read_counts([chunk], "2025-07-01", "2025-12-31")
    rep = ingest.report(counts, st, scale=100.0, scale_note="test", start="2025-07-01", end="2025-12-31")
    g = rep["metrics"]["gitex_2025_wtc"]
    assert g["event_days_found"] == 5 and g["comparison_days_found"] == 5
    assert g["uplift_ratio"] == 2.0 and g["scaled_entries_per_event_day"] == 400
    assert g["uplift_ratio_ci95"][0] < 2.0 < g["uplift_ratio_ci95"][1]
    assert rep["suite"] == "ridership_check" and rep["is_synthetic"] is False
    assert rep["metrics"]["panel_ready"] is False                       # a handful of rows is far too sparse


def test_panel_has_the_forecast_schema_and_flags_gitex(chunk):
    counts, _ = ingest.read_counts([chunk], "2025-07-01", "2025-12-31")
    p = ingest.to_panel(counts, scale=10.0, factors=None, source="test")
    assert list(p.columns) == ["ts", "station_id", "entries", "exits", "event_flag", "is_synthetic", "source_file"]
    assert not p.is_synthetic.any()
    one = p[(p.station_id == "WTC") & (p.ts == pd.Timestamp("2025-10-13 15:00"))]
    assert one.entries.item() == 40 and one.event_flag.item() == 1
    assert p.groupby(p.ts.dt.date).size().nunique() == 1               # every day has every hour × station


def test_main_refuses_a_sparse_panel(chunk, tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "INTERIM", tmp_path / "counts.parquet")
    monkeypatch.setattr(ingest, "RESULTS", tmp_path / "results")
    monkeypatch.setattr(ingest, "PANEL", tmp_path / "station_hour.parquet")
    assert ingest.main(["--raw", str(chunk.parent), "--write-panel"]) == 2
    assert not (tmp_path / "station_hour.parquet").exists()
    rep = json.loads(next((tmp_path / "results").glob("ridership_check_*.json")).read_text())
    assert rep["metrics"]["files_read"] == 1 and rep["metrics"]["scale_factor"] == 3141.0
    assert ingest.main(["--raw", str(chunk.parent), "--write-panel", "--force"]) == 0
    assert (tmp_path / "station_hour.parquet").exists()


def test_ddse_monthly_totals_set_the_scale(chunk, tmp_path):
    counts, _ = ingest.read_counts([chunk], "2025-07-01", "2025-12-31")
    off = tmp_path / "ddse.csv"
    off.write_text("station,month,checkins\nWorld Trade Centre,2025-10,3000\n", encoding="utf-8")
    f = ingest.ddse_scale(counts, off)
    assert f.loc[f.station_id == "WTC", "factor"].item() == pytest.approx(3000 / 30)   # 20 GITEX + 10 comparison check-ins


def test_real_data_surprises(tmp_path):
    """What the first real run (12 Nov 2026) showed: every station of the network appears, some months carry no time
    of day, some old rows have no station, and the official totals give a different scale than the file count."""
    rows = [row("World Trade Centre Metro Station", "2025-10-06", "00:00:00.000", "Check in")] * 5      # untimed
    rows += [row("BurJuman Metro Station", "2025-10-06", "08:10:00.000", "Check in")] * 2               # not a corridor station
    rows += [row("Equiti Metro Station", "2025-10-06", "08:10:00.000", "Check in"),                     # renamed Umm Al Sheif
             row("etisalat by e& Metro Station", "2025-10-06", "08:10:00.000", "Check out")]
    rows += ['"","Zone 6","Red Metro Line","","Zone 6","2025-10-06","09:00:00.000","Check out","2025-10-30T00:00:00.000Z"']   # no station
    f = write_chunk(tmp_path / "metro_ridership_x_0002.csv.gz", rows)
    counts, st = ingest.read_counts([f], "2025-10-01", "2025-10-31")
    assert st["rows_untimed"] == 5 and st["rows_in_window"] == 10 and st["rows_mapped"] == 9
    assert set(counts.station_id) == {"WTC", "BURJUMAN", "UMM_AL_SHEIF", "ETISALAT"}
    wtc = counts[counts.station_id == "WTC"]
    assert wtc.hour.tolist() == [-1] and wtc.entries.sum() == 5            # in the day's total, in no hour
    factors = pd.DataFrame({"station_id": ["WTC"], "month": ["2025-10"], "factor": [400.0]})
    m = ingest.report(counts, st, 100.0, "test", "2025-10-01", "2025-10-31", factors)["metrics"]
    assert m["untimed_share_in_window"] == 0.5 and m["panel_ready"] is False and "no time of day" in m["panel_blocker"]
    assert m["corridor_stations"]["WTC"]["weekday_entries_per_day_scaled"] == 2000        # 5 × the official factor, not × 100
    assert m["corridor_stations"]["WTC"]["hourly_shape_correlation"] is None
    assert set(m["corridor_stations"]) == {"MAX", "WTC", "EMT", "FIC", "BKD", "BBY"}

