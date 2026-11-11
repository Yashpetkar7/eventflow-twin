from __future__ import annotations
from functools import lru_cache
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[3]

@lru_cache
def corridor() -> dict:
    return yaml.safe_load((ROOT / "config/corridor.yaml").read_text(encoding="utf-8"))

@lru_cache
def events() -> list[dict]:
    return yaml.safe_load((ROOT / "config/events.yaml").read_text(encoding="utf-8"))["events"]
