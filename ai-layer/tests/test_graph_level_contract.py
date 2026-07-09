from __future__ import annotations

import unittest
import sys
import types

if "psycopg2" not in sys.modules:
    psycopg2_stub = types.ModuleType("psycopg2")
    psycopg2_stub.extras = types.SimpleNamespace(RealDictCursor=object, Json=lambda value: value)
    psycopg2_stub.pool = types.SimpleNamespace(SimpleConnectionPool=object, ThreadedConnectionPool=object)
    sys.modules["psycopg2"] = psycopg2_stub
    sys.modules["psycopg2.extras"] = psycopg2_stub.extras
    sys.modules["psycopg2.pool"] = psycopg2_stub.pool

from app.ai_models.graph_level.models import GraphRulesEngineModel
from app.services.graph_level_analyzer import GraphLevelAnalyzer
from app.services.triage_engine import TriageEngine


class FakeGraphDatabase:
    def __init__(self, stats: dict) -> None:
        self.stats = stats

    def fetch_one(self, query: str, params: tuple | None = None) -> dict:
        if "MAX(failure_count)" in query:
            return {"synchronized_failures": self.stats.get("synchronized_failures", 0)}
        return dict(self.stats)

    def fetch_all(self, query: str, params: tuple | None = None) -> list[dict]:
        if "flow_code" in query:
            return [{"flow_code": "F1", "calls": 12, "error_rate": 0.3, "avg_latency_ratio": 1.8}]
        if "consumer_code" in query:
            return [{"consumer_code": "C1", "calls": 8, "error_rate": 0.25}]
        if "api_code" in query:
            return [{"api_code": "verify_rights", "calls": 8, "error_rate": 0.25}]
        return []


class GraphLevelContractTest(unittest.TestCase):
    def test_graph_rules_engine_detects_supported_dependency_families(self) -> None:
        model = GraphRulesEngineModel()
        detections = model.detect(
            {"producer_criticality": "critical"},
            {
                "total_provider_calls": 220,
                "impacted_flows_count": 5,
                "impacted_consumers_count": 4,
                "impacted_apis_count": 3,
                "producer_error_rate": 0.28,
                "producer_sla_rate": 0.27,
                "producer_avg_latency_ratio": 1.7,
                "synchronized_failures": 5,
                "shared_provider_score": 90,
                "cascade_risk_score": 90,
                "dependency_hotspot_score": 90,
            },
        )

        anomaly_types = {item["anomaly_type"] for item in detections}
        self.assertIn("cascade_failure", anomaly_types)
        self.assertIn("shared_provider_failure", anomaly_types)
        self.assertIn("multi_consumer_impact", anomaly_types)
        self.assertIn("dependent_service_failure", anomaly_types)
        self.assertIn("dependency_hotspot", anomaly_types)
        self.assertIn("interoperability_degradation", anomaly_types)

    def test_graph_contract_returns_warming_up_for_small_window(self) -> None:
        analyzer = GraphLevelAnalyzer(
            FakeGraphDatabase(
                {
                    "total_provider_calls": 4,
                    "impacted_flows_count": 1,
                    "impacted_consumers_count": 1,
                    "impacted_apis_count": 1,
                }
            )
        )

        outcome = analyzer.analyze_contract(
            {"event_type": "api_call", "producer_actor_id": "producer-1"},
            model_id="graph_rules_engine",
        )

        self.assertEqual(outcome["status"], "warming_up")
        self.assertEqual(outcome["window"], "30m")
        self.assertEqual(outcome["metrics"]["impacted_flows_count"], 1)
        self.assertEqual(outcome["anomalies"], [])

    def test_graph_anomaly_requires_pending_review(self) -> None:
        decision = TriageEngine().decide(
            risk_score=82,
            confidence=0.92,
            severity="critical",
            anomaly_type="shared_provider_failure",
            event_trace={"executed": True, "anomaly_detected": True},
            flow_trace={"executed": True, "anomaly_detected": True},
            temporal_trace={"executed": True, "anomaly_detected": True},
            graph_trace={"executed": True, "anomaly_detected": True},
        )

        self.assertEqual(decision["status"], "PENDING_REVIEW")
        self.assertTrue(decision["requires_human_review"])


if __name__ == "__main__":
    unittest.main()
