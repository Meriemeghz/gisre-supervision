from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)


class CacheService:
    """Redis-backed JSON cache with safe fallback when Redis is unavailable."""

    def __init__(self, redis_url: str, enabled: bool = True, client: Any | None = None) -> None:
        self.enabled = enabled
        self.redis_url = redis_url
        self.client = client
        if not self.enabled:
            logger.info("[CACHE] disabled")
            return
        if self.client is not None:
            return
        try:
            import redis  # noqa: PLC0415

            self.client = redis.Redis.from_url(
                redis_url,
                socket_connect_timeout=1.0,
                socket_timeout=1.5,
                decode_responses=True,
            )
            self.client.ping()
            logger.info("[CACHE] connected url=%s", redis_url)
        except Exception as exc:  # pragma: no cover - depends on runtime Redis
            self.client = None
            logger.warning("[CACHE] unavailable fallback url=%s error=%s", redis_url, exc)

    def get_json(self, key: str) -> Any | None:
        if not self._available():
            return None
        try:
            raw = self.client.get(key)
            if raw is None:
                logger.info("[CACHE] miss key=%s", key)
                return None
            logger.info("[CACHE] hit key=%s", key)
            return json.loads(raw)
        except Exception as exc:
            logger.warning("[CACHE] get failed key=%s error=%s", key, exc)
            return None

    def set_json(self, key: str, value: Any, ttl: int) -> None:
        if not self._available():
            return
        try:
            self.client.setex(key, ttl, json.dumps(value, default=str, ensure_ascii=False))
            logger.info("[CACHE] set key=%s ttl=%s", key, ttl)
        except Exception as exc:
            logger.warning("[CACHE] set failed key=%s error=%s", key, exc)

    def delete(self, key: str) -> None:
        if not self._available():
            return
        try:
            self.client.delete(key)
            logger.info("[CACHE] invalidated key=%s", key)
        except Exception as exc:
            logger.warning("[CACHE] delete failed key=%s error=%s", key, exc)

    def delete_pattern(self, pattern: str) -> None:
        if not self._available():
            return
        try:
            keys = list(self.client.scan_iter(match=pattern, count=200))
            if keys:
                self.client.delete(*keys)
            logger.info("[CACHE] invalidated pattern=%s count=%s", pattern, len(keys))
        except Exception as exc:
            logger.warning("[CACHE] pattern delete failed pattern=%s error=%s", pattern, exc)

    def get_or_set(self, key: str, ttl: int, loader: Callable[[], Any]) -> Any:
        cached = self.get_json(key)
        if cached is not None:
            return cached
        value = loader()
        self.set_json(key, value, ttl)
        return value

    @staticmethod
    def build_cache_key(prefix: str, filters_or_payload: Any) -> str:
        normalized = json.dumps(filters_or_payload or {}, sort_keys=True, default=str, ensure_ascii=False)
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
        return f"{prefix}:{digest}"

    def _available(self) -> bool:
        return bool(self.enabled and self.client is not None)


def get_cache(app_state: Any) -> CacheService | None:
    return getattr(app_state, "cache_service", None)
