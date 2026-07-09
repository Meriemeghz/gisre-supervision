from __future__ import annotations

import logging
from typing import Any

from app.ai_models.graph_level import GraphGDNModel, GraphMTADGATModel, GraphRulesEngineModel
from app.core.database import Database

logger = logging.getLogger(__name__)


class GraphLevelAnalyzer:
    """Analyze dependency graph impact around shared producers/providers."""

    window = "30m"
    minimum_window_events = 10

    def __init__(self, database: Database) -> None:
        self.database = database
        self.active_model = GraphRulesEngineModel()
        self.experimental_models = [GraphGDNModel(), GraphMTADGATModel()]
        for model in self.experimental_models:
            model.load()
        self.models = {
            self.active_model.model_id: self.active_model,
            **{model.model_id: model for model in self.experimental_models},
        }
        self.compatible_models = [
            "graph_rules_engine",
            "graph_gdn",
            "graph_mtad_gat",
            "graph_topo_gdn",
        ]

    def analyze(self, event: dict[str, Any], model_id: str | None = None) -> list[dict[str, Any]]:
        outcome = self.analyze_contract(event, model_id=model_id)
        return list(outcome.get("anomalies") or [])

    def analyze_contract(self, event: dict[str, Any], model_id: str | None = None) -> dict[str, Any]:
        if event.get("event_type") != "api_call":
            return self._unavailable("Graph-Level requires an API call event")

        producer_actor_id = event.get("producer_actor_id")
        if not producer_actor_id:
            return self._unavailable("Graph-Level requires a producer dependency context")

        stats = self._graph_stats(str(producer_actor_id))
        impacted_entities = self._impacted_entities(stats)
        if int(stats.get("total_provider_calls") or 0) < self.minimum_window_events:
            return {
                "status": "warming_up",
                "reason": "Insufficient graph window data",
                "window": self.window,
                "metrics": self._metrics(stats),
                "impacted_entities": impacted_entities,
                "anomalies": [],
            }

        model = self.models.get(model_id or self.active_model.model_id)
        if model is None:
            return self._unavailable("Configured Graph-Level model is not available")
        if isinstance(model, GraphRulesEngineModel):
            detections = model.detect(event, stats)
            anomalies = [self._to_engine_anomaly(detection, stats, model) for detection in detections]
        elif model.is_trained:
            prediction = model.predict({**event, "graph_profile": stats})
            anomalies = [self._to_engine_anomaly(prediction, stats, model)] if prediction.get("anomaly_detected") else []
        else:
            anomalies = []

        if anomalies:
            logger.info(
                "[AI-GRAPH] anomalies detected count=%s producer=%s",
                len(anomalies),
                event.get("producer_code") or producer_actor_id,
            )

        return {
            "status": "success",
            "reason": "Graph dependency window analyzed successfully",
            "window": self.window,
            "metrics": self._metrics(stats),
            "impacted_entities": impacted_entities,
            "anomalies": anomalies,
        }

    def _graph_stats(self, producer_actor_id: str) -> dict[str, Any]:
        stats = self.database.fetch_one(
            """
            SELECT
                COUNT(*)::int AS total_provider_calls,
                COUNT(DISTINCT flow_id)::int AS impacted_flows_count,
                COUNT(DISTINCT consumer_actor_id)::int AS impacted_consumers_count,
                COUNT(DISTINCT api_id)::int AS impacted_apis_count,
                AVG(latency_ms / NULLIF(sla_latency_ms, 0))::float AS producer_avg_latency_ratio,
                AVG(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)::float AS producer_error_rate,
                AVG(CASE WHEN is_sla_breach = true THEN 1 ELSE 0 END)::float AS producer_sla_rate
            FROM api_calls
            WHERE producer_actor_id = %s
              AND called_at >= NOW() - INTERVAL '30 minutes'
              AND latency_ms IS NOT NULL
            """,
            (producer_actor_id,),
        ) or {}
        stats["synchronized_failures"] = self._synchronized_failures(producer_actor_id)
        stats["top_impacted_flows"] = self._top_impacted_flows(producer_actor_id)
        stats["top_impacted_consumers"] = self._top_impacted_consumers(producer_actor_id)
        stats["top_impacted_apis"] = self._top_impacted_apis(producer_actor_id)
        stats["shared_provider_score"] = self._bounded_score(
            int(stats.get("impacted_flows_count") or 0) * 14
            + int(stats.get("impacted_consumers_count") or 0) * 10
            + float(stats.get("producer_error_rate") or 0) * 100
        )
        stats["cascade_risk_score"] = self._bounded_score(
            int(stats.get("synchronized_failures") or 0) * 18
            + float(stats.get("producer_error_rate") or 0) * 140
            + float(stats.get("producer_sla_rate") or 0) * 80
        )
        stats["dependency_hotspot_score"] = self._bounded_score(
            int(stats.get("total_provider_calls") or 0) / 2
            + int(stats.get("impacted_flows_count") or 0) * 10
            + int(stats.get("impacted_apis_count") or 0) * 8
        )
        stats["nodes_count"] = (
            1
            + int(stats.get("impacted_flows_count") or 0)
            + int(stats.get("impacted_consumers_count") or 0)
            + int(stats.get("impacted_apis_count") or 0)
        )
        stats["edges_count"] = int(stats.get("total_provider_calls") or 0)
        stats["propagation_depth"] = self._propagation_depth(stats)
        stats["dominant_impacted_node"] = self._dominant_node(stats)
        stats["dominant_anomaly_type"] = self._dominant_anomaly_type(stats)
        return stats

    def _synchronized_failures(self, producer_actor_id: str) -> int:
        row = self.database.fetch_one(
            """
            SELECT COALESCE(MAX(failure_count), 0)::int AS synchronized_failures
            FROM (
                SELECT date_trunc('minute', called_at) AS minute_bucket,
                       COUNT(DISTINCT flow_id)::int AS failure_count
                FROM api_calls
                WHERE producer_actor_id = %s
                  AND called_at >= NOW() - INTERVAL '30 minutes'
                  AND (success = false OR status_code >= 400 OR is_sla_breach = true)
                GROUP BY minute_bucket
            ) buckets
            """,
            (producer_actor_id,),
        ) or {}
        return int(row.get("synchronized_failures") or 0)

    def _top_impacted_flows(self, producer_actor_id: str) -> list[dict[str, Any]]:
        return self.database.fetch_all(
            """
            SELECT COALESCE(flow_code, flow_id::text) AS flow_code,
                   COUNT(*)::int AS calls,
                   AVG(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)::float AS error_rate,
                   AVG(latency_ms / NULLIF(sla_latency_ms, 0))::float AS avg_latency_ratio
            FROM api_calls
            WHERE producer_actor_id = %s
              AND called_at >= NOW() - INTERVAL '30 minutes'
              AND latency_ms IS NOT NULL
            GROUP BY COALESCE(flow_code, flow_id::text)
            ORDER BY error_rate DESC, avg_latency_ratio DESC
            LIMIT 5
            """,
            (producer_actor_id,),
        )

    def _top_impacted_consumers(self, producer_actor_id: str) -> list[dict[str, Any]]:
        return self.database.fetch_all(
            """
            SELECT COALESCE(consumer_code, consumer_actor_id::text) AS consumer_code,
                   COUNT(*)::int AS calls,
                   AVG(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)::float AS error_rate
            FROM api_calls
            WHERE producer_actor_id = %s
              AND called_at >= NOW() - INTERVAL '30 minutes'
            GROUP BY COALESCE(consumer_code, consumer_actor_id::text)
            ORDER BY error_rate DESC, calls DESC
            LIMIT 5
            """,
            (producer_actor_id,),
        )

    def _top_impacted_apis(self, producer_actor_id: str) -> list[dict[str, Any]]:
        return self.database.fetch_all(
            """
            SELECT COALESCE(api_code, api_id::text) AS api_code,
                   COUNT(*)::int AS calls,
                   AVG(CASE WHEN success = false OR status_code >= 400 THEN 1 ELSE 0 END)::float AS error_rate
            FROM api_calls
            WHERE producer_actor_id = %s
              AND called_at >= NOW() - INTERVAL '30 minutes'
            GROUP BY COALESCE(api_code, api_id::text)
            ORDER BY error_rate DESC, calls DESC
            LIMIT 5
            """,
            (producer_actor_id,),
        )

    @staticmethod
    def _to_engine_anomaly(detection: dict[str, Any], stats: dict[str, Any], model: Any | None = None) -> dict[str, Any]:
        return {
            "detected_anomaly_type": detection["anomaly_type"],
            "confidence": detection.get("confidence"),
            "explanation": detection.get("explanation"),
            "analysis_type": "realtime",
            "analysis_level": "graph",
            "model": {
                "id": detection.get("model_id") or getattr(model, "model_id", None),
                "name": detection.get("model_name") or getattr(model, "model_name", None),
                "version": getattr(model, "version", None),
                "family": "graph_level",
                "window": "provider dependency graph 30m",
                "stats": stats,
            },
        }

    def _metrics(self, stats: dict[str, Any]) -> dict[str, Any]:
        return {
            "nodes_count": int(stats.get("nodes_count") or 0),
            "edges_count": int(stats.get("edges_count") or 0),
            "impacted_producers_count": 1 if int(stats.get("total_provider_calls") or 0) > 0 else 0,
            "impacted_consumers_count": int(stats.get("impacted_consumers_count") or 0),
            "impacted_apis_count": int(stats.get("impacted_apis_count") or 0),
            "impacted_flows_count": int(stats.get("impacted_flows_count") or 0),
            "shared_provider_score": round(float(stats.get("shared_provider_score") or 0), 2),
            "cascade_risk_score": round(float(stats.get("cascade_risk_score") or 0), 2),
            "dependency_hotspot_score": round(float(stats.get("dependency_hotspot_score") or 0), 2),
            "propagation_depth": int(stats.get("propagation_depth") or 0),
            "dominant_impacted_node": stats.get("dominant_impacted_node"),
            "dominant_anomaly_type": stats.get("dominant_anomaly_type") or "GRAPH_NORMAL",
        }

    @staticmethod
    def _impacted_entities(stats: dict[str, Any]) -> dict[str, Any]:
        return {
            "producers": [],
            "consumers": stats.get("top_impacted_consumers") or [],
            "apis": stats.get("top_impacted_apis") or [],
            "flows": stats.get("top_impacted_flows") or [],
        }

    @staticmethod
    def _bounded_score(value: float) -> float:
        return max(0.0, min(100.0, float(value)))

    @staticmethod
    def _propagation_depth(stats: dict[str, Any]) -> int:
        impacted_layers = [
            int(stats.get("impacted_flows_count") or 0) > 1,
            int(stats.get("impacted_consumers_count") or 0) > 1,
            int(stats.get("impacted_apis_count") or 0) > 1,
        ]
        return sum(1 for item in impacted_layers if item)

    @staticmethod
    def _dominant_node(stats: dict[str, Any]) -> str | None:
        flows = stats.get("top_impacted_flows") or []
        consumers = stats.get("top_impacted_consumers") or []
        apis = stats.get("top_impacted_apis") or []
        for collection, key in ((flows, "flow_code"), (consumers, "consumer_code"), (apis, "api_code")):
            if collection:
                return str(collection[0].get(key) or "")
        return None

    @staticmethod
    def _dominant_anomaly_type(stats: dict[str, Any]) -> str:
        if float(stats.get("producer_error_rate") or 0) >= 0.20:
            return "shared_provider_failure"
        if int(stats.get("synchronized_failures") or 0) >= 4:
            return "dependent_service_failure"
        if int(stats.get("impacted_consumers_count") or 0) >= 3:
            return "multi_consumer_impact"
        if float(stats.get("producer_sla_rate") or 0) >= 0.20:
            return "interoperability_degradation"
        return "GRAPH_NORMAL"

    def _unavailable(self, reason: str) -> dict[str, Any]:
        return {
            "status": "unavailable",
            "reason": reason,
            "window": self.window,
            "metrics": {},
            "impacted_entities": {"producers": [], "consumers": [], "apis": [], "flows": []},
            "anomalies": [],
        }
