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
from app.ai_models.temporal_level.models import TemporalRulesEngineModel
from app.services.ai_engine import AIEngine
from app.services.event_level_analyzer import EventLevelAnalyzer
from app.services.flow_level_analyzer import FlowLevelAnalyzer
from app.services.preprocessing_service import PreprocessingService
from app.services.recommendation_service import RecommendationService
from app.services.scoring_service import ScoringService
from app.services.temporal_level_analyzer import TemporalLevelAnalyzer
from app.services.triage_engine import TriageEngine


class FakeDatabase:
    def __init__(self, flow_stats: dict, temporal_stats: dict) -> None:
        self.flow_stats = flow_stats
        self.temporal_stats = temporal_stats
        self.ai_analysis_results: list[dict] = []

    def fetch_one(self, query: str, params: tuple = ()) -> dict | None:
        if "FROM flows f" in query:
            return {
                "flow_id": str(uuid4()),
                "flow_code": "F-TEMPORAL-CONTRACT",
                "flow_sla_latency_ms": 300,
                "expected_calls_per_minute": 4,
                "api_id": str(uuid4()),
                "api_code": "API-TEMPORAL-CONTRACT",
                "api_sla_latency_ms": 300,
                "api_criticality": "low",
                "producer_actor_id": str(uuid4()),
                "producer_code": "PRODUCER-TEMPORAL",
                "producer_criticality": "low",
                "consumer_actor_id": str(uuid4()),
                "consumer_code": "CONSUMER-TEMPORAL",
                "consumer_criticality": "low",
                "program_code": "PROGRAM-TEMPORAL",
                "program_criticality": "low",
            }
        if "COUNT(*)::int AS total_calls" in query:
            return self.flow_stats
        if "WITH sequence AS" in query:
            return self.temporal_stats
        return None

    def fetch_all(self, query: str, params: tuple = ()) -> list[dict]:
        return []

    def insert_ai_result(self, result: dict) -> None:
        self.ai_analysis_results.append(result)


