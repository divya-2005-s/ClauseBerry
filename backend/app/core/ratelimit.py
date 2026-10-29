"""In-memory sliding-window rate limiter (per process).

Adequate for a single backend instance. A multi-instance deployment needs a shared store (e.g. Redis);
see docs/deployment.md.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from .errors import AppError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_seconds:
                q.popleft()
            if len(q) >= limit:
                retry = int(window_seconds - (now - q[0])) + 1
                err = AppError(429, "rate_limited", f"Too many requests. Try again in {retry} seconds.")
                err.headers = {"Retry-After": str(retry)}
                raise err
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()
