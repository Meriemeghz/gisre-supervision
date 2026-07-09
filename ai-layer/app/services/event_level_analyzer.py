from __future__ import annotations

import logging
from typing import Any

from app.ai_models.event_level import (
    EventLevelAutoencoderMLPModel,
    EventLevelIsolationForestModel,
    EventLevelLocalOutlierFactorModel,
    EventLevelRandomForestModel,
    EventLevelRulesEngineModel,
)

logger = logging.getLogger(__name__)


class EventLevelAnalyzer:
    """Analyze one Kafka event at a time with Event-Level compatible detectors."""

    def __init__(self) -> None:
        self.active_model = EventLevelRulesEngineModel()
        self.secondary_models = [
            EventLevelRandomForestModel(),
            EventLevelIsolationForestModel(),
            EventLevelLocalOutlierFactorModel(),
            EventLevelAutoencoderMLPModel(),
        ]
        for model in self.secondary_models:
            model.load()
        self.models = {
            self.active_model.model_id: self.active_model,
            **{model.model_id: model for model in self.secondary_models},
        }
        self.compatible_models = [
            "event_rules_engine",
            "event_random_forest",
            "event_isolation_forest",
            "event_lof",
            "event_autoencoder_mlp",
        ]

    def analyze(self, event: dict[str, Any], model_id: str | None = None) -> list[dict[str, Any]]:
        model = self.models.get(model_id or self.active_model.model_id)
        if model is None:
            return []

        if isinstance(model, EventLevelRulesEngineModel):
            detections = model.detect(event)
            anomalies = [self._to_engine_anomaly(detection, model) for detection in detections]
        elif not model.is_trained:
            anomalies = []
        else:
            prediction = model.predict(event)
            anomalies = [self._to_engine_anomaly(prediction, model)] if prediction.get("anomaly_detected") else []

        if anomalies:
            logger.info(
                "[AI-EVENT] anomalies detected count=%s flow=%s models=%s",
                len(anomalies),
                event.get("flow_code"),
                [anomaly.get("model", {}).get("id") for anomaly in anomalies],
            )

        return anomalies

    def metadata(self) -> dict[str, Any]:
        return {
            "analysis_level": "event",
            "active_model": self.active_model.get_metadata(),
            "compatible_models": self.compatible_models,
        }

    @staticmethod
    def _to_engine_anomaly(detection: dict[str, Any], model: Any | None = None) -> dict[str, Any]:
        return {
            "detected_anomaly_type": detection["anomaly_type"],
            "confidence": detection.get("confidence"),
            "explanation": detection.get("explanation"),
            "analysis_type": "realtime",
            "analysis_level": "event",
            "model": {
                "id": detection.get("model_id") or getattr(model, "model_id", None),
                "name": detection.get("model_name") or getattr(model, "model_name", None),
                "version": getattr(model, "version", None),
                "family": "event_level",
            },
        }