class EventFlowTemporalPolicy:
    @staticmethod
    def active_model_id(level: str) -> str | None:
        return {
            "event": "event_rules_engine",
            "flow": "flow_rules_engine",
            "temporal": "temporal_rules_engine",
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


def flow_stats(force_temporal: bool = True) -> dict:
    return {
        "total_calls": 20,
        "success_count": 20,
        "error_count": 0,
        "avg_latency_ms": 120,
        "p95_latency_ms": 180,
        "sla_breach_count": 8 if force_temporal else 0,
        "timeout_count": 0,
        "server_error_count": 0,
        "consumer_count": 1,
        "producer_count": 1,
        "dominant_consumer_calls": 10,
        "previous_calls": 20,
        "previous_avg_latency_ms": 120,
    }


def temporal_stats(**overrides: object) -> dict:
    stats = {
        "event_count": 12,
        "anomaly_count": 0,
        "repeated_anomaly_count": 0,
        "avg_latency_ms": 120,
        "current_count": 6,
        "previous_count": 6,
        "current_avg_latency": 120,
        "previous_avg_latency": 120,
        "current_error_rate": 0.0,
        "previous_error_rate": 0.0,
        "current_sla_rate": 0.0,
        "previous_sla_rate": 0.0,
        "timeout_count": 0,
        "availability_transitions": 0,
        "sla_status_transitions": 0,
        "current_ingestion_delay_ms": 100,
        "previous_ingestion_delay_ms": 100,
        "consumer_count": 1,
        "producer_count": 1,
        "latency_slope": 0.0,
        "ingestion_delay_slope": 0.0,
        "dominant_anomaly_type": None,
        "current_consumer_share": 0.5,
        "previous_consumer_share": 0.5,
    }
    stats.update(overrides)
    return stats


def base_event() -> dict:
    return {
        "event_id": str(uuid4()),
        "event_type": "api_call",
        "flow_id": str(uuid4()),
        "flow_code": "F-TEMPORAL-CONTRACT",
        "api_code": "API-TEMPORAL-CONTRACT",
        "consumer_code": "CONSUMER-TEMPORAL",
        "producer_code": "PRODUCER-TEMPORAL",
        "correlation_id": str(uuid4()),
        "latency_ms": 420,
        "sla_latency_ms": 300,
        "status_code": 200,
        "success": True,
        "is_sla_breach": True,
        "api_criticality": "low",
        "consumer_criticality": "low",
        "producer_criticality": "low",
        "flow_criticality": "low",
    }


def build_engine(
    model_dir: str,
    raw_flow_stats: dict,
    raw_temporal_stats: dict,
) -> tuple[AIEngine, FakeDatabase]:
    database = FakeDatabase(raw_flow_stats, raw_temporal_stats)

    flow_model = FlowRulesEngineModel(model_dir)
    flow_analyzer = FlowLevelAnalyzer.__new__(FlowLevelAnalyzer)
    flow_analyzer.database = database
    flow_analyzer.active_model = flow_model
    flow_analyzer.models = {flow_model.model_id: flow_model}

    temporal_model = TemporalRulesEngineModel(model_dir)
    temporal_analyzer = TemporalLevelAnalyzer.__new__(TemporalLevelAnalyzer)
    temporal_analyzer.database = database
    temporal_analyzer.active_model = temporal_model
    temporal_analyzer.models = {temporal_model.model_id: temporal_model}

    engine = AIEngine.__new__(AIEngine)
    engine.database = database
    engine.settings = SimpleNamespace(ai_enable_historical=False)
    engine.preprocessing = PreprocessingService(database)
    engine.event_level_analyzer = RulesEventAnalyzer(model_dir)
    engine.flow_level_analyzer = flow_analyzer
    engine.temporal_level_analyzer = temporal_analyzer
    engine.graph_level_analyzer = None
    engine.historical_analyzer = None
    engine.ml_anomaly_service = None
    engine.scoring = ScoringService()
    engine.recommendations = RecommendationService()
    engine.triage = TriageEngine()
    engine.model_policy = EventFlowTemporalPolicy()
    engine._historical_cooldowns = {}
    return engine, database


class TemporalLevelContractTests(unittest.TestCase):
    def test_consumer_profile_drift_is_supported(self) -> None:
        model = TemporalRulesEngineModel()
        normalized = TemporalLevelAnalyzer._normalize_stats(
            temporal_stats(
                current_consumer_share=0.85,
                previous_consumer_share=0.35,
            )
        )

        detections = model.detect(base_event(), normalized)

        self.assertEqual(detections[0]["anomaly_type"], "consumer_profile_drift")
        self.assertTrue(detections[0]["anomaly_detected"])
        self.assertGreaterEqual(detections[0]["risk_score"], 60)

    def test_complete_temporal_level_validation_matrix(self) -> None:
        cases = [
            {
                "label": "TEMPORAL_NORMAL",
                "stats": temporal_stats(),
                "status": "success",
                "executed": True,
                "risk": 0,
                "next_level": "stop",
            },
            {
                "label": "latency_drift",
                "stats": temporal_stats(
                    current_avg_latency=168,
                    previous_avg_latency=120,
                    latency_slope=0.09,
                ),
                "status": "warning",
                "executed": True,
                "risk": 68,
                "next_level": "graph",
            },
            {
                "label": "gradual_performance_degradation",
                "stats": temporal_stats(
                    current_avg_latency=220,
                    previous_avg_latency=120,
                    latency_slope=0.15,
                ),
                "status": "warning",
                "executed": True,
                "risk": 78,
                "next_level": "graph",
            },
            {
                "label": "sla_instability",
                "stats": temporal_stats(
                    anomaly_count=4,
                    repeated_anomaly_count=4,
                    current_sla_rate=0.5,
                    previous_sla_rate=0.1,
                    sla_status_transitions=4,
                    dominant_anomaly_type="SLA_BREACH",
                ),
                "status": "warning",
                "executed": True,
                "risk": 65,
                "next_level": "graph",
            },
            {
                "label": "timeout_burst",
                "stats": temporal_stats(
                    anomaly_count=4,
                    repeated_anomaly_count=4,
                    timeout_count=4,
                    dominant_anomaly_type="TIMEOUT",
                ),
                "status": "warning",
                "executed": True,
                "risk": 82,
                "next_level": "graph",
            },
            {
                "label": "service_flapping",
                "stats": temporal_stats(
                    anomaly_count=5,
                    availability_transitions=5,
                ),
                "status": "warning",
                "executed": True,
                "risk": 85,
                "next_level": "graph",
            },
            {
                "label": "intermittent_failure",
                "stats": temporal_stats(
                    anomaly_count=3,
                    current_error_rate=0.35,
                    previous_error_rate=0.05,
                ),
                "status": "warning",
                "executed": True,
                "risk": 68,
                "next_level": "graph",
            },
            {
                "label": "traffic_spike",
                "stats": temporal_stats(
                    event_count=18,
                    current_count=12,
                    previous_count=6,
                ),
                "status": "warning",
                "executed": True,
                "risk": 55,
                "next_level": "stop",
            },
            {
                "label": "traffic_drop",
                "stats": temporal_stats(
                    current_count=2,
                    previous_count=10,
                ),
                "status": "warning",
                "executed": True,
                "risk": 50,
                "next_level": "stop",
            },
            {
                "label": "delayed_event_ingestion",
                "stats": temporal_stats(
                    current_ingestion_delay_ms=2200,
                    previous_ingestion_delay_ms=200,
                    ingestion_delay_slope=0.1,
                ),
                "status": "warning",
                "executed": True,
                "risk": 60,
                "next_level": "stop",
            },
            {
                "label": "TEMPORAL_SKIPPED",
                "stats": temporal_stats(),
                "force_temporal": False,
                "status": "skipped",
                "executed": False,
                "risk": 0,
                "next_level": "stop",
            },
            {
                "label": "TEMPORAL_UNAVAILABLE",
                "stats": temporal_stats(
                    event_count=2,
                    current_count=1,
                    previous_count=1,
                ),
                "status": "unavailable",
                "executed": False,
                "risk": 0,
                "next_level": "stop",
            },
        ]

        with tempfile.TemporaryDirectory() as model_dir:
            for case in cases:
                with self.subTest(label=case["label"]):
                    engine, database = build_engine(
                        model_dir,
                        flow_stats(case.get("force_temporal", True)),
                        case["stats"],
                    )

                    returned = engine.analyze_event(
                        "gisre.api.calls",
                        base_event(),
                    )

                    event_result = database.ai_analysis_results[0]
                    trace = event_result["metadata"]["analysis_trace"]["temporal"]
                    self.assertEqual(trace["status"], case["status"])
                    self.assertEqual(trace["executed"], case["executed"])
                    self.assertEqual(trace["risk_contribution"], case["risk"])
                    self.assertEqual(trace["decision_next_level"], case["next_level"])
                    self.assertTrue(trace["decision_reason"])
                    self.assertIn("metrics", trace)
                    self.assertIn("temporal", event_result["metadata"]["risk_fusion"]["contributions"])
                    self.assertEqual(
                        event_result["metadata"]["risk_fusion"]["contributions"]["temporal"],
                        case["risk"],
                    )
                    self.assertEqual(returned, database.ai_analysis_results)

                    if case["label"] == "TEMPORAL_SKIPPED":
                        self.assertEqual(len(database.ai_analysis_results), 2)
                        self.assertIsNone(trace["selected_model_id"])
                        self.assertEqual(
                            trace["skip_reason"],
                            "No repetitive or sequential pattern detected",
                        )
                        self.assertIn(
                            "temporal",
                            event_result["metadata"]["risk_fusion"]["skipped_levels"],
                        )
                        continue

                    self.assertEqual(trace["selected_model_id"], "temporal_rules_engine")
                    self.assertEqual(
                        trace["selected_model_name"],
                        "Temporal-Level Rules Engine",
                    )
                    self.assertEqual(trace["selected_model_version"], "1.0.0")
                    self.assertEqual(trace["window"], "15m")

                    if case["label"] == "TEMPORAL_UNAVAILABLE":
                        self.assertEqual(len(database.ai_analysis_results), 2)
                        self.assertEqual(
                            trace["skip_reason"],
                            "Insufficient temporal window data",
                        )
                        self.assertIn(
                            "temporal",
                            event_result["metadata"]["risk_fusion"]["skipped_levels"],
                        )
                        continue

                    self.assertEqual(len(database.ai_analysis_results), 3)
                    temporal_result = database.ai_analysis_results[2]
                    self.assertEqual(temporal_result["analysis_level"], "temporal")
                    self.assertEqual(temporal_result["anomaly_type"], case["label"])
                    self.assertEqual(
                        temporal_result["anomaly_detected"],
                        case["label"] != "TEMPORAL_NORMAL",
                    )
                    self.assertEqual(temporal_result["risk_score"], case["risk"])
                    self.assertEqual(
                        temporal_result["decision"]["next_level"],
                        case["next_level"],
                    )
                    self.assertTrue(temporal_result["decision"]["reason"])
                    self.assertEqual(temporal_result["window"], "15m")
                    self.assertEqual(
                        temporal_result["model_id"],
                        "temporal_rules_engine",
                    )
                    self.assertEqual(
                        temporal_result["metadata"]["model"]["id"],
                        "temporal_rules_engine",
                    )
                    self.assertEqual(
                        temporal_result["metadata"]["analysis_trace"]["temporal"],
                        trace,
                    )
                    self.assertEqual(
                        temporal_result["metadata"]["risk_fusion"],
                        event_result["metadata"]["risk_fusion"],
                    )
                    for metric in (
                        "event_count",
                        "anomaly_count",
                        "repeated_anomaly_count",
                        "avg_latency_ms",
                        "latency_slope",
                        "error_rate_trend",
                        "sla_breach_trend",
                        "dominant_anomaly_type",
                        "pattern_repetition_score",
                    ):
                        self.assertIn(metric, temporal_result["metrics"])


if __name__ == "__main__":
    unittest.main()
