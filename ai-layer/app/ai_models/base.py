from __future__ import annotations

import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any


class BaseAIModel(ABC):
    model_id = "base"
    model_name = "Base AI Model"
    model_type = "base"
    family = "base"
    status = "experimental"
    version = "0.1.0"
    objective = "Common GISRE AI model interface."
    anomaly_types: list[str] = []
    supported_analysis_levels: list[str] = []
    is_mock = True

    def __init__(self, model_dir: str | Path = "/app/models") -> None:
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.is_trained = False

    @abstractmethod
    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def evaluate(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        sample_count = len(records or [])
        return {
            "model_id": self.model_id,
            "sample_count": sample_count,
            "status": "evaluated" if sample_count else "no_data",
            "metrics": self.default_metrics(),
        }

    def save(self) -> dict[str, Any]:
        path = self.model_dir / f"{self.model_id}.metadata.json"
        path.write_text(json.dumps(self.get_metadata(), indent=2), encoding="utf-8")
        return {"model_id": self.model_id, "saved": True, "path": str(path)}

    def load(self) -> dict[str, Any]:
        path = self.model_dir / f"{self.model_id}.metadata.json"
        self.is_trained = path.exists()
        return {"model_id": self.model_id, "loaded": self.is_trained, "path": str(path)}

    def get_metadata(self) -> dict[str, Any]:
        return {
            "id": self.model_id,
            "name": self.model_name,
            "type": self.model_type,
            "family": self.family,
            "status": self.status,
            "version": self.version,
            "objective": self.objective,
            "anomaly_types": self.anomaly_types,
            "supported_analysis_levels": self.supported_analysis_levels,
            "is_mock": self.is_mock,
            "is_trained": self.is_trained,
            "functions": ["train", "predict", "evaluate", "save", "load", "get_metadata"],
        }

    def default_prediction(self, record: dict[str, Any], anomaly_detected: bool, anomaly_type: str, score: float, explanation: str) -> dict[str, Any]:
        risk_score = self._risk_score(score)
        return {
            "anomaly_detected": anomaly_detected,
            "anomaly_type": anomaly_type if anomaly_detected else "NORMAL",
            "anomaly_score": round(score, 4),
            "risk_score": risk_score,
            "severity": self._severity(risk_score),
            "confidence": round(min(0.98, max(0.5, score)), 4) if anomaly_detected else 0.72,
            "explanation": explanation,
            "recommendation": self._recommendation(anomaly_type),
            "model_id": self.model_id,
            "model_name": self.model_name,
        }

    def default_metrics(self) -> dict[str, Any]:
        if self.model_type == "supervised":
            return {"accuracy": 0.924, "precision": 0.91, "recall": 0.89, "f1_score": 0.9}
        if self.model_type == "unsupervised":
            return {"anomaly_rate": 0.035, "contamination_rate": 0.04, "stability": 0.86}
        if self.model_type == "deep_learning":
            return {"loss": 0.041, "validation_loss": 0.052, "reconstruction_error": 0.12}
        return {"coverage": 0.8, "stability": 0.78}

    @staticmethod
    def features_from_record(record: dict[str, Any]) -> dict[str, float]:
        latency_ms = float(record.get("latency_ms") or 0)
        sla_latency_ms = float(record.get("sla_latency_ms") or record.get("sla_ms") or 300)
        status_code = float(record.get("status_code") or 200)
        success = 1.0 if record.get("success", True) else 0.0
        latency_ratio = latency_ms / sla_latency_ms if sla_latency_ms else 0.0
        return {
            "latency_ms": latency_ms,
            "sla_latency_ms": sla_latency_ms,
            "latency_ratio": latency_ratio,
            "status_code": status_code,
            "success": success,
            "is_error": 1.0 if status_code >= 400 or success == 0.0 else 0.0,
        }

    @staticmethod
    def _risk_score(score: float) -> int:
        return max(0, min(100, int(round(score * 100))))

    @staticmethod
    def _severity(score: int) -> str:
        if score <= 30:
            return "low"
        if score <= 60:
            return "medium"
        if score <= 80:
            return "high"
        return "critical"

    @staticmethod
    def _recommendation(anomaly_type: str) -> str:
        recommendations = {
            "TIMEOUT": "Verifier le provider et la configuration des timeouts.",
            "SERVER_ERROR": "Analyser les logs du service producteur.",
            "ACCESS_DENIED": "Controler les acces, jetons et autorisations.",
            "SLA_BREACH": "Verifier la charge, le reseau et les ressources.",
            "RESPONSE_TIME_SPIKE": "Verifier la charge, le reseau et les ressources.",
            "RATE_LIMIT_EXCEEDED": "Verifier les quotas et la configuration de rate limiting.",
            "MISSING_CORRELATION_ID": "Verifier la propagation des identifiants de correlation.",
            "MISSING_LATENCY_METRIC": "Verifier l'instrumentation de latence.",
            "DUPLICATE_EVENT": "Verifier l'idempotence et le traitement des evenements.",
            "CORRUPTED_EVENT_PAYLOAD": "Verifier le schema et la serialisation de l'evenement.",
            "LATENCY_DRIFT": "Analyser l'evolution recente des latences.",
            "GRADUAL_PERFORMANCE_DEGRADATION": "Verifier les ressources et la tendance de performance.",
            "SLA_INSTABILITY": "Identifier les periodes de depassement SLA.",
            "TIMEOUT_BURST": "Verifier les timeouts concentres et la disponibilite du producteur.",
            "TRAFFIC_SPIKE": "Verifier la legitimite du volume anormal.",
            "TRAFFIC_DROP": "Verifier une rupture de consommation ou de publication.",
            "BUSINESS_HOURS_DEVIATION": "Verifier la legitimite de l'activite hors horaires.",
            "INTERMITTENT_FAILURE": "Analyser les echecs intermittents et les retries.",
            "SERVICE_FLAPPING": "Verifier la disponibilite intermittente du service.",
            "STREAM_PROCESSING_DELAY": "Verifier la chaine d'ingestion et le traitement Kafka.",
            "HIGH_ERROR_RATE": "Investiguer les erreurs recentes du flow.",
            "SLOW_API_ENDPOINT": "Identifier l'endpoint lent et comparer avec le SLA.",
            "PARTIAL_PROVIDER_DEGRADATION": "Verifier les flows impactes par le producteur.",
            "SILENT_FLOW": "Verifier si le flow a cesse d'emettre.",
            "TRAFFIC_ASYMMETRY": "Comparer le volume du flow a son profil attendu.",
            "REPEATED_RETRY_PATTERN": "Analyser les retries et l'idempotence.",
            "CRITICAL_FLOW_INSTABILITY": "Prioriser le flow critique et escalader.",
            "UNEXPECTED_VOLUME": "Verifier la source du volume anormal.",
            "QUEUE_PROCESSING_DELAY": "Verifier les files et workers applicatifs.",
            "API_UNDERUSE": "Verifier une baisse de consommation inattendue.",
            "FLOW_SLA_DEGRADATION": "Verifier les appels en depassement SLA et les ressources du flow.",
            "FLOW_LATENCY_DRIFT": "Analyser la progression des latences et comparer les fenetres recentes.",
            "FLOW_ERROR_RATE_SPIKE": "Analyser les erreurs recentes du flow et les logs du producteur.",
            "FLOW_TRAFFIC_DROP": "Verifier une rupture de consommation, de publication ou de routage.",
            "FLOW_TRAFFIC_SPIKE": "Verifier la legitimite de la hausse de trafic et la capacite du service.",
            "FLOW_INTERMITTENT_FAILURES": "Analyser les echecs disperses, les timeouts et les retries du flow.",
            "FLOW_PROVIDER_DEGRADATION": "Verifier le producteur critique et les erreurs serveur affectant le flow.",
            "FLOW_CONSUMER_ABUSE": "Verifier le consommateur dominant, ses quotas et son rythme d'appels.",
            "FLOW_HEALTH_DEGRADATION": "Prioriser le diagnostic du flow car plusieurs indicateurs sont degrades.",
            "CASCADE_FAILURE": "Identifier la dependance amont et les flows propages.",
            "DEPENDENT_SERVICE_FAILURE": "Verifier le service dependant en echec.",
            "MULTI_CONSUMER_IMPACT": "Identifier les consommateurs impactes.",
            "SHARED_PROVIDER_FAILURE": "Verifier le producteur partage.",
            "DEPENDENCY_HOTSPOT": "Evaluer la charge de la dependance centrale.",
            "CROSS_FLOW_PROPAGATION": "Correller les flows impactes.",
            "INTEROPERABILITY_DEGRADATION": "Verifier les contrats et SLA entre systemes.",
            "SYNCHRONIZED_FAILURE_PATTERN": "Analyser les echecs synchronises.",
            "DEPENDENCY_CHAIN_LATENCY": "Tracer la chaine de dependances lente.",
            "CRITICAL_PROVIDER_INSTABILITY": "Escalader le producteur critique.",
            "GRAPH_CONNECTIVITY_ANOMALY": "Verifier les relations du graphe de dependances.",
        }
        return recommendations.get(anomaly_type, "Analyser le contexte technique et verifier le flux concerne.")
