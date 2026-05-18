from __future__ import annotations

import logging
from typing import Any

from app.core.database import Database

logger = logging.getLogger(__name__)


class HistoricalAnalyzer:
    def __init__(self, database: Database) -> None:
        self.database = database

    def analyze(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        flow_id = event.get("flow_id")
        api_id = event.get("api_id")
        producer_actor_id = event.get("producer_actor_id")
        if not flow_id:
            return []

        anomalies: list[dict[str, Any]] = []
        flow_stats = self._flow_stats(flow_id)
        previous_stats = self._previous_flow_stats(flow_id)

        total_calls = int(flow_stats.get("total_calls") or 0)
        error_rate = float(flow_stats.get("error_rate") or 0)
        avg_latency = float(flow_stats.get("avg_latency") or 0)
        max_latency = float(flow_stats.get("max_latency") or 0)
        previous_avg_latency = float(previous_stats.get("avg_latency") or 0)
        previous_total_calls = int(previous_stats.get("total_calls") or 0)
        current_latency = event.get("latency_ms") or 0

        if total_calls >= 10 and current_latency > avg_latency * 1.8:
            anomalies.append(self._anomaly("LATENCY_SPIKE", 0.78, "Current latency is much higher than the recent flow average."))

        if previous_avg_latency > 0 and avg_latency > previous_avg_latency * 1.35:
            anomalies.append(self._anomaly("LATENCY_DRIFT", 0.76, "Recent average latency is drifting upward compared with the previous window."))

        if total_calls >= 10 and error_rate >= 0.15:
            anomalies.append(self._anomaly("HIGH_ERROR_RATE", 0.82, "The recent error rate for this flow is above the expected threshold."))

        if int(flow_stats.get("failure_count") or 0) >= 5:
            anomalies.append(self._anomaly("REPEATED_FAILURES", 0.8, "The flow has repeated failures in the recent window."))

        expected_calls = event.get("expected_calls_per_minute")
        if expected_calls:
            expected_window_calls = int(expected_calls) * 15
            spike_threshold = max(expected_window_calls * 2, previous_total_calls * 2, 30)
            if total_calls >= spike_threshold:
                anomalies.append(self._anomaly("TRAFFIC_SPIKE", 0.73, "Recent traffic is much higher than the expected volume."))

        if producer_actor_id and self._producer_slowdown(producer_actor_id):
            anomalies.append(self._anomaly("PROVIDER_SLOWDOWN", 0.81, "Several flows for the same producer show degraded latency."))

        if api_id and self._security_failure_burst(api_id):
            anomalies.append(self._anomaly("SECURITY_FAILURE_BURST", 0.85, "Security failures are concentrated in the recent audit history."))

        if anomalies:
            logger.info("[AI-HISTORICAL] anomalies detected count=%s flow=%s", len(anomalies), event.get("flow_code"))

        return anomalies

    def _flow_stats(self, flow_id: str) -> dict[str, Any]:
        return self.database.fetch_one(
            """
            SELECT
                COUNT(*)::int AS total_calls,
                AVG(latency_ms)::float AS avg_latency,
                MAX(latency_ms)::float AS max_latency,
                AVG(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)::float AS error_rate,
                SUM(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)::int AS failure_count
            FROM api_calls
            WHERE flow_id = %s
              AND called_at >= NOW() - INTERVAL '15 minutes'
            """,
            (flow_id,),
        ) or {}

    def _previous_flow_stats(self, flow_id: str) -> dict[str, Any]:
        return self.database.fetch_one(
            """
            SELECT
                COUNT(*)::int AS total_calls,
                AVG(latency_ms)::float AS avg_latency
            FROM api_calls
            WHERE flow_id = %s
              AND called_at >= NOW() - INTERVAL '30 minutes'
              AND called_at < NOW() - INTERVAL '15 minutes'
            """,
            (flow_id,),
        ) or {}

    def _producer_slowdown(self, producer_actor_id: str) -> bool:
        row = self.database.fetch_one(
            """
            SELECT COUNT(*)::int AS slow_flows
            FROM (
                SELECT f.id
                FROM flows f
                JOIN api_calls ac ON ac.flow_id = f.id
                WHERE f.producer_actor_id = %s
                  AND ac.called_at >= NOW() - INTERVAL '15 minutes'
                GROUP BY f.id, f.sla_latency_ms
                HAVING AVG(ac.latency_ms) > COALESCE(f.sla_latency_ms, 1) * 1.2
            ) slow
            """,
            (producer_actor_id,),
        ) or {}
        return int(row.get("slow_flows") or 0) >= 2

    def _security_failure_burst(self, api_id: str) -> bool:
        row = self.database.fetch_one(
            """
            SELECT COUNT(*)::int AS failures
            FROM audit_events
            WHERE api_id = %s
              AND event_timestamp >= NOW() - INTERVAL '15 minutes'
              AND outcome IN ('failure', 'denied')
            """,
            (api_id,),
        ) or {}
        return int(row.get("failures") or 0) >= 5

    @staticmethod
    def _anomaly(anomaly_type: str, confidence: float, explanation: str) -> dict[str, Any]:
        return {
            "detected_anomaly_type": anomaly_type,
            "confidence": confidence,
            "explanation": explanation,
            "analysis_type": "historical",
        }
