from __future__ import annotations

from typing import Any


BASE_SCORES = {
    "SLA_BREACH": 30,
    "RESPONSE_TIME_SPIKE": 40,
    "SERVER_ERROR": 45,
    "TIMEOUT": 50,
    "PROVIDER_UNREACHABLE": 70,
    "ACCESS_DENIED": 40,
    "RATE_LIMIT_EXCEEDED": 45,
    "MISSING_CORRELATION_ID": 35,
    "MISSING_LATENCY_METRIC": 35,
    "DUPLICATE_EVENT": 40,
    "CORRUPTED_EVENT_PAYLOAD": 50,
    "EVENT_ISOLATION_FOREST_SIGNAL": 55,
    "EVENT_LOF_SIGNAL": 52,
    "EVENT_AUTOENCODER_SIGNAL": 58,
    "LATENCY_SPIKE": 35,
    "LATENCY_DRIFT": 40,
    "GRADUAL_PERFORMANCE_DEGRADATION": 55,
    "SLA_INSTABILITY": 50,
    "TIMEOUT_BURST": 65,
    "TRAFFIC_DROP": 45,
    "BUSINESS_HOURS_DEVIATION": 45,
    "INTERMITTENT_FAILURE": 55,
    "SERVICE_FLAPPING": 60,
    "STREAM_PROCESSING_DELAY": 45,
    "HIGH_ERROR_RATE": 55,
    "REPEATED_FAILURES": 60,
    "TRAFFIC_SPIKE": 35,
    "PROVIDER_SLOWDOWN": 65,
    "SLOW_API_ENDPOINT": 45,
    "PARTIAL_PROVIDER_DEGRADATION": 65,
    "SILENT_FLOW": 50,
    "TRAFFIC_ASYMMETRY": 45,
    "REPEATED_RETRY_PATTERN": 50,
    "RARE_FLOW_ACTIVATION": 35,
    "WORKFLOW_SEQUENCE_ANOMALY": 45,
    "CRITICAL_FLOW_INSTABILITY": 70,
    "UNEXPECTED_VOLUME": 45,
    "QUEUE_PROCESSING_DELAY": 50,
    "ABNORMAL_ERROR_AFTER_DEPLOYMENT": 60,
    "API_UNDERUSE": 35,
    "ML_FLOW_CLUSTER_OUTLIER": 55,
    "DL_FLOW_AUTOENCODER": 58,
    "DL_FLOW_SEQUENCE": 58,
    "FLOW_SLA_DEGRADATION": 60,
    "FLOW_LATENCY_DRIFT": 58,
    "FLOW_ERROR_RATE_SPIKE": 55,
    "FLOW_TRAFFIC_DROP": 45,
    "FLOW_TRAFFIC_SPIKE": 45,
    "FLOW_INTERMITTENT_FAILURES": 55,
    "FLOW_PROVIDER_DEGRADATION": 68,
    "FLOW_CONSUMER_ABUSE": 52,
    "FLOW_HEALTH_DEGRADATION": 72,
    "CASCADE_FAILURE": 85,
    "DEPENDENT_SERVICE_FAILURE": 70,
    "MULTI_CONSUMER_IMPACT": 75,
    "SHARED_PROVIDER_FAILURE": 80,
    "DEPENDENCY_HOTSPOT": 55,
    "CROSS_FLOW_PROPAGATION": 78,
    "INTEROPERABILITY_DEGRADATION": 65,
    "SYNCHRONIZED_FAILURE_PATTERN": 72,
    "DEPENDENCY_CHAIN_LATENCY": 68,
    "CRITICAL_PROVIDER_INSTABILITY": 82,
    "GRAPH_CONNECTIVITY_ANOMALY": 60,
    "GRAPH_GDN_ANOMALY": 65,
    "GRAPH_MTAD_GAT_ANOMALY": 68,
    "GRAPH_TOPOLOGY_ANOMALY": 62,
    "SECURITY_FAILURE_BURST": 70,
    "ML_ISOLATION_FOREST": 60,
    "ML_ONE_CLASS_SVM": 62,
    "ML_RANDOM_FOREST": 64,
    "ML_KMEANS_CLUSTER": 58,
    "ML_AUTOENCODER": 66,
    "DL_GRU_SEQUENCE": 68,
    "latency_drift": 68,
    "gradual_performance_degradation": 78,
    "sla_instability": 65,
    "timeout_burst": 82,
    "service_flapping": 85,
    "intermittent_failure": 68,
    "traffic_spike": 55,
    "traffic_drop": 50,
    "delayed_event_ingestion": 60,
    "consumer_profile_drift": 62,
    "cascade_failure": 85,
    "dependent_service_failure": 70,
    "multi_consumer_impact": 75,
    "shared_provider_failure": 80,
    "dependency_hotspot": 55,
    "interoperability_degradation": 65,
}


class ScoringService:
    def score(self, anomaly: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
        anomaly_type = anomaly["detected_anomaly_type"]
        score = BASE_SCORES.get(anomaly_type, 20) + int(event.get("criticality_weight") or 0)
        score = max(0, min(100, score))

        return {
            **anomaly,
            "risk_score": score,
            "severity": self._severity(score),
        }

    @staticmethod
    def _severity(score: int) -> str:
        if score <= 30:
            return "low"
        if score <= 60:
            return "medium"
        if score <= 80:
            return "high"
        return "critical"
