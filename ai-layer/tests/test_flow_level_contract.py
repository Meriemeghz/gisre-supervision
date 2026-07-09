from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if "psycopg2" not in sys.modules:
    psycopg2 = types.ModuleType("psycopg2")
    psycopg2_extras = types.ModuleType("psycopg2.extras")
    psycopg2_pool = types.ModuleType("psycopg2.pool")
    psycopg2_extras.RealDictCursor = object
    psycopg2_extras.Json = lambda value: value
    psycopg2_pool.ThreadedConnectionPool = object
    sys.modules["psycopg2"] = psycopg2
    sys.modules["psycopg2.extras"] = psycopg2_extras
    sys.modules["psycopg2.pool"] = psycopg2_pool

if "app.services.ml_anomaly_service" not in sys.modules:
    ml_anomaly_service = types.ModuleType("app.services.ml_anomaly_service")
    ml_anomaly_service.MLAnomalyService = object
    sys.modules["app.services.ml_anomaly_service"] = ml_anomaly_service

from app.ai_models.event_level.models import EventLevelRulesEngineModel
from app.ai_models.flow_level.models import FlowRulesEngineModel
from app.services.ai_engine import AIEngine
from app.services.event_level_analyzer import EventLevelAnalyzer
from app.services.flow_level_analyzer import FlowLevelAnalyzer
from app.services.preprocessing_service import PreprocessingService
from app.services.recommendation_service import RecommendationService
from app.services.scoring_service import ScoringService


class FakeDatabase:
    def __init__(self, flow_stats: dict) -> None:
        self.flow_stats = flow_stats
        self.ai_analysis_results: list[dict] = []

    def fetch_one(self, query: str, params: tuple = ()) -> dict | None:
        if "FROM flows f" in query:
            return {
                "flow_id": str(uuid4()),
                "flow_code": "F-FLOW-CONTRACT",
                "flow_sla_latency_ms": 300,
                "expected_calls_per_minute": 4,
                "api_id": str(uuid4()),
                "api_code": "API-FLOW-CONTRACT",
                "api_sla_latency_ms": 300,
                "api_criticality": "low",
                "producer_actor_id": str(uuid4()),
                "producer_code": "PRODUCER-FLOW",
                "producer_criticality": self.flow_stats.get("producer_criticality", "low"),
                "consumer_actor_id": str(uuid4()),
                "consumer_code": "CONSUMER-FLOW",
                "consumer_criticality": "low",
                "program_code": "PROGRAM-FLOW",
                "program_criticality": "low",
            }
        if "WITH current_window AS" in query:
            return self.flow_stats
        return None

    def fetch_all(self, query: str, params: tuple = ()) -> list[dict]:
        return []

    def insert_ai_result(self, result: dict) -> None:
        self.ai_analysis_results.append(result)


class EventAndFlowPolicy:
    @staticmethod
    def active_model_id(level: str) -> str | None:
        return {
            "event": "event_rules_engine",
            "flow": "flow_rules_engine",
        }.get(level)


class RulesEventAnalyzer:
    def __init__(self, model_dir: str) -> None:
        model = EventLevelRulesEngineModel(model_dir)
        self.models = {model.model_id: model}

    def analyze(self, event: dict, model_id: str | None = None) -> list[dict]:
        model = self.models[model_id or "event_rules_engine"]
        return [
            EventLevelAnalyzer._to_engine_anomaly(detection, model)
            for detection in model.detect(event)
        ]


def raw_flow_stats(**overrides: object) -> dict:
    stats = {
        "total_calls": 20,
        "success_count": 20,
        "error_count": 0,
        "avg_latency_ms": 120,
        "p95_latency_ms": 180,
        "sla_breach_count": 0,
        "timeout_count": 0,
        "server_error_count": 0,
        "consumer_count": 2,
        "producer_count": 1,
        "dominant_consumer_calls": 10,
        "previous_calls": 20,
        "previous_avg_latency_ms": 120,
    }
    stats.update(overrides)
    return stats


def base_event(force_flow: bool = True, producer_criticality: str = "low") -> dict:
    return {
        "event_id": str(uuid4()),
        "event_type": "api_call",
        "flow_id": str(uuid4()),
        "flow_code": "F-FLOW-CONTRACT",
        "api_code": "API-FLOW-CONTRACT",
        "consumer_code": "CONSUMER-FLOW",
        "producer_code": "PRODUCER-FLOW",
        "correlation_id": str(uuid4()),
        "latency_ms": 120,
        "sla_latency_ms": 300,
        "status_code": 200,
        "success": True,
        "is_sla_breach": force_flow,
        "api_criticality": "low",
        "consumer_criticality": "low",
        "producer_criticality": producer_criticality,
        "flow_criticality": "low",
    }


