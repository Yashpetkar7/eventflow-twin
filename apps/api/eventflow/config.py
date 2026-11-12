from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]


def _load(rel: str):
    return yaml.safe_load((ROOT / rel).read_text(encoding="utf-8"))


@lru_cache
def network() -> dict | None:
    """Whole metro network generated from GTFS (scripts/build_network.py); None before it has been built."""
    return _load("config/network.yaml") if (ROOT / "config/network.yaml").exists() else None


@lru_cache
def corridor() -> dict:
    """Assumptions (corridor.yaml) + the whole network's stations, lines and walkable neighbours."""
    cfg = _load("config/corridor.yaml")
    net = network()
    if net:
        cfg["stations"] = [{k: v for k, v in s.items() if k != "gtfs_stop_ids"} for s in net["stations"]]
        cfg["lines"] = net["lines"]
        cfg["neighbours"] = net["neighbours"]
    else:                                   # featured corridor only (fresh clone without the generated network)
        for s in cfg["stations"]:
            s.setdefault("lines", [s["line"]])
            s.setdefault("in_corridor", True)
        ids = [s["id"] for s in cfg["stations"]]
        cfg["lines"] = {"Red": ids}
        cfg["neighbours"] = {a: [x for x in (ids[i - 1] if i else None, ids[i + 1] if i + 1 < len(ids) else None) if x]
                             for i, a in enumerate(ids)}
    return cfg


@lru_cache
def events() -> list[dict]:
    return _load("config/events.yaml")["events"]
