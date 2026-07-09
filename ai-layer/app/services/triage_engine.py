from __future__ import annotations

from typing import Any

TRIAGE_POLICY_VERSION = "triage_policy_v1"
LEGACY_POLICY_NAME = "default_triage_policy_v1"

TRIAGE_TO_VALIDATION_STATUS = {
    "AUTO_CONFIRMED": "auto_confirmed",
    "PENDING_REVIEW": "pending_review",
    "AUTO_DISMISSED": "auto_dismissed",
}


def _entry(review_policy: str, family: str) -> dict[str, str]:
    return {"review_policy": review_policy, "family": family}


ANOMALY_REVIEW_POLICY: dict[str, dict[str, str]] = {
    # Objective performance / reliability / traffic / traceability signals can be
    # auto-confirmed only when risk, confidence and corroboration are strong.
    "sla_breach": _entry("auto_confirmable", "Performance"),
    "response_time_spike": _entry("auto_confirmable", "Performance"),
    "provider_slowdown": _entry("auto_confirmable", "Performance"),
    "slow_api_endpoint": _entry("auto_confirmable", "Performance"),
    "partial_provider_degradation": _entry("auto_confirmable", "Performance"),
    "high_error_rate": _entry("auto_confirmable", "Reliability"),
    "provider_unreachable": _entry("auto_confirmable", "Reliability"),
    "repeated_retry_pattern": _entry("auto_confirmable", "Reliability"),
    "traffic_spike": _entry("auto_confirmable", "Traffic"),
    "traffic_drop": _entry("auto_confirmable", "Traffic"),
    "unexpected_volume": _entry("auto_confirmable", "Traffic"),
    "silent_flow": _entry("auto_confirmable", "Traffic"),
    "audit_gap": _entry("auto_confirmable", "Traceability"),
    "missing_latency_metric": _entry("auto_confirmable", "Traceability"),
    "duplicate_event": _entry("auto_confirmable", "Traceability"),
    "out_of_order_event": _entry("auto_confirmable", "Traceability"),
    "missing_correlation_id": _entry("auto_confirmable", "Traceability"),

    # Sensitive or context-dependent anomaly families always need a person.
    "authentication_abuse": _entry("human_review_required", "Security"),
    "access_denied": _entry("human_review_required", "Security"),
    "access_denied_anomaly": _entry("human_review_required", "Security"),
    "rate_limit_exceeded": _entry("human_review_required", "Security"),
    "unauthorized_api_attempt": _entry("human_review_required", "Security"),
    "token_failure_pattern": _entry("human_review_required", "Security"),
    "endpoint_enumeration": _entry("human_review_required", "Security"),
    "privilege_misuse": _entry("human_review_required", "Security"),
    "consumer_behavior_shift": _entry("human_review_required", "Behavior"),
    "consumer_profile_drift": _entry("human_review_required", "Behavior"),
    "unusual_api_usage": _entry("human_review_required", "Behavior"),
    "rare_api_access": _entry("human_review_required", "Behavior"),
    "rare_flow_activation": _entry("human_review_required", "Behavior"),
    "workflow_sequence_anomaly": _entry("human_review_required", "Behavior"),
    "cascade_failure": _entry("human_review_required", "Dependencies"),
    "dependent_service_failure": _entry("human_review_required", "Dependencies"),
    "multi_consumer_impact": _entry("human_review_required", "Dependencies"),
    "shared_provider_failure": _entry("human_review_required", "Dependencies"),
    "dependency_hotspot": _entry("human_review_required", "Dependencies"),
    "interoperability_degradation": _entry("human_review_required", "Platform"),
    "metric_collection_failure": _entry("human_review_required", "Platform"),
    "event_pipeline_congestion": _entry("human_review_required", "Platform"),
    "platform_health_degradation": _entry("human_review_required", "Platform"),
    "global_risk_elevation": _entry("human_review_required", "Platform"),
    "hybrid_risk_signal": _entry("human_review_required", "Platform"),

    # Temporal patterns are useful but need operator confirmation for now.
    "latency_drift": _entry("pending_by_default", "Temporal"),
    "gradual_performance_degradation": _entry("pending_by_default", "Temporal"),
    "sla_instability": _entry("pending_by_default", "Temporal"),
    "timeout": _entry("pending_by_default", "Temporal"),
    "timeout_burst": _entry("pending_by_default", "Temporal"),
    "service_flapping": _entry("pending_by_default", "Temporal"),
    "intermittent_failure": _entry("pending_by_default", "Temporal"),
    "delayed_event_ingestion": _entry("pending_by_default", "Temporal"),
}


