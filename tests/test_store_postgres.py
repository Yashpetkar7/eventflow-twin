"""store.py on a real Postgres (decision #132). Runs only when EVENTFLOW_TEST_PG is set (CI starts a Postgres service);
the booth and laptops use SQLite, which test_chain_auth_log.py covers."""
import os
import uuid

import pytest

from apps.api.eventflow.store import Store

URL = os.environ.get("EVENTFLOW_TEST_PG")
pytestmark = pytest.mark.skipif(not URL, reason="EVENTFLOW_TEST_PG not set (CI runs this against a Postgres service)")


def test_put_get_list_delete_on_postgres():
    s = Store(URL)
    assert s.kind == "postgres"
    k = f"chain_{uuid.uuid4().hex[:8]}"
    s.put("chains", k, {"status": "running", "events": [1, 2]}, owner="tester")
    s.put("chains", k, {"status": "ended", "events": [1, 2, 3]}, owner="tester")
    assert s.get("chains", k) == {"status": "ended", "events": [1, 2, 3]}
    assert any(r["id"] == k for r in s.list("chains", owner="tester"))
    s.delete("chains", k)
    assert s.get("chains", k) is None
