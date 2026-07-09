from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import sys
import types

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
from app.services.ai_engine import AIEngine
from app.services.event_level_analyzer import EventLevelAnalyzer
from app.services.preprocessing_service import PreprocessingService
from app.services.recommendation_service import RecommendationService
from app.services.scoring_service import ScoringService


class FakeDatabase:
    def __init__(self) -> None:
        self.ai_analysis_results: list[dict] = []

    def fetch_one(self, query: str, params: tuple = ()) -> dict | None:
        return None

    def fetch_all(self, query: str, params: tuple = ()) -> list[dict]:
        return []

    def insert_ai_result(self, result: dict) -> None:
        self.ai_analysis_results.append(result)


class EventOnlyPolicy:
    @staticmethod
    def active_model_id(level: str) -> str | None:
        return "event_rules_engine" if level == "event" else None


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


def build_engine(model_dir: str) -> tuple[AIEngine, FakeDatabase]:
    database = FakeDatabase()
    engine = AIEngine.__new__(AIEngine)
    engine.database = database
    engine.settings = SimpleNamespace(ai_enable_historical=False)
    engine.preprocessing = PreprocessingService(database)
    engine.event_level_analyzer = RulesEventAnalyzer(model_dir)
    engine.flow_level_analyzer = None
    engine.temporal_level_analyzer = None
    engine.graph_level_analyzer = None
    engine.historical_analyzer = None
    engine.ml_anomaly_service = None
    engine.scoring = ScoringService()
    engine.recommendations = RecommendationService()
    engine.model_policy = EventOnlyPolicy()
    engine._historical_cooldowns = {}
    return engine, database


def base_event() -> dict:
    return {
        "event_id": str(uuid4()),
        "event_type": "api_call",
        "flow_code": "F-CONTRACT",
        "api_code": "API-CONTRACT",
        "consumer_code": "CONSUMER-A",
        "producer_code": "PRODUCER-B",
        "correlation_id": str(uuid4()),
        "latency_ms": 120,
        "sla_latency_ms": 300,
        "status_code": 200,
        "success": True,
        "api_criticality": "low",
        "consumer_criticality": "low",
        "producer_criticality": "low",
        "flow_criticality": "low",
    }


