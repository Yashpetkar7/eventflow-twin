"""Rolling-origin backtest: seasonal-naive (t-168h) vs LightGBM quantile model.
Writes eval/results/forecast_<ts>.json (output contract in docs/08).

Forecast setting: at each fold origin we predict the next 7 days hourly (horizon 1–168 h). Every feature must
therefore be known at the origin. Only lags >= 168 h are used (lag168, lag336 and the mean of the same hour over
the four weeks ending t-168h). Lags such as t-24h would use actuals from inside the test week (leakage) and
make the model look better than it is, so they are deliberately excluded.
"""
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
    # Row-based shifts below assume a gap-free hourly series per station; refuse silently-wrong lags.
    gaps = df.groupby("station_id")["ts"].diff().dropna() != pd.Timedelta(hours=1)
    if gaps.any():
        raise SystemExit(f"{int(gaps.sum())} non-hourly steps in the panel; reindex to a full hourly grid first.")
    return df

def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["hour"] = df.ts.dt.hour
    df["dow"] = df.ts.dt.day_of_week
    # UAE weekend regime: Fri–Sat before 2022-01-01, Sat–Sun after
    post = df.ts >= pd.Timestamp("2022-01-01")
    df["weekend"] = np.where(post, df.dow >= 5, df.dow.isin([4, 5])).astype(int)
    g = df.groupby("station_id")["entries"]
    df["lag168"] = g.shift(168)
    df["lag336"] = g.shift(336)
    # same hour, mean over weeks t-1w … t-4w (all >= 168 h back, so known at a 7-day-ahead origin)
    df["mean_samehour_4w"] = sum(g.shift(168 * k) for k in range(1, 5)) / 4
    df["station_code"] = df.station_id.astype("category").cat.codes
    return df

FEATS = ["hour", "dow", "weekend", "lag168", "lag336", "mean_samehour_4w", "station_code", "event_flag"]
HORIZON_NOTE = "7-day-ahead hourly; features use only lags >= 168h (no within-horizon leakage)"

def mase(y, yhat, scale):
    return float(np.mean(np.abs(y - yhat)) / scale) if scale > 0 else float("nan")

def smape(y, yhat):
    denom = (np.abs(y) + np.abs(yhat))
    m = denom > 0
    return float(np.mean(2 * np.abs(y - yhat)[m] / denom[m]))

def errors(y, yhat) -> dict:
    """MAE, RMSE, WAPE and bias (mean of forecast − actual; positive = over-forecast) in riders per station-hour."""
    e = yhat - y
    tot = float(np.sum(np.abs(y)))
    return {"mae": float(np.mean(np.abs(e))), "rmse": float(np.sqrt(np.mean(e ** 2))),
            "wape": float(np.sum(np.abs(e)) / tot) if tot > 0 else float("nan"), "bias": float(np.mean(e))}


def profile_quantiles(train: pd.DataFrame, test: pd.DataFrame) -> dict:
    """The model the twin serves for background demand (apps/api/eventflow/forecast.py::_background): p10/p50/p90 of
    the same station, weekday and hour over the non-event days before the origin."""
    q = (train[train.event_flag == 0].groupby(["station_id", "dow", "hour"])["entries"]
         .quantile([0.1, 0.5, 0.9]).unstack().rename(columns={0.1: "p10", 0.5: "p50", 0.9: "p90"}).reset_index())
    m = test[["station_id", "dow", "hour"]].merge(q, on=["station_id", "dow", "hour"], how="left")
    return {k: m[k].to_numpy(float) for k in ("p10", "p50", "p90")}


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
    df = df.dropna(subset=["lag168", "lag336", "mean_samehour_4w"]).reset_index(drop=True)
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
        res.update({f"naive_{m}": v for m, v in errors(y, naive).items()})
        ev = test.event_flag.to_numpy() == 1
        # the served background model, scored on non-event rows only: on event days the twin adds the same overlay
        # the synthetic generator used (scripts/synth.py), so scoring those rows would grade the model on its own recipe
        prof = profile_quantiles(train, test)
        ok = ~ev & ~np.isnan(prof["p50"])
        if ok.any():
            res.update({"profile_mase": mase(y[ok], prof["p50"][ok], scale), "profile_n": int(ok.sum()),
                        "profile_coverage80": float(np.mean((y[ok] >= prof["p10"][ok]) & (y[ok] <= prof["p90"][ok]))),
                        "naive_mase_same_rows": mase(y[ok], naive[ok], scale)})
            res.update({f"profile_{m}": v for m, v in errors(y[ok], prof["p50"][ok]).items()})
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
            res.update({f"lgbm_{m}": v for m, v in errors(y, preds[0.5]).items()})
            # calibration: the share of actuals under each quantile forecast should be near the quantile
            res.update({f"lgbm_below_p{int(q * 100)}": float(np.mean(y < preds[q])) for q in (0.1, 0.5, 0.9)})
            for name, rows in (("event_days", ev), ("non_event_days", ~ev)):
                if rows.any():
                    res[f"lgbm_mase_{name}"] = mase(y[rows], preds[0.5][rows], scale)
                    res[f"lgbm_wape_{name}"] = errors(y[rows], preds[0.5][rows])["wape"]
                    res[f"n_{name}"] = int(rows.sum())
            if a.mode == "synthetic":
                st = test.station_id.to_numpy()
                res["by_station"] = {s: {"n": int((st == s).sum()), "naive_wape": round(errors(y[st == s], naive[st == s])["wape"], 4),
                                         "lgbm_wape": round(errors(y[st == s], preds[0.5][st == s])["wape"], 4),
                                         "lgbm_bias": round(errors(y[st == s], preds[0.5][st == s])["bias"], 2)}
                                     for s in sorted(set(st))}
        res["n"] = int(len(test))
        fold_metrics.append(res)

    test_fold = fold_metrics[-1]
    metrics = {k: v for k, v in test_fold.items() if isinstance(v, float)}
    out = {"suite": "forecast", "git_sha": git_sha(), "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
           "models": {"forecast": a.model, "baseline": "seasonal_naive_168h"},
           "dataset_version": f"{a.mode}:{df.ts.min().date()}..{df.ts.max().date()}",
           "is_synthetic": bool(df.is_synthetic.any()), "horizon": HORIZON_NOTE, "features": FEATS, "metrics": metrics, "n": test_fold["n"], "split": "test",
           "served_model": "profile_* = same-weekday-hour quantiles of non-event days: the background model the twin serves "
                           "(forecast.py); lgbm_* is a backtest only and serves no forecast",
           "limits": ["synthetic demand: these figures measure recovery of scripts/synth.py's pattern plus its noise, not skill on Dubai Metro",
                      "event days are generated with the event overlay the twin itself uses and event_flag is a feature, so event-day figures are optimistic",
                      "errors are in riders per station-hour of synthetic demand"],
           "folds": fold_metrics}
    res_dir = ROOT / "eval/results"
    res_dir.mkdir(parents=True, exist_ok=True)
    p = res_dir / f"forecast_{dt.datetime.now():%Y%m%d-%H%M}.json"
    p.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))
    print(f"written {p}  (SYNTHETIC={out['is_synthetic']})")

if __name__ == "__main__":
    main()
