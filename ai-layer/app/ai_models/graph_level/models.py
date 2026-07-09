from __future__ import annotations

from typing import Any

from app.ai_models.base import BaseAIModel
from app.ai_models.simple_models import MockExperimentalModel


GRAPH_LEVEL_ANOMALIES = [
    "GRAPH_NORMAL",
    "cascade_failure",
    "dependent_service_failure",
    "multi_consumer_impact",
    "shared_provider_failure",
    "dependency_hotspot",
    "interoperability_degradation",
]


class GraphRulesEngineModel(BaseAIModel):
    model_id = "graph_rules_engine"
    model_name = "Graph-Level Rules Engine"
    model_type = "rules"
    family = "graph_level"
    status = "active"
    version = "1.0.0"
    objective = "Detecter les anomalies de dependance entre producteurs, consommateurs, APIs et flows."
    anomaly_types = GRAPH_LEVEL_ANOMALIES
    supported_analysis_levels = ["graph"]
    is_mock = False

    def train(self, records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        self.is_trained = True
        self.save()
        return {"model_id": self.model_id, "status": "ready", "training_required": False, "sample_count": len(records or [])}

    def predict(self, record: dict[str, Any]) -> dict[str, Any]:
        detections = self.detect(record, record.get("graph_stats") or {})
        if detections:
            return detections[0]
        return self.default_prediction(record, False, "NORMAL", 0.0, "Aucune anomalie graph-level detectee.")

    def detect(self, event: dict[str, Any], stats: dict[str, Any]) -> list[dict[str, Any]]:
        detections: list[dict[str, Any]] = []
        impacted_flows = int(stats.get("impacted_flows_count") or stats.get("impacted_flows") or 0)
        impacted_consumers = int(stats.get("impacted_consumers_count") or stats.get("impacted_consumers") or 0)
        impacted_apis = int(stats.get("impacted_apis_count") or stats.get("impacted_apis") or 0)
        producer_error_rate = float(stats.get("producer_error_rate") or 0)
        producer_sla_rate = float(stats.get("producer_sla_rate") or 0)
        producer_avg_latency_ratio = float(stats.get("producer_avg_latency_ratio") or 0)
        synchronized_failures = int(stats.get("synchronized_failures") or 0)
        total_provider_calls = int(stats.get("total_provider_calls") or 0)
        producer_criticality = str(event.get("producer_criticality") or "medium")
        shared_provider_score = float(stats.get("shared_provider_score") or 0)
        cascade_risk_score = float(stats.get("cascade_risk_score") or 0)
        dependency_hotspot_score = float(stats.get("dependency_hotspot_score") or 0)

        if impacted_flows >= 3 and (producer_error_rate >= 0.12 or shared_provider_score >= 60):
            detections.append(self._detection("shared_provider_failure", min(0.94, 0.74 + producer_error_rate * 0.45), "Plusieurs flows lies au meme producteur presentent des erreurs."))

        if total_provider_calls >= 10 and producer_error_rate >= 0.25:
            detections.append(self._detection("dependent_service_failure", min(0.93, 0.72 + producer_error_rate * 0.4), "Un service dependant du graphe producteur presente un taux d'echec eleve."))

        if impacted_consumers >= 3 and (producer_error_rate >= 0.10 or producer_sla_rate >= 0.18):
            detections.append(self._detection("multi_consumer_impact", 0.84, "Plusieurs consommateurs sont impactes par la meme dependance producteur."))

        if impacted_flows >= 2 and impacted_apis >= 2 and (producer_sla_rate >= 0.20 or producer_avg_latency_ratio >= 1.45):
            detections.append(self._detection("interoperability_degradation", 0.82, "La qualite d'interoperabilite se degrade entre plusieurs dependances GISRE."))

        if synchronized_failures >= 4:
            detections.append(self._detection("dependent_service_failure", min(0.93, 0.72 + synchronized_failures * 0.03), "Des echecs synchronises apparaissent sur plusieurs dependances."))

        if impacted_flows >= 5 or total_provider_calls >= 200 or dependency_hotspot_score >= 70:
            detections.append(self._detection("dependency_hotspot", 0.76, "Le producteur agit comme hotspot de dependance dans le graphe GISRE."))

        if producer_criticality == "critical" and impacted_flows >= 2 and (producer_error_rate >= 0.08 or producer_sla_rate >= 0.15):
            detections.append(self._detection("shared_provider_failure", 0.88, "Un producteur critique devient instable et impacte plusieurs flows."))

        if impacted_flows >= 3 and (producer_error_rate >= 0.20 or cascade_risk_score >= 75):
            detections.append(self._detection("cascade_failure", 0.90, "Le comportement suggere une cascade d'echecs depuis une dependance partagee."))

        return sorted(self._deduplicate(detections), key=lambda item: item["risk_score"], reverse=True)

    def _detection(self, anomaly_type: str, confidence: float, explanation: str) -> dict[str, Any]:
        return {
            "anomaly_detected": True,
            "anomaly_type": anomaly_type,
            "anomaly_score": round(confidence, 4),
            "risk_score": self._risk_score(confidence),
            "severity": self._severity(self._risk_score(confidence)),
            "confidence": round(confidence, 4),
            "explanation": explanation,
            "recommendation": self._recommendation(anomaly_type),
            "model_id": self.model_id,
            "model_name": self.model_name,
        }

    @staticmethod
    def _deduplicate(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for item in detections:
            anomaly_type = item["anomaly_type"]
            if anomaly_type not in seen:
                seen.add(anomaly_type)
                unique.append(item)
        return unique


class _GraphExperimentalModel(MockExperimentalModel):
    family = "graph_level"
    supported_analysis_levels = ["graph"]
    status = "experimental"
    is_mock = True


class GraphGDNModel(_GraphExperimentalModel):
    model_id = "graph_gdn"
    model_name = "Graph-Level GDN"
    model_type = "graph_ai"
    version = "0.1.0"
    objective = "Modeliser les deviations entre noeuds du graphe GISRE."
    anomaly_types = ["GRAPH_GDN_ANOMALY", "DEPENDENCY_HOTSPOT", "SHARED_PROVIDER_FAILURE"]
    default_anomaly_type = "GRAPH_GDN_ANOMALY"


class GraphMTADGATModel(_GraphExperimentalModel):
    model_id = "graph_mtad_gat"
    model_name = "Graph-Level MTAD-GAT"
    model_type = "graph_ai"
    version = "0.1.0"
    objective = "Combiner attention temporelle et graphe de dependances GISRE."
    anomaly_types = ["GRAPH_MTAD_GAT_ANOMALY", "CROSS_FLOW_PROPAGATION", "DEPENDENCY_CHAIN_LATENCY"]
    default_anomaly_type = "GRAPH_MTAD_GAT_ANOMALY"


class GraphTopoGDNModel(_GraphExperimentalModel):
    model_id = "graph_topo_gdn"
    model_name = "Graph-Level TopoGDN"
    model_type = "graph_ai"
    version = "0.1.0"
    objective = "Exploiter la topologie du graphe pour detecter ruptures et hotspots critiques."
    anomaly_types = ["GRAPH_TOPOLOGY_ANOMALY", "GRAPH_CONNECTIVITY_ANOMALY", "CRITICAL_PROVIDER_INSTABILITY"]
    default_anomaly_type = "GRAPH_TOPOLOGY_ANOMALY"
