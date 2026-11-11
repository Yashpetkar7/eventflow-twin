"""Rolling-origin backtest: seasonal-naive (t-168h) vs LightGBM quantile model.
Writes eval/results/forecast_<ts>.json (output contract in docs/08)."""
from __future__ import annotations
import argparse, datetime as dt, json, subprocess, sys
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]

def load_panel(mode: str) -> pd.DataFrame:
    if mode == "real":
        p = ROOT / "data/processed/station_hour.parquet"
    else:
        p = ROOT / "data/synthetic/station_hour_synthetic.parquet"
    df = pd.read_parquet(p).sort_values(["station_id", "ts"]).reset_index(drop=True)
    if "is_synthetic" not in df:
        df["is_synthetic"] = False
    return df

def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["hour"] = df.ts.dt.hour
    df["dow"] = df.ts.dt.dayofweek
    # UAE weekend regime: Fri–Sat before 2022-01-01, Sat–Sun after
    post = df.ts >= pd.Timestamp("2022-01-01")
    df["weekend"] = np.where(post, df.dow >= 5, df.dow.isin([4, 5])).astype(int)
    g = df.groupby("station_id")["entries"]
    df["lag24"] = g.shift(24)
    df["lag168"] = g.shift(168)
    df["roll7_samehour"] = df.groupby(["station_id", "hour"])["entries"].transform(lambda s: s.shift(1).rolling(7, min_periods=3).mean())
    df["station_code"] = df.station_id.astype("category").cat.codes
    return df

FEATS = ["hour", "dow", "weekend", "lag24", "lag168", "roll7_samehour", "station_code", "event_flag"]

def mase(y, yhat, scale):
    return float(np.mean(np.abs(y - yhat)) / scale) if scale > 0 else float("nan")

def smape(y, yhat):
    denom = (np.abs(y) + np.abs(yhat))
    m = denom > 0
    return float(np.mean(2 * np.abs(y - yhat)[m] / denom[m]))

def git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "nogit"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="synthetic", choices=["synthetic", "real"])
    ap.add_argument("--model", default="lgbm", choices=["lgbm", "naive"])
    ap.add_argument("--fast", action="store_true")
    a = ap.parse_args()

    df = add_features(load_panel(a.mode))
    if "event_flag" not in df:
        df["event_flag"] = 0
    df = df.dropna(subset=["lag168", "roll7_samehour"]).reset_index(drop=True)
    end = df.ts.max().normalize() + pd.Timedelta(days=1)
    folds = 2 if a.fast else 4
    fold_metrics = []
    for k in range(folds, 0, -1):
        test_start = end - pd.Timedelta(days=7 * k)
        test_end = test_start + pd.Timedelta(days=7)
        train = df[df.ts < test_start]
        test = df[(df.ts >= test_start) & (df.ts < test_end)]
        y = test.entries.to_numpy(float)
        naive = test.lag168.to_numpy(float)
        scale = float(np.mean(np.abs(train.entries - train.lag168)))
        res = {"fold_start": str(test_start.date()), "split": "test" if k == 1 else "val",
               "naive_mase": mase(y, naive, scale), "naive_smape": smape(y, naive)}
        if a.model == "lgbm":
            import lightgbm as lgb
            preds = {}
            for q in (0.1, 0.5, 0.9):
                m = lgb.LGBMRegressor(objective="quantile", alpha=q, n_estimators=200 if a.fast else 400,
                                      learning_rate=0.05, num_leaves=31, verbose=-1)
                m.fit(train[FEATS], train.entries)
                preds[q] = m.predict(test[FEATS])
            res.update({"lgbm_mase": mase(y, preds[0.5], scale), "lgbm_smape": smape(y, preds[0.5]),
                        "lgbm_coverage80": float(np.mean((y >= preds[0.1]) & (y <= preds[0.9])))})
            ev = test.event_flag.to_numpy() == 1
            if ev.any():
                res["lgbm_mase_event_days"] = mase(y[ev], preds[0.5][ev], scale)
        res["n"] = int(len(test))
        fold_metrics.append(res)

    test_fold = fold_metrics[-1]
    metrics = {k: v for k, v in test_fold.items() if isinstance(v, float)}
    out = {"suite": "forecast", "git_sha": git_sha(), "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
           "models": {"forecast": a.model, "baseline": "seasonal_naive_168h"},
           "dataset_version": f"{a.mode}:{df.ts.min().date()}..{df.ts.max().date()}",
           "is_synthetic": bool(df.is_synthetic.any()), "metrics": metrics, "n": test_fold["n"], "split": "test",
           "folds": fold_metrics}
    res_dir = ROOT / "eval/results"
    res_dir.mkdir(parents=True, exist_ok=True)
    p = res_dir / f"forecast_{dt.datetime.now():%Y%m%d-%H%M}.json"
    p.write_text(json.dumps(out, indent=2))
    print(json.dumps(metrics, indent=2))
    print(f"written {p}  (SYNTHETIC={out['is_synthetic']})")

if __name__ == "__main__":
    main()