def normalize_anomaly_type(anomaly_type: Any) -> str:
    return str(anomaly_type or "unknown").strip().lower()


class TriageEngine:
    def decide(
        self,
        *,
        risk_score: int | float | None,
        confidence: int | float | None,
        severity: str | None,
        anomaly_type: str | None,
        event_trace: dict[str, Any] | None = None,
        flow_trace: dict[str, Any] | None = None,
        temporal_trace: dict[str, Any] | None = None,
        graph_trace: dict[str, Any] | None = None,
        repeated_occurrences: int | None = None,
    ) -> dict[str, Any]:
        risk = self._bounded_int(risk_score)
        conf = self._bounded_float(confidence)
        severity_value = str(severity or "low").strip().lower()
        normalized_type = normalize_anomaly_type(anomaly_type)
        policy = ANOMALY_REVIEW_POLICY.get(
            normalized_type, _entry("unknown", "Unknown")
        )
        review_policy = policy["review_policy"]
        family = policy["family"]

        event_anomaly = self._trace_anomaly(event_trace)
        flow_anomaly = self._trace_anomaly(flow_trace)
        executed_anomaly_levels = sum(
            1
            for trace in (event_trace, flow_trace, temporal_trace, graph_trace)
            if self._trace_executed(trace) and self._trace_anomaly(trace)
        )
        multi_level_agreement = executed_anomaly_levels >= 2
        no_detected_anomaly = executed_anomaly_levels == 0 and normalized_type in {
            "normal",
            "flow_normal",
            "success",
        }

        signals = {
            "anomaly_type": str(anomaly_type or "UNKNOWN"),
            "risk_score": risk,
            "confidence": conf,
            "severity": severity_value,
            "event_anomaly": event_anomaly,
            "flow_anomaly": flow_anomaly,
            "multi_level_agreement": multi_level_agreement,
            "repeated_occurrences": repeated_occurrences,
            "family": family,
        }

        if no_detected_anomaly and risk < 30 and severity_value == "low":
            return self._decision(
                "AUTO_DISMISSED",
                review_policy,
                False,
                "No anomaly detected and risk is below automatic dismissal threshold",
                signals,
            )

        if review_policy == "human_review_required":
            return self._decision(
                "PENDING_REVIEW",
                review_policy,
                True,
                "Human review required because anomaly family is sensitive or context-dependent",
                signals,
            )

        if review_policy == "pending_by_default":
            return self._decision(
                "PENDING_REVIEW",
                review_policy,
                True,
                "Temporal anomaly requires human review in current policy version",
                signals,
            )

        if review_policy == "auto_confirmable":
            repeated_enough = (
                repeated_occurrences is not None and repeated_occurrences >= 3
            )
            can_auto_confirm = (
                conf >= 0.95
                and risk >= 70
                and severity_value in {"warning", "high", "critical"}
                and (multi_level_agreement or repeated_enough)
            )
            if can_auto_confirm:
                return self._decision(
                    "AUTO_CONFIRMED",
                    review_policy,
                    False,
                    "Auto-confirmable anomaly met confidence, risk, severity and corroboration thresholds",
                    signals,
                )
            return self._decision(
                "PENDING_REVIEW",
                review_policy,
                True,
                "Auto-confirmable anomaly did not meet confidence, risk, severity or corroboration thresholds",
                signals,
            )

        return self._decision(
            "PENDING_REVIEW",
            review_policy,
            True,
            "Unknown anomaly type requires human validation",
            signals,
        )

    def validation_status(self, decision: dict[str, Any]) -> str:
        return TRIAGE_TO_VALIDATION_STATUS.get(
            str(decision.get("status") or "PENDING_REVIEW"),
            "pending_review",
        )

    def _decision(
        self,
        status: str,
        review_policy: str,
        requires_human_review: bool,
        reason: str,
        signals: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "status": status,
            "review_policy": review_policy,
            "requires_human_review": requires_human_review,
            "reason": reason,
            "policy": LEGACY_POLICY_NAME,
            "policy_version": TRIAGE_POLICY_VERSION,
            "signals": signals,
        }

    @staticmethod
    def _bounded_int(value: int | float | None) -> int:
        try:
            return max(0, min(100, int(round(float(value or 0)))))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _bounded_float(value: int | float | None) -> float:
        try:
            return max(0.0, min(1.0, float(value or 0.0)))
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _trace_executed(trace: dict[str, Any] | None) -> bool:
        return bool(trace and trace.get("executed") is True)

    @staticmethod
    def _trace_anomaly(trace: dict[str, Any] | None) -> bool:
        return bool(trace and trace.get("anomaly_detected") is True)
