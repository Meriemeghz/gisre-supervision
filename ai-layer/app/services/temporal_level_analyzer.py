from __future__ import annotations

import logging
from typing import Any

from app.ai_models.temporal_level import (
    TemporalGRUSequenceModel,
    TemporalLSTMSequenceModel,
    TemporalRulesEngineModel,
    TemporalTranADModel,
)
from app.core.database import Database

logger = logging.getLogger(__name__)


class TemporalLevelAnalyzer:
    """Analyze a 15-minute sequence for temporal behavior changes."""

    window = "15m"
    minimum_window_events = 6

    def __init__(self, database: Database) -> None:
        self.database = database
        self.active_model = TemporalRulesEngineModel()
        self.gru_model = TemporalGRUSequenceModel()
        self.gru_model.load()
        self.experimental_models = [TemporalLSTMSequenceModel(), TemporalTranADModel()]
        for model in self.experimental_models:
            model.load()
        self.models = {
            self.active_model.model_id: self.active_model,
            self.gru_model.model_id: self.gru_model,
            **{model.model_id: model for model in self.experimental_models},
        }
        self.compatible_models = [
            "temporal_rules_engine",
            "temporal_gru_sequence",
            "temporal_lstm_sequence",
            "temporal_tranad",
        ]

    def analyze(self, event: dict[str, Any], model_id: str | None = None) -> list[dict[str, Any]]:
        return self.analyze_contract(event, model_id=model_id).get("anomalies") or []

    def analyze_contract(
        self,
        event: dict[str, Any],
        model_id: str | None = None,
    ) -> dict[str, Any]:
        if event.get("event_type") != "api_call":
            return self._unavailable("Temporal-Level analysis requires an api_call event")

        context = self._context(event)
        if context is None:
            return self._unavailable("Temporal context is unavailable")

        stats = self._normalize_stats(self._temporal_stats(*context))
        if int(stats.get("event_count") or 0) < self.minimum_window_events:
            return self._unavailable("Insufficient temporal window data", stats)

        model = self.models.get(model_id or self.active_model.model_id)
        if model is None:
            return self._unavailable("No active Temporal-Level model configured", stats)

        if isinstance(model, TemporalRulesEngineModel):
            detections = model.detect(event, stats)
            anomalies = [
                self._to_engine_anomaly(detection, stats, model)
                for detection in detections
            ]
        elif not model.is_trained:
            return self._unavailable("The selected Temporal-Level model is not trained", stats)
        else:
            prediction = model.predict(
                {
                    **event,
                    "temporal_stats": stats,
                    "temporal_sequence": self._recent_sequence(*context),
                }
            )
            anomalies = (
                [self._to_engine_anomaly(prediction, stats, model)]
                if prediction.get("anomaly_detected")
                else []
            )

        if anomalies:
            logger.info(
                "[AI-TEMPORAL] anomalies detected count=%s flow=%s",
                len(anomalies),
                event.get("flow_code"),
            )

        return {
            "status": "success",
            "executed": True,
            "reason": "Temporal window analyzed successfully",
            "metrics": stats,
            "model": model.get_metadata(),
            "anomalies": anomalies,
        }

    def metadata(self) -> dict[str, Any]:
        return {
            "analysis_level": "temporal",
            "active_model": self.active_model.get_metadata(),
            "compatible_models": self.compatible_models,
            "window": self.window,
        }

    @staticmethod
    def _context(event: dict[str, Any]) -> tuple[str, str] | None:
        for column, field in (
            ("flow_code", "flow_code"),
            ("api_code", "api_code"),
            ("producer_code", "producer_code"),
            ("consumer_code", "consumer_code"),
        ):
            value = event.get(field)
            if value:
                return column, str(value)
        return None

    def _temporal_stats(self, context_column: str, context_value: str) -> dict[str, Any]:
        if context_column not in {
            "flow_code",
            "api_code",
            "producer_code",
            "consumer_code",
        }:
            return {}

        return self.database.fetch_one(
            f"""
            WITH sequence AS (
                SELECT
                    called_at,
                    latency_ms,
                    status_code,
                    success,
                    is_sla_breach,
                    anomaly_type,
                    consumer_code,
                    producer_code,
                    COALESCE(ingestion_delay_ms, 0) AS ingestion_delay_ms,
                    CASE
                        WHEN called_at >= NOW() - INTERVAL '5 minutes' THEN 'current'
                        ELSE 'previous'
                    END AS period,
                    LAG(success) OVER (ORDER BY called_at) AS previous_success,
                    LAG(is_sla_breach) OVER (ORDER BY called_at) AS previous_sla
                FROM api_calls
                WHERE {context_column} = %s
                  AND called_at >= NOW() - INTERVAL '15 minutes'
            ),
            aggregate_stats AS (
                SELECT
                    COUNT(*)::int AS event_count,
                    COUNT(*) FILTER (
                        WHERE COALESCE(anomaly_type, 'NORMAL') NOT IN ('NORMAL', 'FLOW_NORMAL')
                           OR success = false
                           OR status_code >= 400
                           OR is_sla_breach = true
                    )::int AS anomaly_count,
                    AVG(latency_ms)::float AS avg_latency_ms,
                    AVG(latency_ms) FILTER (WHERE period = 'current')::float AS current_avg_latency,
                    AVG(latency_ms) FILTER (WHERE period = 'previous')::float AS previous_avg_latency,
                    COUNT(*) FILTER (WHERE period = 'current')::int AS current_count,
                    COUNT(*) FILTER (WHERE period = 'previous')::int AS previous_count,
                    AVG(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)
                        FILTER (WHERE period = 'current')::float AS current_error_rate,
                    AVG(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)
                        FILTER (WHERE period = 'previous')::float AS previous_error_rate,
                    AVG(CASE WHEN is_sla_breach = true THEN 1 ELSE 0 END)
                        FILTER (WHERE period = 'current')::float AS current_sla_rate,
                    AVG(CASE WHEN is_sla_breach = true THEN 1 ELSE 0 END)
                        FILTER (WHERE period = 'previous')::float AS previous_sla_rate,
                    COUNT(*) FILTER (
                        WHERE status_code = 504 OR anomaly_type = 'TIMEOUT'
                    )::int AS timeout_count,
                    COUNT(*) FILTER (WHERE success IS DISTINCT FROM previous_success)::int
                        AS availability_transitions,
                    COUNT(*) FILTER (WHERE is_sla_breach IS DISTINCT FROM previous_sla)::int
                        AS sla_status_transitions,
                    AVG(ingestion_delay_ms) FILTER (WHERE period = 'current')::float
                        AS current_ingestion_delay_ms,
                    AVG(ingestion_delay_ms) FILTER (WHERE period = 'previous')::float
                        AS previous_ingestion_delay_ms,
                    COUNT(DISTINCT consumer_code)::int AS consumer_count,
                    COUNT(DISTINCT producer_code)::int AS producer_count,
                    REGR_SLOPE(latency_ms, EXTRACT(EPOCH FROM called_at))::float AS latency_slope,
                    REGR_SLOPE(ingestion_delay_ms, EXTRACT(EPOCH FROM called_at))::float
                        AS ingestion_delay_slope
                FROM sequence
            ),
            anomaly_counts AS (
                SELECT anomaly_type, COUNT(*)::int AS occurrence_count
                FROM sequence
                WHERE COALESCE(anomaly_type, 'NORMAL') NOT IN ('NORMAL', 'FLOW_NORMAL')
                GROUP BY anomaly_type
                ORDER BY occurrence_count DESC, anomaly_type
                LIMIT 1
            ),
            consumer_profile AS (
                SELECT
                    COALESCE(
                        MAX(consumer_calls) FILTER (WHERE period = 'current')
                        / NULLIF((SELECT current_count FROM aggregate_stats), 0)::float,
                        0
                    ) AS current_consumer_share,
                    COALESCE(
                        MAX(consumer_calls) FILTER (WHERE period = 'previous')
                        / NULLIF((SELECT previous_count FROM aggregate_stats), 0)::float,
                        0
                    ) AS previous_consumer_share
                FROM (
                    SELECT period, consumer_code, COUNT(*)::float AS consumer_calls
                    FROM sequence
                    GROUP BY period, consumer_code
                ) shares
            )
            SELECT
                aggregate_stats.*,
                anomaly_counts.anomaly_type AS dominant_anomaly_type,
                COALESCE(anomaly_counts.occurrence_count, 0)::int AS repeated_anomaly_count,
                consumer_profile.current_consumer_share,
                consumer_profile.previous_consumer_share
            FROM aggregate_stats
            LEFT JOIN anomaly_counts ON true
            CROSS JOIN consumer_profile
            """,
            (context_value,),
        ) or {}

    def _recent_sequence(
        self,
        context_column: str,
        context_value: str,
    ) -> list[dict[str, Any]]:
        if context_column not in {
            "flow_code",
            "api_code",
            "producer_code",
            "consumer_code",
        }:
            return []
        return self.database.fetch_all(
            f"""
            SELECT flow_id::text, flow_code, called_at::text, latency_ms, sla_latency_ms,
                   status_code, success, is_sla_breach, ingestion_delay_ms
            FROM api_calls
            WHERE {context_column} = %s
              AND called_at >= NOW() - INTERVAL '15 minutes'
            ORDER BY called_at ASC
            LIMIT 60
            """,
            (context_value,),
        )

    @staticmethod
    def _normalize_stats(stats: dict[str, Any]) -> dict[str, Any]:
        event_count = int(stats.get("event_count") or 0)
        anomaly_count = int(stats.get("anomaly_count") or 0)
        repeated_count = int(stats.get("repeated_anomaly_count") or 0)
        current_count = int(stats.get("current_count") or 0)
        previous_count = int(stats.get("previous_count") or 0)
        current_latency = float(stats.get("current_avg_latency") or 0)
        previous_latency = float(stats.get("previous_avg_latency") or 0)
        current_error_rate = float(stats.get("current_error_rate") or 0)
        previous_error_rate = float(stats.get("previous_error_rate") or 0)
        current_sla_rate = float(stats.get("current_sla_rate") or 0)
        previous_sla_rate = float(stats.get("previous_sla_rate") or 0)

        def trend(current: float, previous: float, tolerance: float = 0.05) -> str:
            delta = current - previous
            if delta > tolerance:
                return "increasing"
            if delta < -tolerance:
                return "decreasing"
            return "stable"

        traffic_change_rate = 0.0
        if previous_count:
            traffic_change_rate = (current_count - previous_count) / previous_count
        elif current_count:
            traffic_change_rate = 1.0

        latency_ratio = current_latency / previous_latency if previous_latency > 0 else 1.0
        current_ingestion = float(stats.get("current_ingestion_delay_ms") or 0)
        previous_ingestion = float(stats.get("previous_ingestion_delay_ms") or 0)

        return {
            "event_count": event_count,
            "anomaly_count": anomaly_count,
            "repeated_anomaly_count": repeated_count,
            "avg_latency_ms": round(float(stats.get("avg_latency_ms") or 0), 2),
            "latency_slope": round(float(stats.get("latency_slope") or 0), 4),
            "error_rate_trend": trend(current_error_rate, previous_error_rate),
            "sla_breach_trend": trend(current_sla_rate, previous_sla_rate),
            "dominant_anomaly_type": stats.get("dominant_anomaly_type") or "TEMPORAL_NORMAL",
            "pattern_repetition_score": round(repeated_count / event_count, 4) if event_count else 0.0,
            "current_count": current_count,
            "previous_count": previous_count,
            "current_avg_latency": round(current_latency, 2),
            "previous_avg_latency": round(previous_latency, 2),
            "latency_ratio": round(latency_ratio, 4),
            "current_error_rate": round(current_error_rate, 4),
            "previous_error_rate": round(previous_error_rate, 4),
            "current_sla_rate": round(current_sla_rate, 4),
            "previous_sla_rate": round(previous_sla_rate, 4),
            "timeout_count": int(stats.get("timeout_count") or 0),
            "availability_transitions": int(stats.get("availability_transitions") or 0),
            "sla_status_transitions": int(stats.get("sla_status_transitions") or 0),
            "traffic_change_rate": round(traffic_change_rate, 4),
            "current_ingestion_delay_ms": round(current_ingestion, 2),
            "previous_ingestion_delay_ms": round(previous_ingestion, 2),
            "ingestion_delay_slope": round(float(stats.get("ingestion_delay_slope") or 0), 4),
            "consumer_count": int(stats.get("consumer_count") or 0),
            "producer_count": int(stats.get("producer_count") or 0),
            "current_consumer_share": round(float(stats.get("current_consumer_share") or 0), 4),
            "previous_consumer_share": round(float(stats.get("previous_consumer_share") or 0), 4),
        }

    @classmethod
    def _unavailable(
        cls,
        reason: str,
        metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "status": "unavailable",
            "executed": False,
            "reason": reason,
            "metrics": metrics or {},
            "model": None,
            "anomalies": [],
        }

    @staticmethod
    def _to_engine_anomaly(
        detection: dict[str, Any],
        stats: dict[str, Any],
        model: Any | None = None,
    ) -> dict[str, Any]:
        return {
            "detected_anomaly_type": detection["anomaly_type"],
            "confidence": detection.get("confidence"),
            "explanation": detection.get("explanation"),
            "recommendation": detection.get("recommendation"),
            "risk_score": detection.get("risk_score"),
            "severity": detection.get("severity"),
            "analysis_type": "realtime",
            "analysis_level": "temporal",
            "model": {
                "id": detection.get("model_id") or getattr(model, "model_id", None),
                "name": detection.get("model_name") or getattr(model, "model_name", None),
                "version": getattr(model, "version", None),
                "family": "temporal_level",
                "window": TemporalLevelAnalyzer.window,
                "stats": stats,
                "prediction": detection.get("metadata"),
            },
        }
