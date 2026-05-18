from __future__ import annotations

from typing import Any


BASE_SCORES = {
    "SLA_BREACH": 30,
    "HIGH_LATENCY": 40,
    "SERVER_ERROR": 45,
    "TIMEOUT": 50,
    "PROVIDER_UNREACHABLE": 70,
    "ACCESS_DENIED": 40,
    "RATE_LIMIT_EXCEEDED": 45,
    "AUTHENTICATION_ABUSE": 60,
    "DATA_CONSISTENCY_SIGNAL": 50,
    "SUSPICIOUS_ACCESS": 45,
    "LATENCY_SPIKE": 35,
    "LATENCY_DRIFT": 40,
    "HIGH_ERROR_RATE": 55,
    "REPEATED_FAILURES": 60,
    "TRAFFIC_SPIKE": 35,
    "PROVIDER_SLOWDOWN": 65,
    "SECURITY_FAILURE_BURST": 70,
    "ML_ISOLATION_FOREST": 60,
    "ML_ONE_CLASS_SVM": 62,
    "ML_RANDOM_FOREST": 64,
    "ML_KMEANS_CLUSTER": 58,
    "ML_AUTOENCODER": 66,
    "DL_GRU_SEQUENCE": 68,
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
