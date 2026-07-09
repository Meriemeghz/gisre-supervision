from __future__ import annotations

import unittest

from app.services.cache_service import CacheService


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.deleted: list[str] = []

    def get(self, key: str):
        return self.store.get(key)

    def setex(self, key: str, _ttl: int, value: str):
        self.store[key] = value

    def delete(self, *keys: str):
        self.deleted.extend(keys)
        for key in keys:
            self.store.pop(key, None)

    def scan_iter(self, match: str, count: int = 200):
        prefix = match[:-1] if match.endswith("*") else match
        return [key for key in self.store if key.startswith(prefix)]


class BrokenRedis:
    def get(self, _key: str):
        raise RuntimeError("redis down")

    def setex(self, *_args):
        raise RuntimeError("redis down")

    def scan_iter(self, *_args, **_kwargs):
        raise RuntimeError("redis down")


class CacheServiceTests(unittest.TestCase):
    def test_cache_miss_calls_loader_and_stores_result(self):
        redis = FakeRedis()
        cache = CacheService("redis://test", client=redis)
        calls = {"count": 0}

        def loader():
            calls["count"] += 1
            return {"value": 42}

        result = cache.get_or_set("historical:abc", 60, loader)

        self.assertEqual(result, {"value": 42})
        self.assertEqual(calls["count"], 1)
        self.assertIn("historical:abc", redis.store)

    def test_cache_hit_does_not_call_loader(self):
        redis = FakeRedis()
        cache = CacheService("redis://test", client=redis)
        cache.set_json("model_catalog", [{"id": "m1"}], 60)

        result = cache.get_or_set("model_catalog", 60, lambda: self.fail("loader called"))

        self.assertEqual(result, [{"id": "m1"}])

    def test_redis_unavailable_falls_back_without_fatal_error(self):
        cache = CacheService("redis://test", client=BrokenRedis())
        result = cache.get_or_set("any", 60, lambda: {"fallback": True})

        self.assertEqual(result, {"fallback": True})

    def test_delete_pattern_invalidates_matching_keys(self):
        redis = FakeRedis()
        cache = CacheService("redis://test", client=redis)
        cache.set_json("historical:a", {"a": 1}, 60)
        cache.set_json("historical:b", {"b": 1}, 60)
        cache.set_json("model_catalog", [], 60)

        cache.delete_pattern("historical:*")

        self.assertNotIn("historical:a", redis.store)
        self.assertNotIn("historical:b", redis.store)
        self.assertIn("model_catalog", redis.store)

    def test_build_cache_key_is_stable_for_equivalent_payloads(self):
        left = CacheService.build_cache_key("openai:historical", {"b": 2, "a": 1})
        right = CacheService.build_cache_key("openai:historical", {"a": 1, "b": 2})
        self.assertEqual(left, right)

    def test_openai_historical_cache_hit_can_skip_loader(self):
        redis = FakeRedis()
        cache = CacheService("redis://test", client=redis)
        key = cache.build_cache_key("openai:historical", {"period": "7d"})
        cache.set_json(key, {"configured": True, "executive_summary": "cached"}, 86400)

        result = cache.get_or_set(key, 86400, lambda: self.fail("OpenAI loader called"))

        self.assertEqual(result["executive_summary"], "cached")


if __name__ == "__main__":
    unittest.main()
