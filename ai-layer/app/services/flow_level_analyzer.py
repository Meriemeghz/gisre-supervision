from __future__ import annotations

import logging
from typing import Any

from app.ai_models.flow_level import (
    FlowAutoencoderModel,
    FlowGRUProfileModel,
    FlowKMeansProfileModel,
    FlowRulesEngineModel,
)
from app.core.database import Database

logger = logging.getLogger(__name__)


class FlowLevelAnalyzer:
    """Analyze consumer -> API -> producer behavior as one flow."""

    window = "5m"
    minimum_window_calls = 5

    def __init__(self, database: Database) -> None:
        self.database = database
        self.active_model = FlowRulesEngineModel()
        self.kmeans_model = FlowKMeansProfileModel()
        self.kmeans_model.load()
        self.experimental_models = [FlowAutoencoderModel(), FlowGRUProfileModel()]
        for model in self.experimental_models:
            model.load()
        self.models = {
            self.active_model.model_id: self.active_model,
            self.kmeans_model.model_id: self.kmeans_model,
            **{model.model_id: model for model in self.experimental_models},
        }
        self.compatible_models = [
            "flow_rules_engine",
            "flow_kmeans_profile",
            "flow_autoencoder",
            "flow_gru_profile",
        ]

    def analyze(self, event: dict[str, Any], model_id: str | None = None) -> list[dict[str, Any]]:
        analysis = self.analyze_contract(event, model_id=model_id)
        return analysis.get("anomalies") or []

    def analyze_contract(
        self,
        event: dict[str, Any],
        model_id: str | None = None,
    ) -> dict[str, Any]:
        if event.get("event_type") != "api_call":
            return self._unavailable("Flow-Level analysis requires an api_call event")
        flow_id = event.get("flow_id")
        if not flow_id:
            return self._unavailable("Flow context is unavailable")

        stats = self._flow_stats(str(flow_id), event.get("producer_actor_id"))
        stats["flow_criticality"] = event.get("flow_criticality") or "medium"
        if int(stats.get("total_calls") or 0) < self.minimum_window_calls:
            return self._unavailable("Insufficient flow window data", stats)

        model = self.models.get(model_id or self.active_model.model_id)
        if model is None:
            return self._unavailable("No active Flow-Level model configured", stats)
        if isinstance(model, FlowRulesEngineModel):
            detections = model.detect(event, stats)
            anomalies = [self._to_engine_anomaly(detection, stats, model) for detection in detections]
        elif not model.is_trained:
            return self._unavailable("The selected Flow-Level model is not trained", stats)
        else:
            prediction = model.predict(
                {
                    **event,
                    "flow_profile": stats,
                    "flow_profile_sequence": self._flow_profile_sequence(
                        str(flow_id),
                        event.get("flow_criticality"),
                    ),
                }
            )
            anomalies = [self._to_engine_anomaly(prediction, stats, model)] if prediction.get("anomaly_detected") else []

        if anomalies:
            logger.info("[AI-FLOW] anomalies detected count=%s flow=%s", len(anomalies), event.get("flow_code"))

        return {
            "status": "success",
            "executed": True,
            "reason": "Flow window analyzed successfully",
            "metrics": stats,
            "model": model.get_metadata(),
            "anomalies": anomalies,
        }

    def _flow_stats(self, flow_id: str, producer_actor_id: str | None) -> dict[str, Any]:
        stats = self.database.fetch_one(
            """
            WITH current_window AS (
                SELECT
                    COUNT(*)::int AS total_calls,
                    COUNT(*) FILTER (WHERE success = true AND COALESCE(status_code, 200) < 400)::int AS success_count,
                    COUNT(*) FILTER (WHERE success = false OR status_code >= 400)::int AS error_count,
                    AVG(latency_ms)::float AS avg_latency_ms,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::float AS p95_latency_ms,
                    COUNT(*) FILTER (WHERE is_sla_breach = true)::int AS sla_breach_count,
                    COUNT(*) FILTER (
                        WHERE status_code = 504
                           OR error_type = 'timeout'
                           OR metadata->>'error_type' = 'timeout'
                    )::int AS timeout_count,
                    COUNT(*) FILTER (WHERE status_code >= 500)::int AS server_error_count,
                    COUNT(DISTINCT consumer_actor_id)::int AS consumer_count,
                    COUNT(DISTINCT producer_actor_id)::int AS producer_count
                FROM api_calls
                WHERE flow_id = %s
                  AND called_at >= NOW() - INTERVAL '5 minutes'
            ),
            previous_window AS (
                SELECT
                    COUNT(*)::int AS previous_calls,
                    AVG(latency_ms)::float AS previous_avg_latency_ms
                FROM api_calls
                WHERE flow_id = %s
                  AND called_at >= NOW() - INTERVAL '10 minutes'
                  AND called_at < NOW() - INTERVAL '5 minutes'
            ),
            dominant_consumer AS (
                SELECT COALESCE(MAX(consumer_calls), 0)::int AS dominant_consumer_calls
                FROM (
                    SELECT COUNT(*)::int AS consumer_calls
                    FROM api_calls
                    WHERE flow_id = %s
                      AND called_at >= NOW() - INTERVAL '5 minutes'
                    GROUP BY consumer_actor_id
                ) consumer_volume
            )
            SELECT *
            FROM current_window, previous_window, dominant_consumer
            """,
            (flow_id, flow_id, flow_id),
        ) or {}

        return self._normalize_stats(stats)

    @staticmethod
    def _normalize_stats(stats: dict[str, Any]) -> dict[str, Any]:
        total_calls = int(stats.get("total_calls") or 0)
        success_count = int(stats.get("success_count") or 0)
        error_count = int(stats.get("error_count") or 0)
        sla_breach_count = int(stats.get("sla_breach_count") or 0)
        previous_calls = int(stats.get("previous_calls") or 0)
        avg_latency_ms = float(stats.get("avg_latency_ms") or 0)
        previous_avg_latency_ms = float(stats.get("previous_avg_latency_ms") or 0)

        traffic_change_rate = 0.0
        if previous_calls > 0:
            traffic_change_rate = (total_calls - previous_calls) / previous_calls
        elif total_calls > 0:
            traffic_change_rate = 1.0

        latency_trend = "stable"
        if previous_avg_latency_ms > 0:
            latency_change = (avg_latency_ms - previous_avg_latency_ms) / previous_avg_latency_ms
            if latency_change >= 0.20:
                latency_trend = "increasing"
            elif latency_change <= -0.20:
                latency_trend = "decreasing"

        return {
            "total_calls": total_calls,
            "success_count": success_count,
            "error_count": error_count,
            "success_rate": round(success_count / total_calls, 4) if total_calls else 0.0,
            "error_rate": round(error_count / total_calls, 4) if total_calls else 0.0,
            "avg_latency_ms": round(avg_latency_ms, 2),
            "p95_latency_ms": round(float(stats.get("p95_latency_ms") or 0), 2),
            "sla_breach_count": sla_breach_count,
            "sla_breach_rate": round(sla_breach_count / total_calls, 4) if total_calls else 0.0,
            "timeout_count": int(stats.get("timeout_count") or 0),
            "server_error_count": int(stats.get("server_error_count") or 0),
            "consumer_count": int(stats.get("consumer_count") or 0),
            "producer_count": int(stats.get("producer_count") or 0),
            "consumer_traffic_share": round(
                int(stats.get("dominant_consumer_calls") or 0) / total_calls,
                4,
            )
            if total_calls
            else 0.0,
            "previous_calls": previous_calls,
            "traffic_change_rate": round(traffic_change_rate, 4),
            "previous_avg_latency_ms": round(previous_avg_latency_ms, 2),
            "latency_trend": latency_trend,
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

    def _flow_profile_sequence(self, flow_id: str, flow_criticality: str | None) -> list[dict[str, Any]]:
        rows = self.database.fetch_all(
            """
            SELECT
                date_bin(INTERVAL '5 minutes', called_at, TIMESTAMPTZ '2001-01-01')::text AS window_start,
                COUNT(*)::int AS total_calls,
                AVG(latency_ms / NULLIF(sla_latency_ms, 0))::float AS avg_latency_ratio,
                MAX(latency_ms / NULLIF(sla_latency_ms, 0))::float AS max_latency_ratio,
                AVG(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)::float AS error_rate,
                AVG(CASE WHEN is_sla_breach = true THEN 1 ELSE 0 END)::float AS sla_rate,
                AVG(COALESCE((metadata->>'retry_count')::int, 0))::float AS retry_rate
            FROM api_calls
            WHERE flow_id = %s
              AND called_at >= NOW() - INTERVAL '90 minutes'
              AND latency_ms IS NOT NULL
            GROUP BY window_start
            ORDER BY window_start ASC
            """,
            (flow_id,),
        )
        return [
            {
                **row,
                "flow_criticality": flow_criticality or "medium",
            }
            for row in rows
        ]

    def _producer_slow_flows(self, producer_actor_id: str | None) -> int:
        if not producer_actor_id:
            return 0
        row = self.database.fetch_one(
            """
            SELECT COUNT(*)::int AS slow_flows
            FROM (
                SELECT flow_id
                FROM api_calls
                WHERE producer_actor_id = %s
                  AND called_at >= NOW() - INTERVAL '15 minutes'
                  AND latency_ms IS NOT NULL
                GROUP BY flow_id
                HAVING AVG(latency_ms / NULLIF(sla_latency_ms, 0)) >= 1.2
            ) slow
            """,
            (producer_actor_id,),
        ) or {}
        return int(row.get("slow_flows") or 0)

    @staticmethod
    def _to_engine_anomaly(detection: dict[str, Any], stats: dict[str, Any], model: Any | None = None) -> dict[str, Any]:
        return {
            "detected_anomaly_type": detection["anomaly_type"],
            "confidence": detection.get("confidence"),
            "explanation": detection.get("explanation"),
            "recommendation": detection.get("recommendation"),
            "risk_score": detection.get("risk_score"),
            "severity": detection.get("severity"),
            "analysis_type": "realtime",
            "analysis_level": "flow",
            "model": {
                "id": detection.get("model_id") or getattr(model, "model_id", None),
                "name": detection.get("model_name") or getattr(model, "model_name", None),
                "version": getattr(model, "version", None),
                "family": "flow_level",
                "window": "5m current vs 5m previous",
                "stats": stats,
                "prediction": detection.get("metadata"),
            },
        }
