from __future__ import annotations

import logging
from typing import Any

from app.ai_models.event_level import EventLevelRandomForestModel, EventLevelRulesEngineModel

logger = logging.getLogger(__name__)


class EventLevelAnalyzer:
    """Analyze one Kafka event at a time with Event-Level compatible detectors."""

    def __init__(self) -> None:
        self.active_model = EventLevelRulesEngineModel()
        self.random_forest_model = EventLevelRandomForestModel()
        self.random_forest_model.load()
        self.compatible_models = [
            "event_rules_engine",
            "event_random_forest",
            "event_isolation_forest",
            "event_lof",
            "event_autoencoder_mlp",
        ]

    def analyze(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        detections = self.active_model.detect(event)
        anomalies = [self._to_engine_anomaly(detection) for detection in detections]

        if self.random_forest_model.is_trained:
            prediction = self.random_forest_model.predict(event)
            if prediction.get("anomaly_detected"):
                anomalies.append(self._to_engine_anomaly(prediction))

        if anomalies:
            logger.info(
                "[AI-EVENT] anomalies detected count=%s flow=%s model=%s",
                len(anomalies),
                event.get("flow_code"),
                self.active_model.model_id,
            )

        return anomalies

    def metadata(self) -> dict[str, Any]:
        return {
            "analysis_level": "event",
            "active_model": self.active_model.get_metadata(),
            "compatible_models": self.compatible_models,
        }

    @staticmethod
    def _to_engine_anomaly(detection: dict[str, Any]) -> dict[str, Any]:
        return {
            "detected_anomaly_type": detection["anomaly_type"],
            "confidence": detection.get("confidence"),
            "explanation": detection.get("explanation"),
            "analysis_type": "realtime",
            "analysis_level": "event",
            "model": {
                "id": detection.get("model_id"),
                "name": detection.get("model_name"),
                "family": "event_level",
            },
        }
