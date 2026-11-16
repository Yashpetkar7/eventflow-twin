"""Empty the local SQLite store (chains, registered events, rider notices, users, sessions) — before opening the booth,
or after UI tests that register test events (decision #140).

    python tasks.py clean-store

Only the local SQLite file under EVENTFLOW_DATA_DIR (or data/) is removed; a Postgres DATABASE_URL is refused, so this
can never empty a shared database. The decision log (data/processed/decisions_log.jsonl) is NOT touched.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    if os.environ.get("DATABASE_URL", "").startswith(("postgres://", "postgresql://")):
        print("DATABASE_URL points at Postgres: refusing to clean a shared database.", file=sys.stderr)
        return 2
    db = Path(os.environ.get("EVENTFLOW_DATA_DIR") or ROOT / "data") / "processed" / "eventflow.db"
    if not db.exists():
        print(f"Nothing to clean: {db} does not exist.")
        return 0
    db.unlink()
    print(f"Removed {db} (chains, registered events, rider notices, users). The decision log was kept.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