class EventLevelContractTests(unittest.TestCase):
    def test_complete_event_level_validation_matrix(self) -> None:
        cases = [
            {
                "label": "NORMAL",
                "overrides": {},
                "risk_score": 0,
                "severity": "low",
                "confidence": 0.0,
                "explanation": "No anomaly detected at event level",
                "recommendation": "No action required",
                "next_level": "stop",
            },
            {
                "label": "TIMEOUT",
                "overrides": {
                    "status_code": 504,
                    "success": False,
                    "error_type": "timeout",
                },
                "risk_score": 50,
                "severity": "medium",
                "confidence": 0.90,
                "explanation": "The request ended with a timeout signal.",
                "recommendation": "Verifier la disponibilite du provider et la configuration des timeouts.",
                "next_level": "flow",
            },
            {
                "label": "SLA_BREACH",
                "overrides": {"is_sla_breach": True},
                "risk_score": 30,
                "severity": "low",
                "confidence": 0.88,
                "explanation": "The event breached the configured SLA latency.",
                "recommendation": "Verifier la charge, le reseau et les ressources du service concerne.",
                "next_level": "flow",
            },
            {
                "label": "SERVER_ERROR",
                "overrides": {"status_code": 500, "success": False},
                "risk_score": 45,
                "severity": "medium",
                "confidence": 0.86,
                "explanation": "HTTP 500 indicates a producer-side failure.",
                "recommendation": "Analyser les logs serveur du producteur et les erreurs applicatives recentes.",
                "next_level": "flow",
            },
            {
                "label": "PROVIDER_UNREACHABLE",
                "overrides": {"status_code": 503, "success": False},
                "risk_score": 70,
                "severity": "high",
                "confidence": 0.86,
                "explanation": "HTTP 503 indicates provider unavailability.",
                "recommendation": "Notifier l'equipe responsable du producteur et verifier la connectivite.",
                "next_level": "flow",
            },
            {
                "label": "ACCESS_DENIED",
                "overrides": {"status_code": 403, "success": False},
                "risk_score": 40,
                "severity": "medium",
                "confidence": 0.85,
                "explanation": "The event indicates denied or forbidden access.",
                "recommendation": "Controler les acces, les jetons et les autorisations de l'acteur consommateur.",
                "next_level": "flow",
            },
            {
                "label": "RATE_LIMIT_EXCEEDED",
                "overrides": {
                    "status_code": 429,
                    "success": False,
                    "error_type": "rate_limit_exceeded",
                },
                "risk_score": 45,
                "severity": "medium",
                "confidence": 0.78,
                "explanation": "The event exceeded an API rate limit.",
                "recommendation": "Verifier les quotas, le rythme d'appels du consommateur et la configuration de rate limiting.",
                "next_level": "flow",
            },
            {
                "label": "MISSING_CORRELATION_ID",
                "overrides": {
                    "correlation_id": None,
                    "anomaly_correlation_id": None,
                },
                "risk_score": 35,
                "severity": "medium",
                "confidence": 0.82,
                "explanation": "The event is missing a correlation identifier.",
                "recommendation": "Verifier la propagation des identifiants de correlation dans le producteur et le consommateur.",
                "next_level": "flow",
            },
            {
                "label": "MISSING_LATENCY_METRIC",
                "overrides": {"latency_ms": None},
                "risk_score": 35,
                "severity": "medium",
                "confidence": 0.82,
                "explanation": "The event does not contain a usable latency metric.",
                "recommendation": "Verifier l'instrumentation de latence et le mapping des metriques de l'appel.",
                "next_level": "flow",
            },
            {
                "label": "RESPONSE_TIME_SPIKE",
                "overrides": {"latency_ms": 450},
                "risk_score": 40,
                "severity": "medium",
                "confidence": 0.84,
                "explanation": "Latency is significantly above the SLA target.",
                "recommendation": "Verifier la charge, le reseau et les ressources du service concerne.",
                "next_level": "flow",
            },
            {
                "label": "DUPLICATE_EVENT",
                "overrides": {"metadata": {"duplicate": True}},
                "risk_score": 40,
                "severity": "medium",
                "confidence": 0.80,
                "explanation": "The event is marked as a duplicate technical event.",
                "recommendation": "Verifier l'idempotence du producteur d'evenements et le traitement Kafka du flux concerne.",
                "next_level": "flow",
            },
            {
                "label": "CORRUPTED_EVENT_PAYLOAD",
                "overrides": {"error_type": "corrupted_event_payload"},
                "risk_score": 50,
                "severity": "medium",
                "confidence": 0.84,
                "explanation": "The event payload is corrupted or technically inconsistent.",
                "recommendation": "Verifier le schema de l'evenement, la serialisation et le contrat de payload.",
                "next_level": "flow",
            },
        ]

        with tempfile.TemporaryDirectory() as model_dir:
            for case in cases:
                expected_type = case["label"]
                with self.subTest(label=expected_type):
                    engine, database = build_engine(model_dir)
                    event = {**base_event(), **case["overrides"]}

                    returned = engine.analyze_event("gisre.api.calls", event)

                    self.assertEqual(len(returned), 1)
                    self.assertEqual(len(database.ai_analysis_results), 1)
                    result = database.ai_analysis_results[0]
                    self.assertEqual(returned[0], result)
                    self.assertEqual(result["analysis_level"], "event")
                    self.assertEqual(result["event_id"], event["event_id"])
                    self.assertEqual(result["anomaly_type"], expected_type)
                    self.assertEqual(result["detected_anomaly_type"], expected_type)
                    self.assertEqual(result["anomaly_detected"], expected_type != "NORMAL")
                    self.assertEqual(result["risk_score"], case["risk_score"])
                    self.assertEqual(result["severity"], case["severity"])
                    self.assertAlmostEqual(result["confidence"], case["confidence"])
                    self.assertEqual(result["explanation"], case["explanation"])
                    self.assertEqual(result["recommendation"], case["recommendation"])
                    self.assertEqual(result["decision"]["next_level"], case["next_level"])
                    self.assertTrue(result["decision"]["reason"])

                    for field in (
                        "analysis_level",
                        "anomaly_detected",
                        "anomaly_type",
                        "risk_score",
                        "severity",
                        "confidence",
                        "explanation",
                        "recommendation",
                        "flow_code",
                        "api_code",
                        "consumer_code",
                        "producer_code",
                    ):
                        self.assertIn(field, result)

                    for persistence_field in (
                        "source_event_id",
                        "source_event_type",
                        "detected_anomaly_type",
                        "analysis_type",
                        "validation",
                        "metadata",
                    ):
                        self.assertIn(persistence_field, result)

                    metadata = result["metadata"]
                    triage = metadata["triage_decision"]
                    trace = metadata["analysis_trace"]["event"]
                    self.assertTrue(trace["executed"])
                    self.assertEqual(
                        trace["status"],
                        "success" if expected_type == "NORMAL" else "warning",
                    )
                    self.assertEqual(trace["anomaly_type"], expected_type)
                    self.assertEqual(trace["anomaly_detected"], expected_type != "NORMAL")
                    self.assertAlmostEqual(trace["confidence"], case["confidence"])
                    self.assertEqual(trace["risk_contribution"], case["risk_score"])
                    self.assertEqual(trace["decision_next_level"], case["next_level"])
                    self.assertEqual(trace["decision_reason"], result["decision"]["reason"])
                    self.assertEqual(
                        trace["routing_trigger"],
                        "NONE" if expected_type == "NORMAL" else "EVENT_ANOMALY",
                    )
                    self.assertEqual(result["model_id"], metadata["model"]["id"])
                    self.assertEqual(result["model_id"], metadata["model_id"])
                    self.assertEqual(result["model_name"], metadata["model_name"])
                    self.assertEqual(result["model_version"], metadata["model_version"])
                    self.assertEqual(result["model_id"], trace["selected_model_id"])
                    self.assertEqual(result["model_name"], trace["selected_model_name"])
                    self.assertEqual(result["model_version"], trace["selected_model_version"])
                    self.assertEqual(triage["policy"], "default_triage_policy_v1")
                    self.assertIn(
                        triage["status"],
                        {"AUTO_CONFIRMED", "PENDING_REVIEW", "AUTO_DISMISSED"},
                    )
                    self.assertEqual(
                        result["validation_status"],
                        "auto_dismissed" if expected_type == "NORMAL" else "pending_review",
                    )
                    self.assertEqual(result["validation_source"], "model_validation")

                    for mirrored_field in (
                        "analysis_level",
                        "anomaly_detected",
                        "anomaly_type",
                        "risk_score",
                        "severity",
                        "confidence",
                        "explanation",
                        "recommendation",
                        "flow_code",
                        "decision",
                    ):
                        self.assertEqual(metadata[mirrored_field], result[mirrored_field])

                    if expected_type == "NORMAL":
                        self.assertEqual(
                            result["decision"]["reason"],
                            "Event risk is low and no flow context is required",
                        )
                    else:
                        self.assertIn(expected_type, result["decision"]["reason"])

    def test_normal_event_routes_to_flow_for_critical_business_context(self) -> None:
        with tempfile.TemporaryDirectory() as model_dir:
            for criticality_field, expected_trigger in (
                ("flow_criticality", "FLOW_CRITICALITY"),
                ("api_criticality", "API_CRITICALITY"),
            ):
                with self.subTest(criticality_field=criticality_field):
                    engine, database = build_engine(model_dir)
                    event = {
                        **base_event(),
                        criticality_field: "critical",
                    }

                    engine.analyze_event("gisre.api.calls", event)

                    result = database.ai_analysis_results[0]
                    trace = result["metadata"]["analysis_trace"]["event"]
                    self.assertFalse(result["anomaly_detected"])
                    self.assertEqual(result["anomaly_type"], "NORMAL")
                    self.assertEqual(result["decision"]["next_level"], "flow")
                    self.assertEqual(trace["routing_trigger"], expected_trigger)
                    self.assertIn("criticality is critical", result["decision"]["reason"])


if __name__ == "__main__":
    unittest.main()