def build_engine(model_dir: str, stats: dict) -> tuple[AIEngine, FakeDatabase]:
    database = FakeDatabase(stats)
    flow_model = FlowRulesEngineModel(model_dir)
    flow_analyzer = FlowLevelAnalyzer.__new__(FlowLevelAnalyzer)
    flow_analyzer.database = database
    flow_analyzer.active_model = flow_model
    flow_analyzer.models = {flow_model.model_id: flow_model}

    engine = AIEngine.__new__(AIEngine)
    engine.database = database
    engine.settings = SimpleNamespace(ai_enable_historical=False)
    engine.preprocessing = PreprocessingService(database)
    engine.event_level_analyzer = RulesEventAnalyzer(model_dir)
    engine.flow_level_analyzer = flow_analyzer
    engine.temporal_level_analyzer = None
    engine.graph_level_analyzer = None
    engine.historical_analyzer = None
    engine.ml_anomaly_service = None
    engine.scoring = ScoringService()
    engine.recommendations = RecommendationService()
    engine.model_policy = EventAndFlowPolicy()
    engine._historical_cooldowns = {}
    return engine, database


class FlowLevelContractTests(unittest.TestCase):
    def test_complete_flow_level_validation_matrix(self) -> None:
        cases = [
            {
                "label": "FLOW_NORMAL",
                "stats": raw_flow_stats(),
                "status": "success",
                "executed": True,
                "next_level": "stop",
                "risk": 0,
                "routing_trigger": "NONE",
            },
            {
                "label": "FLOW_SLA_DEGRADATION",
                "stats": raw_flow_stats(sla_breach_count=8),
                "status": "warning",
                "executed": True,
                "next_level": "temporal",
                "risk": 60,
                "routing_trigger": "FLOW_ANOMALY",
            },
            {
                "label": "FLOW_LATENCY_DRIFT",
                "stats": raw_flow_stats(
                    avg_latency_ms=390,
                    p95_latency_ms=600,
                    previous_avg_latency_ms=250,
                ),
                "status": "warning",
                "executed": True,
                "next_level": "temporal",
                "risk": 58,
                "routing_trigger": "FLOW_ANOMALY",
            },
            {
                "label": "FLOW_ERROR_RATE_SPIKE",
                "stats": raw_flow_stats(success_count=15, error_count=5),
                "status": "warning",
                "executed": True,
                "next_level": "temporal",
                "risk": 55,
                "routing_trigger": "FLOW_ANOMALY",
            },
            {
                "label": "FLOW_TRAFFIC_DROP",
                "stats": raw_flow_stats(
                    total_calls=8,
                    success_count=8,
                    dominant_consumer_calls=4,
                    previous_calls=20,
                ),
                "status": "warning",
                "executed": True,
                "next_level": "temporal",
                "risk": 45,
                "routing_trigger": "FLOW_ANOMALY",
            },
            {
                "label": "FLOW_TRAFFIC_SPIKE",
                "stats": raw_flow_stats(
                    total_calls=45,
                    success_count=45,
                    dominant_consumer_calls=20,
                    previous_calls=20,
                ),
                "status": "warning",
                "executed": True,
                "next_level": "temporal",
                "risk": 45,
                "routing_trigger": "FLOW_ANOMALY",
            },
            {
                "label": "FLOW_INTERMITTENT_FAILURES",
                "stats": raw_flow_stats(
                    success_count=17,
                    error_count=3,
                    timeout_count=3,
                ),
                "status": "warning",
                "executed": True,
                "next_level": "temporal",
                "risk": 55,
                "routing_trigger": "FLOW_ANOMALY",
            },
            {
                "label": "FLOW_PROVIDER_DEGRADATION",
                "stats": raw_flow_stats(
                    success_count=17,
                    error_count=3,
                    server_error_count=3,
                    producer_criticality="high",
                ),
                "producer_criticality": "high",
                "status": "warning",
                "executed": True,
                "next_level": "temporal",
                "risk": 83,
                "routing_trigger": "FLOW_RISK_THRESHOLD",
            },
            {
                "label": "FLOW_CONSUMER_ABUSE",
                "stats": raw_flow_stats(dominant_consumer_calls=15),
                "status": "warning",
                "executed": True,
                "next_level": "stop",
                "risk": 52,
                "routing_trigger": "NONE",
            },
            {
                "label": "FLOW_HEALTH_DEGRADATION",
                "stats": raw_flow_stats(
                    success_count=15,
                    error_count=5,
                    avg_latency_ms=450,
                    p95_latency_ms=650,
                    previous_avg_latency_ms=250,
                    sla_breach_count=8,
                    timeout_count=3,
                    server_error_count=3,
                ),
                "status": "warning",
                "executed": True,
                "next_level": "temporal",
                "risk": 72,
                "routing_trigger": "FLOW_ANOMALY",
            },
            {
                "label": "FLOW_SKIPPED",
                "stats": raw_flow_stats(),
                "force_flow": False,
                "status": "skipped",
                "executed": False,
                "next_level": "stop",
                "risk": 0,
                "routing_trigger": "NONE",
            },
            {
                "label": "FLOW_WARMING_UP",
                "stats": raw_flow_stats(
                    total_calls=2,
                    success_count=2,
                    dominant_consumer_calls=2,
                ),
                "status": "warming_up",
                "executed": False,
                "next_level": "stop",
                "risk": 0,
                "routing_trigger": "NONE",
            },
        ]

        with tempfile.TemporaryDirectory() as model_dir:
            for case in cases:
                with self.subTest(label=case["label"]):
                    engine, database = build_engine(model_dir, case["stats"])
                    event = base_event(
                        force_flow=case.get("force_flow", True),
                        producer_criticality=case.get("producer_criticality", "low"),
                    )

                    returned = engine.analyze_event("gisre.api.calls", event)

                    event_result = database.ai_analysis_results[0]
                    trace = event_result["metadata"]["analysis_trace"]["flow"]
                    self.assertEqual(trace["status"], case["status"])
                    self.assertEqual(trace["executed"], case["executed"])
                    self.assertEqual(trace["risk_contribution"], case["risk"])
                    self.assertEqual(trace["decision_next_level"], case["next_level"])
                    self.assertTrue(trace["decision_reason"])
                    self.assertEqual(trace["routing_trigger"], case["routing_trigger"])
                    self.assertIn("metrics", trace)
                    self.assertIn("risk_fusion", event_result["metadata"])
                    self.assertIn("triage_decision", event_result["metadata"])
                    self.assertEqual(
                        event_result["validation_status"],
                        "auto_dismissed" if case["label"] == "FLOW_SKIPPED" else "pending_review",
                    )
                    self.assertEqual(returned, database.ai_analysis_results)

                    if case["label"] == "FLOW_SKIPPED":
                        self.assertEqual(len(database.ai_analysis_results), 1)
                        self.assertIsNone(trace["selected_model_id"])
                        self.assertEqual(
                            trace["skip_reason"],
                            "Event risk is low and no flow context is required",
                        )
                        continue

                    self.assertEqual(trace["selected_model_id"], "flow_rules_engine")
                    self.assertEqual(trace["selected_model_name"], "Flow-Level Rules Engine")
                    self.assertEqual(trace["selected_model_version"], "1.0.0")

                    if case["label"] == "FLOW_WARMING_UP":
                        self.assertEqual(len(database.ai_analysis_results), 1)
                        self.assertEqual(trace["skip_reason"], "Collecting flow window data")
                        continue

                    self.assertEqual(len(database.ai_analysis_results), 2)
                    flow_result = database.ai_analysis_results[1]
                    self.assertEqual(flow_result["analysis_level"], "flow")
                    self.assertEqual(flow_result["anomaly_type"], case["label"])
                    self.assertEqual(
                        flow_result["anomaly_detected"],
                        case["label"] != "FLOW_NORMAL",
                    )
                    self.assertEqual(flow_result["risk_score"], case["risk"])
                    self.assertEqual(flow_result["decision"]["next_level"], case["next_level"])
                    self.assertTrue(flow_result["decision"]["reason"])
                    self.assertEqual(flow_result["decision"]["routing_trigger"], case["routing_trigger"])
                    self.assertEqual(flow_result["window"], "5m")
                    self.assertEqual(flow_result["model_id"], "flow_rules_engine")
                    self.assertEqual(flow_result["metadata"]["model"]["id"], "flow_rules_engine")
                    self.assertEqual(flow_result["metadata"]["analysis_trace"]["flow"], trace)
                    self.assertEqual(
                        flow_result["metadata"]["triage_decision"],
                        event_result["metadata"]["triage_decision"],
                    )
                    self.assertEqual(
                        flow_result["validation_status"],
                        event_result["validation_status"],
                    )
                    self.assertEqual(
                        set(flow_result["metadata"]["risk_fusion"]["contributions"]),
                        {"event", "flow"},
                    )
                    self.assertNotIn(
                        "temporal",
                        flow_result["metadata"]["risk_fusion"]["contributions"],
                    )
                    for metric in (
                        "total_calls",
                        "success_count",
                        "error_count",
                        "success_rate",
                        "error_rate",
                        "avg_latency_ms",
                        "p95_latency_ms",
                        "sla_breach_count",
                        "sla_breach_rate",
                        "timeout_count",
                        "server_error_count",
                        "consumer_count",
                        "producer_count",
                        "traffic_change_rate",
                        "latency_trend",
                        "flow_criticality",
                    ):
                        self.assertIn(metric, flow_result["metrics"])


if __name__ == "__main__":
    unittest.main()
