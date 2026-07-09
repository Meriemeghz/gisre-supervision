from __future__ import annotations

import unittest
from types import SimpleNamespace

try:
    from app.core.database import Database
except ModuleNotFoundError:
    Database = None

try:
    from app.routes.ai_model_routes import _invalidate_model_cache
    from app.routes.model_runtime_routes import _invalidate_activation_policy_cache
except ModuleNotFoundError:
    _invalidate_model_cache = None
    _invalidate_activation_policy_cache = None


class FakeCursor:
    def execute(self, _query, _params):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class FakeConnection:
    def cursor(self):
        return FakeCursor()

    def commit(self):
        return None

    def rollback(self):
        return None


class FakePool:
    def getconn(self):
        return FakeConnection()

    def putconn(self, _conn):
        return None


class FakeCache:
    def __init__(self):
        self.patterns: list[str] = []
        self.deleted: list[str] = []

    def delete_pattern(self, pattern: str):
        self.patterns.append(pattern)

    def delete(self, key: str):
        self.deleted.append(key)


def request_with_cache(cache: FakeCache):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(cache_service=cache)))


class RouteCacheInvalidationTests(unittest.TestCase):
    @unittest.skipIf(_invalidate_activation_policy_cache is None, "fastapi is not installed in the local host Python")
    def test_activation_policy_invalidation(self):
        cache = FakeCache()

        _invalidate_activation_policy_cache(request_with_cache(cache))

        self.assertEqual(cache.deleted, ["activation_policy", "model_catalog", "model_catalog:full", "model_metrics:all"])
        self.assertEqual(cache.patterns, ["model_detail:*"])

    @unittest.skipIf(_invalidate_model_cache is None, "fastapi is not installed in the local host Python")
    def test_model_training_invalidation(self):
        cache = FakeCache()

        _invalidate_model_cache(request_with_cache(cache), "event_random_forest")

        self.assertEqual(
            cache.deleted,
            [
                "model_metrics:event_random_forest",
                "model_metrics:all",
                "training_history:event_random_forest",
                "model_detail:event_random_forest",
                "model_catalog",
                "model_catalog:full",
            ],
        )


class DatabaseCacheInvalidationTests(unittest.TestCase):
    @unittest.skipIf(Database is None, "psycopg2 is not installed in the local host Python")
    def test_insert_ai_result_invalidates_historical_temporal_and_graph(self):
        database = Database.__new__(Database)
        database.settings = None
        database.pool = FakePool()
        database.cache_service = FakeCache()

        database.insert_ai_result(
            {
                "source_event_id": None,
                "source_event_type": "api_call",
                "flow_code": "F1",
                "api_id": None,
                "actor_id": None,
                "detected_anomaly_type": "NORMAL",
                "risk_score": 0,
                "severity": "low",
                "confidence": 1.0,
                "explanation": "ok",
                "recommendation": "none",
                "analysis_type": "realtime",
                "validation": {},
                "metadata": {},
                "validation_status": "auto_dismissed",
                "validation_source": "model_validation",
                "detected_at": "2026-06-16T00:00:00+00:00",
            }
        )

        self.assertEqual(
            database.cache_service.patterns,
            ["historical:*", "temporal:*", "graph:*"],
        )


if __name__ == "__main__":
    unittest.main()
