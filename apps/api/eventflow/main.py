"""FastAPI scaffold. Phase 3–4 extend this (agents, decisions, evidence)."""
from __future__ import annotations
import glob, json, uuid
from pathlib import Path
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from .config import ROOT, corridor, events
from .event_model import overlay
from .simulate import simulate

app = FastAPI(title="EventFlow Twin API", version="0.1.0")
RUNS: dict[str, dict] = {}

class ForecastReq(BaseModel):
    event_id: str | None = None
    weekday: int = Field(2, ge=0, le=6, description="0=Mon … 6=Sun; used to pick the background profile")

class Intervention(BaseModel):
    type: str
    params: dict = {}

class SimReq(BaseModel):
    forecast_run_id: str
    interventions: list[Intervention] = []

def _panel() -> pd.DataFrame:
    real = ROOT / "data/processed/station_hour.parquet"
    p = real if real.exists() else ROOT / "data/synthetic/station_hour_synthetic.parquet"
    if not p.exists():
        raise HTTPException(503, "No data. Run `make synth` (or Phase 1 ingest).")
    return pd.read_parquet(p)

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/stations")
def stations():
    return corridor()["stations"]

@app.get("/events")
def list_events():
    return events()

@app.post("/forecast")
def forecast(req: ForecastReq):
    df = _panel()
    is_syn = bool(df.get("is_synthetic", pd.Series([False])).any())
    df = df[(df.ts.dt.dayofweek == req.weekday) & (df.get("event_flag", 0) == 0)]
    prof = df.groupby(["station_id", df.ts.dt.hour])["entries"].median()
    ev = next((e for e in events() if e["id"] == req.event_id), None) if req.event_id else None
    extra = overlay(ev) if ev else {}
    demand = {}
    for s in [st["id"] for st in corridor()["stations"]]:
        base = [float(prof.get((s, h), 0.0)) for h in range(24)]
        evp = extra.get(s, {}).get("entries", [0.0] * 24)
        demand[s] = {"base": base, "event": list(evp)}
    run_id = f"fc_{uuid.uuid4().hex[:8]}"
    RUNS[run_id] = {"demand": demand, "event": ev, "is_synthetic": is_syn}
    rows = [{"station_id": s, "hour": h, "entries_p50": round(v["base"][h] + v["event"][h], 1)} for s, v in demand.items() for h in range(24)]
    return {"run_id": run_id, "model": "median-profile+event-overlay (scaffold)", "is_synthetic": is_syn,
            "event_is_assumption": bool(ev and ev.get("is_assumption")), "rows": rows}

@app.post("/simulate")
def simulate_ep(req: SimReq):
    run = RUNS.get(req.forecast_run_id)
    if not run:
        raise HTTPException(404, "Unknown forecast_run_id")
    res = simulate(run["demand"], [i.model_dump() for i in req.interventions])
    return {"run_id": f"sim_{uuid.uuid4().hex[:8]}", "source_forecast": req.forecast_run_id, "is_synthetic": run["is_synthetic"],
            "summary": res.summary, "diverted_off_metro": res.diverted_off_metro, "notes": res.notes, "rows": res.rows}

@app.get("/evidence")
def evidence():
    files = sorted(glob.glob(str(ROOT / "eval/results/*.json")))
    latest = {}
    for f in files:
        d = json.loads(Path(f).read_text())
        latest[d["suite"]] = {"file": Path(f).name, "metrics": d["metrics"], "n": d.get("n"), "split": d.get("split"),
                              "is_synthetic": d.get("is_synthetic")}
    return latest
