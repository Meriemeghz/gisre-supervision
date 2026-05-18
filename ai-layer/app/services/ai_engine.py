from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import Settings
from app.core.database import Database
from app.services.event_level_analyzer import EventLevelAnalyzer
from app.services.historical_analyzer import HistoricalAnalyzer
from app.services.ml_anomaly_service import MLAnomalyService
from app.services.preprocessing_service import PreprocessingService
from app.services.recommendation_service import RecommendationService
from app.services.scoring_service import ScoringService

logger = logging.getLogger(__name__)


SIMULATION_PRIMARY_AI = {
    "sla_breach": "SLA_BREACH",
    "traffic_spike": "TRAFFIC_SPIKE",
    "high_error_rate": "HIGH_ERROR_RATE",
    "provider_slowdown": "PROVIDER_SLOWDOWN",
    "timeout_burst": "TIMEOUT",
    "authentication_abuse": "AUTHENTICATION_ABUSE",
    "repeated_502_errors": "SERVER_ERROR",
    "provider_unreachable": "PROVIDER_UNREACHABLE",
    "latency_drift": "LATENCY_DRIFT",
    "access_denied_anomaly": "ACCESS_DENIED",
    "unexpected_volume": "TRAFFIC_SPIKE",
    "corrupted_event_payload": "DATA_CONSISTENCY_SIGNAL",
    "duplicate_event": "DATA_CONSISTENCY_SIGNAL",
    "missing_correlation_id": "DATA_CONSISTENCY_SIGNAL",
    "out_of_order_event": "DATA_CONSISTENCY_SIGNAL",
    "audit_gap": "DATA_CONSISTENCY_SIGNAL",
    "missing_latency_metric": "DATA_CONSISTENCY_SIGNAL",
    "response_time_spike": "HIGH_LATENCY",
    "gradual_performance_degradation": "LATENCY_DRIFT",
    "sla_instability": "SLA_BREACH",
    "traffic_drop": "TRAFFIC_SPIKE",
    "consumer_overuse": "TRAFFIC_SPIKE",
    "security_failure_burst": "SECURITY_FAILURE_BURST",
    "suspicious_access_pattern": "SUSPICIOUS_ACCESS",
    "unauthorized_api_attempt": "ACCESS_DENIED",
    "token_failure_pattern": "AUTHENTICATION_ABUSE",
    "rate_limit_exceeded": "ACCESS_DENIED",
    "cascade_failure": "PROVIDER_UNREACHABLE",
    "dependent_service_failure": "PROVIDER_UNREACHABLE",
    "multi_consumer_impact": "PROVIDER_SLOWDOWN",
    "shared_provider_failure": "PROVIDER_UNREACHABLE",
    "critical_provider_instability": "PROVIDER_SLOWDOWN",
    "global_security_alert": "SECURITY_FAILURE_BURST",
    "platform_health_degradation": "PROVIDER_SLOWDOWN",
    "critical_service_saturation": "HIGH_LATENCY",
    "hybrid_risk_signal": "PROVIDER_SLOWDOWN",
}


ANOMALY_PRIORITY = {
    "PROVIDER_UNREACHABLE": 1,
    "TIMEOUT": 2,
    "SERVER_ERROR": 3,
    "HIGH_ERROR_RATE": 4,
    "REPEATED_FAILURES": 5,
    "SECURITY_FAILURE_BURST": 6,
    "AUTHENTICATION_ABUSE": 7,
    "ACCESS_DENIED": 8,
    "SUSPICIOUS_ACCESS": 9,
    "RATE_LIMIT_EXCEEDED": 10,
    "PROVIDER_SLOWDOWN": 11,
    "LATENCY_SPIKE": 12,
    "ML_ISOLATION_FOREST": 13,
    "ML_ONE_CLASS_SVM": 14,
    "ML_RANDOM_FOREST": 15,
    "ML_KMEANS_CLUSTER": 16,
    "ML_AUTOENCODER": 17,
    "DL_GRU_SEQUENCE": 18,
    "LATENCY_DRIFT": 19,
    "HIGH_LATENCY": 20,
    "TRAFFIC_SPIKE": 21,
    "DATA_CONSISTENCY_SIGNAL": 22,
    "SLA_BREACH": 23,
}


