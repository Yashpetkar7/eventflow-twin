"""Every threshold in eval/thresholds.yaml has a rule in eval/gate.py (decision #136): an unchecked threshold looked
green while checking nothing (found 16 Nov: two new orchestration thresholds were silently skipped)."""
from pathlib import Path

import yaml

from eval import gate

ROOT = Path(__file__).resolve().parents[1]


def test_every_threshold_has_a_gate_rule():
    th = yaml.safe_load((ROOT / "eval/thresholds.yaml").read_text(encoding="utf-8"))
    keys = {f"{s}.{n}" for s, v in th.items() if isinstance(v, dict) for n in v}
    assert keys - set(gate.RULES) == set(), "thresholds with no rule in eval/gate.py"
