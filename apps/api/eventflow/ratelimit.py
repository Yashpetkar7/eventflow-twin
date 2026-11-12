"""Sliding-window request limiter for the public demo. Per instance and in memory: a courtesy limit that keeps one
visitor from hammering the planner, not a security boundary (use the hosting platform's firewall for that)."""
from __future__ import annotations

from collections import deque


class RateLimit:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float) -> bool:
        """Record a request from `key` at time `now` (seconds) and say whether it is within the limit."""
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] >= 60.0:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        if len(self._hits) > 5000:             # bounded memory: forget idle clients
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] >= 60.0]:
                del self._hits[k]
        return True