HISTORICAL_MIN_SCORE = 60
HISTORICAL_COOLDOWN_SECONDS = 120


class AIEngine:
    def __init__(self, database: Database, settings: Settings) -> None:
        self.database = database
        self.settings = settings
        self.preprocessing = PreprocessingService(database)
        self.event_level_analyzer = EventLevelAnalyzer()
        self.historical_analyzer = HistoricalAnalyzer(database)
        self.ml_anomaly_service = MLAnomalyService(database)
        self.scoring = ScoringService()
        self.recommendations = RecommendationService()
        self._historical_cooldowns: dict[tuple[str, str], datetime] = {}

    def analyze_event(self, topic: str, event: dict[str, Any]) -> list[dict[str, Any]]:
        processed = self.preprocessing.preprocess(topic, event)
        anomalies: list[dict[str, Any]] = []

        if self.settings.ai_enable_realtime:
            anomalies.extend(self.event_level_analyzer.analyze(processed))

        if self.settings.ai_enable_historical:
            anomalies.extend(self.historical_analyzer.analyze(processed))
            anomalies.extend(self.ml_anomaly_service.analyze(processed))

        unique = self._deduplicate(anomalies)
        scored_anomalies = [self.scoring.score(anomaly, processed) for anomaly in unique]
        filtered = [anomaly for anomaly in scored_anomalies if self._should_keep_anomaly(anomaly, processed)]
        primary, secondary = self._select_primary(filtered)
        if primary is None:
            return []

        persisted: list[dict[str, Any]] = []
        primary["recommendation"] = self.recommendations.recommendation_for(primary["detected_anomaly_type"])
        primary["secondary_anomalies"] = [
            {
                "detected_anomaly_type": item["detected_anomaly_type"],
                "analysis_type": item.get("analysis_type"),
                "confidence": item.get("confidence"),
                "explanation": item.get("explanation"),
                "risk_score": item.get("risk_score"),
                "severity": item.get("severity"),
                "model": item.get("model"),
            }
            for item in secondary
        ]
        result = self._build_result(primary, processed)
        self.database.insert_ai_result(result)
        self._mark_historical_cooldown(primary, processed)
        persisted.append(result)

        return persisted

    def _should_keep_anomaly(self, anomaly: dict[str, Any], event: dict[str, Any]) -> bool:
        if anomaly.get("analysis_type") != "historical":
            return True

        if int(anomaly.get("risk_score") or 0) < HISTORICAL_MIN_SCORE:
            return False

        key = self._historical_cooldown_key(anomaly, event)
        if key is None:
            return True

        expires_at = self._historical_cooldowns.get(key)
        return expires_at is None or expires_at <= datetime.now(timezone.utc)

    def _mark_historical_cooldown(self, anomaly: dict[str, Any], event: dict[str, Any]) -> None:
        if anomaly.get("analysis_type") != "historical":
            return

        key = self._historical_cooldown_key(anomaly, event)
        if key is not None:
            self._historical_cooldowns[key] = datetime.now(timezone.utc) + timedelta(seconds=HISTORICAL_COOLDOWN_SECONDS)

    @staticmethod
    def _historical_cooldown_key(anomaly: dict[str, Any], event: dict[str, Any]) -> tuple[str, str] | None:
        flow_key = event.get("flow_id") or event.get("flow_code")
        anomaly_type = anomaly.get("detected_anomaly_type")
        if not flow_key or not anomaly_type:
            return None
        return str(flow_key), str(anomaly_type)

    def _build_result(self, anomaly: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
        detected_type = anomaly["detected_anomaly_type"]
        injected_type = event.get("injected_anomaly_type")
        expected_detection = SIMULATION_PRIMARY_AI.get(injected_type or "")

        return {
            "source_event_id": self._safe_uuid(event.get("event_id")),
            "source_event_type": event.get("event_type") or event.get("topic") or "unknown",
            "flow_code": event.get("flow_code"),
            "api_id": self._safe_uuid(event.get("api_id")),
            "actor_id": self._safe_uuid(event.get("actor_id") or event.get("consumer_actor_id")),
            "detected_anomaly_type": detected_type,
            "risk_score": anomaly["risk_score"],
            "severity": anomaly["severity"],
            "confidence": anomaly.get("confidence"),
            "explanation": anomaly.get("explanation"),
            "recommendation": anomaly.get("recommendation"),
            "analysis_type": anomaly.get("analysis_type", "realtime"),
            "validation": {
                "simulation_source": event.get("simulation_source"),
                "injected_anomaly_type": injected_type,
                "analysis_level": event.get("analysis_level"),
                "anomaly_family": event.get("anomaly_family"),
                "expected_detection": expected_detection or None,
                "matched_simulation": bool(injected_type and detected_type == expected_detection),
            },
            "metadata": {
                "topic": event.get("topic"),
                "correlation_id": event.get("correlation_id"),
                "event_sequence_number": event.get("event_sequence_number"),
                "scenario_id": event.get("scenario_id"),
                "simulation_mode": event.get("simulation_mode"),
                "program_code": event.get("program_code"),
                "api_code": event.get("api_code"),
                "consumer_code": event.get("consumer_code"),
                "producer_code": event.get("producer_code"),
                "analysis_level": event.get("analysis_level"),
                "anomaly_family": event.get("anomaly_family"),
                "anomaly_scope": event.get("anomaly_scope"),
                "anomaly_origin": event.get("anomaly_origin"),
                "anomaly_correlation_id": event.get("anomaly_correlation_id"),
                "scenario_step": event.get("scenario_step"),
                "scenario_total_steps": event.get("scenario_total_steps"),
                "anomaly_indicators": event.get("anomaly_indicators"),
                "anomaly_impacts": event.get("anomaly_impacts"),
                "latency_ms": event.get("latency_ms"),
                "sla_latency_ms": event.get("sla_latency_ms"),
                "latency_ratio": event.get("latency_ratio"),
                "traffic_ratio": event.get("traffic_ratio"),
                "expected_calls_per_minute": event.get("expected_calls_per_minute"),
                "simulated_calls_per_minute": event.get("simulated_calls_per_minute"),
                "ingestion_delay_ms": event.get("ingestion_delay_ms"),
                "status_code": event.get("status_code"),
                "success": event.get("success"),
                "error_type": event.get("error_type"),
                "source_ip": event.get("source_ip"),
                "api_criticality": event.get("api_criticality"),
                "producer_criticality": event.get("producer_criticality"),
                "consumer_criticality": event.get("consumer_criticality"),
                "flow_criticality": event.get("flow_criticality"),
                "model": anomaly.get("model"),
                "secondary_anomalies": anomaly.get("secondary_anomalies", []),
            },
            "detected_at": event.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _select_primary(anomalies: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        if not anomalies:
            return None, []

        ordered = sorted(
            anomalies,
            key=lambda item: (
                ANOMALY_PRIORITY.get(item["detected_anomaly_type"], 100),
                0 if item.get("analysis_type") == "realtime" else 1,
                -float(item.get("confidence") or 0),
            ),
        )
        return ordered[0], ordered[1:]

    @staticmethod
    def _deduplicate(anomalies: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[tuple[str, str]] = set()
        unique: list[dict[str, Any]] = []
        for anomaly in anomalies:
            key = (anomaly["detected_anomaly_type"], anomaly.get("analysis_type", "realtime"))
            if key not in seen:
                seen.add(key)
                unique.append(anomaly)
        return unique

    @staticmethod
    def _safe_uuid(value: Any) -> str | None:
        if not value:
            return None
        return str(value)
