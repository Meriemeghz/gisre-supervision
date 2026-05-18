from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class RealtimeAnalyzer:
    def analyze(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        anomalies: list[dict[str, Any]] = []

        latency_ratio = event.get("latency_ratio")
        error_type = event.get("error_type")
        status_code = event.get("status_code")
        action = event.get("action")
        outcome = event.get("outcome")

        if event.get("is_sla_breach"):
            anomalies.append(self._anomaly("SLA_BREACH", 0.88, "The event breached the configured SLA latency."))

        if latency_ratio is not None and latency_ratio >= 1.25:
            anomalies.append(self._anomaly("HIGH_LATENCY", 0.84, "Latency is significantly above the SLA target."))

        if event.get("is_server_error"):
            anomaly_type = "PROVIDER_UNREACHABLE" if status_code in {502, 503} else "SERVER_ERROR"
            anomalies.append(self._anomaly(anomaly_type, 0.86, f"HTTP {status_code} indicates a producer-side failure."))

        if event.get("is_timeout"):
            anomalies.append(self._anomaly("TIMEOUT", 0.9, "The request ended with a timeout signal."))

        if event.get("is_security_failure"):
            anomalies.append(self._anomaly("ACCESS_DENIED", 0.85, "The event indicates denied or forbidden access."))

        if status_code == 429:
            anomalies.append(self._anomaly("ACCESS_DENIED", 0.78, "The event exceeded an API rate limit."))

        if (
            error_type == "metadata_inconsistency"
            or action == "metadata_inconsistency"
            or str(event.get("error_code") or "").endswith("_signal")
        ):
            anomalies.append(self._anomaly("DATA_CONSISTENCY_SIGNAL", 0.82, "Technical metadata is inconsistent for the event."))

        if action in {"access_denied", "login_failure"} and outcome in {"failure", "denied"}:
            anomalies.append(self._anomaly("AUTHENTICATION_ABUSE", 0.78, "Security-related failures suggest abnormal authentication behavior."))

        if event.get("source_ip") and event.get("is_security_failure") and event.get("api_criticality") in {"high", "critical"}:
            anomalies.append(self._anomaly("SUSPICIOUS_ACCESS", 0.74, "Access failure targets a sensitive API or actor."))

        if anomalies:
            logger.info("[AI-REALTIME] anomalies detected count=%s flow=%s", len(anomalies), event.get("flow_code"))

        return anomalies

    @staticmethod
    def _anomaly(anomaly_type: str, confidence: float, explanation: str) -> dict[str, Any]:
        return {
            "detected_anomaly_type": anomaly_type,
            "confidence": confidence,
            "explanation": explanation,
            "analysis_type": "realtime",
        }
