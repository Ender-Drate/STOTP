"""内存令牌桶与失败锁定。

单进程部署足够；多进程/多机时替换为 Redis 实现（接口保持不变）。
"""

from __future__ import annotations

import threading
import time


class RateLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, last)
        self._last_prune = time.monotonic()

    def allow(self, key: str, capacity: float, refill_per_sec: float) -> bool:
        now = time.monotonic()
        with self._lock:
            tokens, last = self._buckets.get(key, (capacity, now))
            tokens = min(capacity, tokens + (now - last) * refill_per_sec)
            allowed = tokens >= 1.0
            if allowed:
                tokens -= 1.0
            self._buckets[key] = (tokens, now)
            if now - self._last_prune > 300:
                self._prune(now)
                self._last_prune = now
            return allowed

    def _prune(self, now: float) -> None:
        stale = [k for k, (_, last) in self._buckets.items() if now - last > 3600]
        for key in stale:
            self._buckets.pop(key, None)


class FailureLock:
    """连续失败 N 次后锁定一段时间；用于验证码试探。"""

    def __init__(self, max_failures: int = 5, window: float = 900, lock_for: float = 900):
        self.max_failures = max_failures
        self.window = window
        self.lock_for = lock_for
        self._lock = threading.Lock()
        self._failures: dict[str, list[float]] = {}
        self._locked_until: dict[str, float] = {}

    def is_locked(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            until = self._locked_until.get(key, 0.0)
            if until and until > now:
                return True
            if until:
                self._locked_until.pop(key, None)
                self._failures.pop(key, None)
            return False

    def fail(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            events = [t for t in self._failures.get(key, []) if now - t < self.window]
            events.append(now)
            self._failures[key] = events
            if len(events) >= self.max_failures:
                self._locked_until[key] = now + self.lock_for
                self._failures[key] = []

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
            self._locked_until.pop(key, None)
