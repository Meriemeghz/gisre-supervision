from __future__ import annotations

from typing import Any

from app.ai_models.base import BaseAIModel


class ThresholdModel(BaseAIModel):
    threshold = 0.7
    default_anomaly_type = "AI_ANOMALY"

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        self.is_trained = True
        self.save()
        return {
            "model_id": self.model_id,
            "status": "trained",
            "sample_count": len(records or []),
            "mock_training": self.is_mock,
        }

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        features = self.features_from_record(record)
        score = self.score_record(features, record)
        anomaly_detected = score >= self.threshold
        anomaly_type = self.resolve_anomaly_type(features, record)
        return self.default_prediction(
            record,
            anomaly_detected,
            anomaly_type,
            score,
            self.explanation(anomaly_type, score),
        )

    def score_record(self, features: dict[str, float], record: dict[str, Any]) -> float:
        score = 0.0
        score = max(score, min(1.0, features["latency_ratio"] / 2.0))
        if features["status_code"] >= 500:
            score = max(score, 0.85)
        elif features["status_code"] >= 400:
            score = max(score, 0.7)
        if record.get("is_sla_breach"):
            score = max(score, 0.65)
        return score

    def resolve_anomaly_type(self, features: dict[str, float], record: dict[str, Any]) -> str:
        status_code = int(features["status_code"])
        error_type = record.get("error_type")
        if error_type == "timeout" or status_code == 504:
            return "TIMEOUT"
        if status_code == 502:
            return "PROVIDER_UNREACHABLE"
        if status_code >= 500:
            return "SERVER_ERROR"
        if status_code == 403 or error_type == "access_denied":
            return "ACCESS_DENIED"
        if record.get("is_sla_breach") or features["latency_ratio"] >= 1.0:
            return "SLA_BREACH"
        return self.default_anomaly_type

    def explanation(self, anomaly_type: str, score: float) -> str:
        return f"{self.model_name} signale {anomaly_type} avec un score {score:.2f}."


class MockExperimentalModel(ThresholdModel):
    is_mock = True
    threshold = 0.75

    def explanation(self, anomaly_type: str, score: float) -> str:
        return f"{self.model_name} est experimental/mocke; il fournit un signal preliminaire {anomaly_type}."
