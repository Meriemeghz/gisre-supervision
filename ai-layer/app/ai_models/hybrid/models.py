from __future__ import annotations

from typing import Any

from app.ai_models.simple_models import ThresholdModel


class RulesEngineModel(ThresholdModel):
    model_id = "rules_engine"
    model_name = "Rules Engine"
    model_type = "rules"
    family = "hybrid"
    status = "active"
    version = "1.0.0"
    objective = "Appliquer les regles deterministes metier et SLA."
    anomaly_types = ["SLA_BREACH", "SERVER_ERROR", "TIMEOUT", "ACCESS_DENIED"]
    is_mock = False
    threshold = 0.5
    default_anomaly_type = "RULES_ENGINE_SIGNAL"


class EnsembleModel(ThresholdModel):
    model_id = "ensemble_model"
    model_name = "Ensemble Model"
    model_type = "hybrid"
    family = "hybrid"
    status = "experimental"
    version = "0.2.0"
    objective = "Fusionner plusieurs signaux IA en decision unique."
    anomaly_types = ["ENSEMBLE_ANOMALY", "PROVIDER_SLOWDOWN", "SECURITY_FAILURE_BURST"]
    is_mock = True
    threshold = 0.72
    default_anomaly_type = "ENSEMBLE_ANOMALY"


class HybridRiskScoringModel(ThresholdModel):
    model_id = "hybrid_risk_scoring"
    model_name = "Hybrid Risk Scoring"
    model_type = "hybrid"
    family = "hybrid"
    status = "active"
    version = "1.0.0"
    objective = "Combiner score IA, criticite, SLA et securite en risque final."
    anomaly_types = ["HYBRID_RISK_SIGNAL", "SLA_BREACH", "SECURITY_FAILURE_BURST"]
    is_mock = False
    threshold = 0.55
    default_anomaly_type = "HYBRID_RISK_SIGNAL"

    def score_record(self, features: dict[str, float], record: dict[str, Any]) -> float:
        score = super().score_record(features, record)
        criticality = record.get("api_criticality") or record.get("producer_criticality")
        if criticality == "critical":
            score = min(1.0, score + 0.2)
        elif criticality == "high":
            score = min(1.0, score + 0.1)
        return score
