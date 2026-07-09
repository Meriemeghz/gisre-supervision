from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import Settings
from app.core.database import Database
from app.ai_models.event_level.models import SIMULATION_TO_EVENT_LABEL
from app.services.event_level_analyzer import EventLevelAnalyzer
from app.services.flow_level_analyzer import FlowLevelAnalyzer
from app.services.graph_level_analyzer import GraphLevelAnalyzer
from app.services.historical_analyzer import HistoricalAnalyzer
from app.services.ml_anomaly_service import MLAnomalyService
from app.services.model_activation_policy import ModelActivationPolicy
from app.services.preprocessing_service import PreprocessingService
from app.services.recommendation_service import RecommendationService
from app.services.scoring_service import ScoringService
from app.services.temporal_level_analyzer import TemporalLevelAnalyzer
from app.services.triage_engine import TriageEngine
from app.ai_models.reinforcement.experience_memory import ExperienceMemory
from app.ai_models.reinforcement.rl_decision_agent import RLDecisionAgent, state_from_result

logger = logging.getLogger(__name__)


SIMULATION_PRIMARY_AI = {
    **SIMULATION_TO_EVENT_LABEL,
    "sla_breach": "SLA_BREACH",
    "traffic_spike": "TRAFFIC_SPIKE",
    "high_error_rate": "HIGH_ERROR_RATE",
    "provider_slowdown": "PROVIDER_SLOWDOWN",
    "timeout_burst": "TIMEOUT",
    "authentication_abuse": "ACCESS_DENIED",
    "repeated_502_errors": "PROVIDER_UNREACHABLE",
    "provider_unreachable": "PROVIDER_UNREACHABLE",
    "latency_drift": "LATENCY_DRIFT",
    "access_denied_anomaly": "ACCESS_DENIED",
    "unexpected_volume": "TRAFFIC_SPIKE",
    "corrupted_event_payload": "CORRUPTED_EVENT_PAYLOAD",
    "duplicate_event": "DUPLICATE_EVENT",
    "missing_correlation_id": "MISSING_CORRELATION_ID",
    "out_of_order_event": "DATA_CONSISTENCY_SIGNAL",
    "audit_gap": "DATA_CONSISTENCY_SIGNAL",
    "missing_latency_metric": "MISSING_LATENCY_METRIC",
    "response_time_spike": "RESPONSE_TIME_SPIKE",
    "gradual_performance_degradation": "LATENCY_DRIFT",
    "sla_instability": "SLA_BREACH",
    "traffic_drop": "TRAFFIC_SPIKE",
    "consumer_overuse": "TRAFFIC_SPIKE",
    "security_failure_burst": "SECURITY_FAILURE_BURST",
    "suspicious_access_pattern": "SUSPICIOUS_ACCESS",
    "unauthorized_api_attempt": "ACCESS_DENIED",
    "token_failure_pattern": "ACCESS_DENIED",
    "rate_limit_exceeded": "RATE_LIMIT_EXCEEDED",
    "cascade_failure": "PROVIDER_UNREACHABLE",
    "dependent_service_failure": "PROVIDER_UNREACHABLE",
    "multi_consumer_impact": "PROVIDER_SLOWDOWN",
    "shared_provider_failure": "PROVIDER_UNREACHABLE",
    "critical_provider_instability": "PROVIDER_SLOWDOWN",
    "global_security_alert": "SECURITY_FAILURE_BURST",
    "platform_health_degradation": "PROVIDER_SLOWDOWN",
    "critical_service_saturation": "HIGH_LATENCY",
    "hybrid_risk_signal": "PROVIDER_SLOWDOWN",
}


ANOMALY_PRIORITY = {
    "PROVIDER_UNREACHABLE": 1,
    "CASCADE_FAILURE": 1,
    "SHARED_PROVIDER_FAILURE": 2,
    "CRITICAL_PROVIDER_INSTABILITY": 2,
    "TIMEOUT": 2,
    "MULTI_CONSUMER_IMPACT": 3,
    "CROSS_FLOW_PROPAGATION": 3,
    "DEPENDENCY_CHAIN_LATENCY": 4,
    "SYNCHRONIZED_FAILURE_PATTERN": 4,
    "DEPENDENCY_HOTSPOT": 5,
    "SERVER_ERROR": 3,
    "HIGH_ERROR_RATE": 4,
    "REPEATED_FAILURES": 5,
    "SECURITY_FAILURE_BURST": 6,
    "AUTHENTICATION_ABUSE": 7,
    "ACCESS_DENIED": 8,
    "SUSPICIOUS_ACCESS": 9,
    "RATE_LIMIT_EXCEEDED": 10,
    "PROVIDER_SLOWDOWN": 11,
    "PARTIAL_PROVIDER_DEGRADATION": 11,
    "CRITICAL_FLOW_INSTABILITY": 11,
    "SLOW_API_ENDPOINT": 12,
    "LATENCY_SPIKE": 12,
    "ML_FLOW_CLUSTER_OUTLIER": 13,
    "ML_ISOLATION_FOREST": 13,
    "ML_ONE_CLASS_SVM": 14,
    "ML_RANDOM_FOREST": 15,
    "ML_KMEANS_CLUSTER": 16,
    "ML_AUTOENCODER": 17,
    "DL_GRU_SEQUENCE": 18,
    "TIMEOUT_BURST": 18,
    "LATENCY_DRIFT": 19,
    "GRADUAL_PERFORMANCE_DEGRADATION": 19,
    "SLA_INSTABILITY": 20,
    "INTERMITTENT_FAILURE": 20,
    "SERVICE_FLAPPING": 20,
    "STREAM_PROCESSING_DELAY": 20,
    "HIGH_LATENCY": 20,
    "TRAFFIC_SPIKE": 21,
    "TRAFFIC_DROP": 21,
    "UNEXPECTED_VOLUME": 21,
    "API_UNDERUSE": 21,
    "REPEATED_RETRY_PATTERN": 21,
    "DATA_CONSISTENCY_SIGNAL": 22,
    "SLA_BREACH": 23,
}


HISTORICAL_MIN_SCORE = 60
HISTORICAL_COOLDOWN_SECONDS = 120


class AIEngine:
    def __init__(self, database: Database, settings: Settings) -> None:
        self.database = database
        self.settings = settings
        self.preprocessing = PreprocessingService(database)
        self.event_level_analyzer = EventLevelAnalyzer()
        self.temporal_level_analyzer = TemporalLevelAnalyzer(database)
        self.flow_level_analyzer = FlowLevelAnalyzer(database)
        self.graph_level_analyzer = GraphLevelAnalyzer(database)
        self.historical_analyzer = HistoricalAnalyzer(database)
        self.ml_anomaly_service = MLAnomalyService(database)
        self.scoring = ScoringService()
        self.recommendations = RecommendationService()
        self.triage = TriageEngine()
        self.rl_decision_agent = RLDecisionAgent(
            enabled=settings.rl_triage_enabled,
            min_experiences=settings.rl_min_experiences,
            confidence_threshold=settings.rl_confidence_threshold,
            epsilon=settings.rl_epsilon,
            memory=ExperienceMemory(model_storage_dir=settings.model_storage_dir),
        )
        self.model_policy = ModelActivationPolicy(settings.model_storage_dir)
        self._historical_cooldowns: dict[tuple[str, str], datetime] = {}

    def analyze_event(self, topic: str, event: dict[str, Any]) -> list[dict[str, Any]]:
        processed = self.preprocessing.preprocess(topic, event)
        analysis_trace: dict[str, dict[str, Any]] = {}
        realtime_scored: list[dict[str, Any]] = []

        event_anomalies = self._execute_level("event", self.event_level_analyzer, processed, analysis_trace)
        event_scored = self._score_level(event_anomalies, processed, analysis_trace["event"])
        realtime_scored.extend(event_scored)
        event_risk = self._max_risk(event_scored)
        event_severity = self._max_severity(event_scored)
        event_primary, event_secondary = self._select_primary(event_scored)
        event_should_continue = self._should_execute_flow(processed, event_scored)
        event_decision = self._event_level_decision(
            event_should_continue,
            event_primary,
            processed,
        )
        analysis_trace["event"].update(
            {
                "status": (
                    "warning"
                    if event_primary is not None
                    else analysis_trace["event"].get("status", "success")
                ),
                "anomaly_detected": event_primary is not None,
                "anomaly_type": (
                    event_primary.get("detected_anomaly_type")
                    if event_primary is not None
                    else "NORMAL"
                ),
                "confidence": (
                    float(event_primary.get("confidence") or 0)
                    if event_primary is not None
                    else 0.0
                ),
                "risk_contribution": (
                    int(event_primary.get("risk_score") or 0)
                    if event_primary is not None
                    else 0
                ),
                "decision_next_level": event_decision["next_level"],
                "decision_reason": event_decision["reason"],
                "routing_trigger": event_decision["routing_trigger"],
            }
        )

        flow_contract: dict[str, Any] | None = None
        if event_decision["next_level"] == "flow":
            flow_scored, flow_contract = self._execute_flow_contract(
                processed,
                analysis_trace,
            )
            realtime_scored.extend(flow_scored)
        else:
            flow_scored = []
            analysis_trace["flow"] = self._skipped_trace(
                "Event risk is low and no flow context is required"
            )
            analysis_trace["flow"].update(
                {
                    "window": "5m",
                    "metrics": {},
                    "decision_next_level": "stop",
                    "decision_reason": "No repetitive or sequential pattern detected",
                    "routing_trigger": "NONE",
                }
            )

        flow_decision = (flow_contract or {}).get("decision") or {
            "next_level": "stop",
            "reason": "No repetitive or sequential pattern detected",
        }
        risk_after_flow = min(100, event_risk + self._max_risk(flow_scored))
        temporal_contract: dict[str, Any] | None = None
        if flow_decision["next_level"] == "temporal":
            temporal_scored, temporal_contract = self._execute_temporal_contract(
                processed,
                analysis_trace,
            )
            realtime_scored.extend(temporal_scored)
        else:
            temporal_scored = []
            analysis_trace["temporal"] = self._skipped_trace(
                "No repetitive or sequential pattern detected"
            )
            analysis_trace["temporal"].update(
                {
                    "window": "15m",
                    "metrics": {},
                    "decision_next_level": "stop",
                    "decision_reason": "No dependency propagation pattern detected",
                }
            )

        temporal_decision = (temporal_contract or {}).get("decision") or {
            "next_level": "stop",
            "reason": "No dependency propagation pattern detected",
        }
        risk_before_graph = max(risk_after_flow, self._max_risk(temporal_scored))
        severity_before_graph = self._max_severity(realtime_scored) or event_severity
        graph_contract: dict[str, Any] | None = None
        if (
            temporal_decision.get("next_level") == "graph"
            or self._should_execute_graph(processed, risk_before_graph, severity_before_graph)
        ):
            graph_scored, graph_contract = self._execute_graph_contract(
                processed,
                analysis_trace,
            )
            realtime_scored.extend(graph_scored)
        else:
            graph_scored = []
            analysis_trace["graph"] = self._skipped_trace(
                "No critical dependency impact detected"
            )
            analysis_trace["graph"].update(
                {
                    "window": "30m",
                    "metrics": {},
                    "impacted_entities": {"producers": [], "consumers": [], "apis": [], "flows": []},
                    "decision_next_level": "stop",
                    "decision_reason": "Graph-Level was not required for this event",
                }
            )

        supplemental: list[dict[str, Any]] = []
        if self.settings.ai_enable_historical:
            supplemental.extend(self.historical_analyzer.analyze(processed))
            supplemental.extend(self.ml_anomaly_service.analyze(processed))

        unique = self._deduplicate(realtime_scored + [
            self.scoring.score(anomaly, processed) for anomaly in supplemental
        ])
        scored_anomalies = unique
        filtered = [anomaly for anomaly in scored_anomalies if self._should_keep_anomaly(anomaly, processed)]
        primary, secondary = self._select_primary(filtered)

        executed_levels = [
            level for level, trace in analysis_trace.items() if trace.get("executed") is True
        ]
        skipped_levels = [
            level
            for level, trace in analysis_trace.items()
            if trace.get("status") in {"skipped", "warming_up", "unavailable", "failed"}
        ]

        if event_primary is None:
            event_status = analysis_trace.get("event", {}).get("status")
            event_failed = event_status in {"failed", "unavailable"}
            event_primary = {
                "detected_anomaly_type": "NORMAL",
                "risk_score": 0,
                "severity": "low",
                "confidence": 0.0,
                "explanation": (
                    f"Event-Level analysis unavailable: {analysis_trace['event'].get('reason')}"
                    if event_failed
                    else "No anomaly detected at event level"
                ),
                "recommendation": (
                    "Check the active Event-Level model configuration"
                    if event_failed
                    else "No action required"
                ),
                "analysis_type": "realtime",
                "analysis_level": "event",
                "model": analysis_trace.get("event", {}).get("model"),
            }
            event_secondary = []

        persisted: list[dict[str, Any]] = []
        fused_risk = min(
            100,
            sum(
                int(trace.get("risk_contribution") or 0)
                for trace in analysis_trace.values()
                if trace.get("executed") is True
            ),
        )
        anomaly_detected = event_primary["detected_anomaly_type"] != "NORMAL"
        should_recommend = (
            anomaly_detected
            or int(event_primary.get("risk_score") or 0) >= 40
            or event_primary.get("severity") in {"medium", "high", "critical"}
        )
        if should_recommend:
            event_primary["recommendation"] = self.recommendations.recommendation_for(
                event_primary["detected_anomaly_type"]
            )
        elif analysis_trace.get("event", {}).get("status") not in {"failed", "unavailable"}:
            event_primary["recommendation"] = "No action required"
        event_primary["decision"] = event_decision
        event_primary["secondary_anomalies"] = [
            {
                "detected_anomaly_type": item["detected_anomaly_type"],
                "analysis_type": item.get("analysis_type"),
                "confidence": item.get("confidence"),
                "explanation": item.get("explanation"),
                "risk_score": item.get("risk_score"),
                "severity": item.get("severity"),
                "model": item.get("model"),
            }
            for item in event_secondary
        ]
        final_risk = fused_risk
        final_severity = self.scoring._severity(fused_risk)
        risk_fusion = {
            "status": "success",
            "executed_levels": executed_levels,
            "skipped_levels": skipped_levels,
            "final_risk_score": final_risk,
            "final_severity": final_severity,
            "fusion_reason": "Risk contributions were combined only for analysis levels that were actually executed.",
            "contributions": {
                level: int((analysis_trace.get(level) or {}).get("risk_contribution") or 0)
                for level in ("event", "flow", "temporal", "graph")
            },
        }
        triage_confidence = self._triage_confidence(analysis_trace)
        triage_engine = getattr(self, "triage", None) or TriageEngine()
        triage_decision = triage_engine.decide(
            risk_score=final_risk,
            confidence=triage_confidence,
            severity=final_severity,
            anomaly_type=str(event_primary["detected_anomaly_type"]),
            event_trace=analysis_trace.get("event"),
            flow_trace=analysis_trace.get("flow"),
            temporal_trace=analysis_trace.get("temporal"),
            graph_trace=analysis_trace.get("graph"),
        )
        rl_agent = getattr(self, "rl_decision_agent", None)
        if rl_agent is not None:
            triage_decision = rl_agent.adapt(
                triage_decision,
                state_from_result(
                    {
                        "detected_anomaly_type": event_primary["detected_anomaly_type"],
                        "risk_score": final_risk,
                        "confidence": triage_confidence,
                        "severity": final_severity,
                        "flow_code": processed.get("flow_code"),
                        "analysis_type": "realtime",
                        "validation_status": triage_engine.validation_status(triage_decision),
                        "metadata": {
                            "analysis_level": "event",
                            "analysis_trace": analysis_trace,
                            "flow_code": processed.get("flow_code"),
                            "api_code": processed.get("api_code"),
                            "producer_code": processed.get("producer_code"),
                            "consumer_code": processed.get("consumer_code"),
                        },
                    },
                    triage_decision,
                ),
            )
        else:
            triage_decision = {
                **triage_decision,
                "source": "baseline",
                "baseline_status": triage_decision.get("status"),
                "rl_action": None,
                "rl_confidence": 0.0,
                "expected_reward": 0.0,
                "rl_policy_version": "rl_policy_v1",
                "safety_override": False,
            }
        validation_status = triage_engine.validation_status(triage_decision)

        event_primary["workflow_metadata"] = {
            "anomaly_detected": anomaly_detected,
            "normalization": self._normalization_metadata(processed),
            "analysis_trace": analysis_trace,
            "risk_fusion": risk_fusion,
            "triage_decision": triage_decision,
            "incident_decision": {
                "should_create_incident": (
                    final_risk >= 70
                    or final_severity in {"high", "critical"}
                    or (
                        anomaly_detected
                        and processed.get("flow_criticality") in {"high", "critical"}
                    )
                ),
                "reason": self._incident_reason(
                    final_risk, final_severity, anomaly_detected, processed
                ),
                "threshold_applied": 70,
            },
            "recommendation_decision": {
                "generated": should_recommend,
                "reason": (
                    "An anomaly or material risk requires an operational recommendation."
                    if should_recommend
                    else "No anomaly or material risk requires a recommendation."
                ),
            },
        }
        event_primary["validation_status"] = validation_status
        result = self._build_result(event_primary, processed)
        self.database.insert_ai_result(result)
        if primary is not None:
            self._mark_historical_cooldown(primary, processed)
        persisted.append(result)
        if flow_contract is not None:
            flow_contract["workflow_metadata"] = event_primary["workflow_metadata"]
            flow_contract["validation_status"] = validation_status
            flow_result = self._build_flow_result(flow_contract, processed)
            self.database.insert_ai_result(flow_result)
            persisted.append(flow_result)
        if temporal_contract is not None:
            temporal_contract["workflow_metadata"] = event_primary["workflow_metadata"]
            temporal_contract["validation_status"] = validation_status
            temporal_result = self._build_temporal_result(temporal_contract, processed)
            self.database.insert_ai_result(temporal_result)
            persisted.append(temporal_result)
        if graph_contract is not None:
            graph_contract["workflow_metadata"] = event_primary["workflow_metadata"]
            graph_contract["validation_status"] = validation_status
            graph_result = self._build_graph_result(graph_contract, processed)
            self.database.insert_ai_result(graph_result)
            persisted.append(graph_result)

        return persisted

    def _execute_flow_contract(
        self,
        event: dict[str, Any],
        analysis_trace: dict[str, dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        analyzer = self.flow_level_analyzer
        model_id = self.model_policy.active_model_id("flow")
        model = getattr(analyzer, "models", {}).get(model_id) if analyzer and model_id else None
        if analyzer is None or not model_id or model is None:
            reason = "No active Flow-Level model configured"
            analysis_trace["flow"] = {
                **self._skipped_trace(reason),
                "status": "unavailable",
                "window": "5m",
                "metrics": {},
                "decision_next_level": "stop",
                "decision_reason": "No repetitive or sequential pattern detected",
                "routing_trigger": "NONE",
            }
            return [], None
        if model.model_type != "rules" and not model.is_trained:
            reason = "The selected Flow-Level model is not trained"
            analysis_trace["flow"] = {
                "status": "unavailable",
                "executed": False,
                "reason": reason,
                "skip_reason": reason,
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "5m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": {},
                "decision_next_level": "stop",
                "decision_reason": "No repetitive or sequential pattern detected",
                "routing_trigger": "NONE",
                "model": model.get_metadata(),
            }
            return [], None

        try:
            outcome = analyzer.analyze_contract(event, model_id=model_id)
        except Exception as error:
            logger.exception("[AI-FLOW] analysis failed model=%s", model_id)
            analysis_trace["flow"] = {
                "status": "failed",
                "executed": False,
                "reason": str(error),
                "skip_reason": str(error),
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "5m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": {},
                "decision_next_level": "stop",
                "decision_reason": "Flow-Level analysis failed",
                "routing_trigger": "NONE",
                "model": model.get_metadata(),
            }
            return [], None

        metrics = outcome.get("metrics") or {}
        if outcome.get("status") == "unavailable":
            reason = outcome.get("reason") or "Insufficient flow window data"
            warming_up = reason == "Insufficient flow window data"
            analysis_trace["flow"] = {
                "status": "warming_up" if warming_up else "unavailable",
                "executed": False,
                "reason": "Collecting flow window data" if warming_up else reason,
                "skip_reason": "Collecting flow window data" if warming_up else reason,
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "5m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": metrics,
                "decision_next_level": "stop",
                "decision_reason": "No repetitive or sequential pattern detected",
                "routing_trigger": "NONE",
                "model": model.get_metadata(),
            }
            return [], None

        anomalies = outcome.get("anomalies") or []
        trace = {
            "status": "success",
            "executed": True,
            "reason": outcome.get("reason") or "Flow window analyzed successfully",
            "skip_reason": None,
            "selected_model_id": model.model_id,
            "selected_model_name": model.model_name,
            "selected_model_version": model.version,
            "window": "5m",
            "anomaly_detected": False,
            "anomaly_type": "FLOW_NORMAL",
            "confidence": 1.0,
            "risk_contribution": 0,
            "metrics": metrics,
            "model": model.get_metadata(),
        }
        analysis_trace["flow"] = trace
        scored = self._score_level(anomalies, event, trace)
        primary, secondary = self._select_primary(scored)

        if primary is None:
            primary = {
                "detected_anomaly_type": "FLOW_NORMAL",
                "risk_score": 0,
                "severity": "low",
                "confidence": 1.0,
                "explanation": "No anomaly detected at flow level",
                "recommendation": "No action required",
                "analysis_type": "realtime",
                "analysis_level": "flow",
                "model": model.get_metadata(),
            }
        else:
            trace["status"] = "warning"
            primary["recommendation"] = self.recommendations.recommendation_for(
                primary["detected_anomaly_type"]
            )

        decision = self._flow_level_decision(primary, metrics)
        trace.update(
            {
                "anomaly_detected": primary["detected_anomaly_type"] != "FLOW_NORMAL",
                "anomaly_type": primary["detected_anomaly_type"],
                "confidence": float(primary.get("confidence") or 0),
                "risk_contribution": int(primary.get("risk_score") or 0),
                "decision_next_level": decision["next_level"],
                "decision_reason": decision["reason"],
                "routing_trigger": decision["routing_trigger"],
            }
        )
        return scored, {
            **primary,
            "analysis_level": "flow",
            "window": "5m",
            "metrics": metrics,
            "decision": decision,
            "secondary_anomalies": secondary,
        }

    def _execute_temporal_contract(
        self,
        event: dict[str, Any],
        analysis_trace: dict[str, dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        analyzer = self.temporal_level_analyzer
        model_id = self.model_policy.active_model_id("temporal")
        model = getattr(analyzer, "models", {}).get(model_id) if analyzer and model_id else None
        if analyzer is None or not model_id or model is None:
            reason = "No active Temporal-Level model configured"
            analysis_trace["temporal"] = {
                **self._skipped_trace(reason),
                "status": "unavailable",
                "window": "15m",
                "metrics": {},
                "decision_next_level": "stop",
                "decision_reason": "No dependency propagation pattern detected",
            }
            return [], None
        if model.model_type != "rules" and not model.is_trained:
            reason = "The selected Temporal-Level model is not trained"
            analysis_trace["temporal"] = {
                "status": "unavailable",
                "executed": False,
                "reason": reason,
                "skip_reason": reason,
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "15m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": {},
                "decision_next_level": "stop",
                "decision_reason": "No dependency propagation pattern detected",
                "model": model.get_metadata(),
            }
            return [], None

        try:
            outcome = analyzer.analyze_contract(event, model_id=model_id)
        except Exception as error:
            logger.exception("[AI-TEMPORAL] analysis failed model=%s", model_id)
            analysis_trace["temporal"] = {
                "status": "failed",
                "executed": False,
                "reason": str(error),
                "skip_reason": str(error),
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "15m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": {},
                "decision_next_level": "stop",
                "decision_reason": "Temporal-Level analysis failed",
                "model": model.get_metadata(),
            }
            return [], None

        metrics = outcome.get("metrics") or {}
        if outcome.get("status") == "unavailable":
            reason = outcome.get("reason") or "Insufficient temporal window data"
            analysis_trace["temporal"] = {
                "status": "unavailable",
                "executed": False,
                "reason": reason,
                "skip_reason": reason,
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "15m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": metrics,
                "decision_next_level": "stop",
                "decision_reason": "No dependency propagation pattern detected",
                "model": model.get_metadata(),
            }
            return [], None

        anomalies = outcome.get("anomalies") or []
        trace = {
            "status": "success",
            "executed": True,
            "reason": outcome.get("reason") or "Temporal window analyzed successfully",
            "skip_reason": None,
            "selected_model_id": model.model_id,
            "selected_model_name": model.model_name,
            "selected_model_version": model.version,
            "window": "15m",
            "anomaly_detected": False,
            "anomaly_type": "TEMPORAL_NORMAL",
            "confidence": 1.0,
            "risk_contribution": 0,
            "metrics": metrics,
            "model": model.get_metadata(),
        }
        analysis_trace["temporal"] = trace
        scored = self._score_level(anomalies, event, trace)
        primary, secondary = self._select_primary(scored)

        if primary is None:
            primary = {
                "detected_anomaly_type": "TEMPORAL_NORMAL",
                "risk_score": 0,
                "severity": "low",
                "confidence": 1.0,
                "explanation": "No temporal anomaly detected in the recent 15-minute window",
                "recommendation": "No action required",
                "analysis_type": "realtime",
                "analysis_level": "temporal",
                "model": model.get_metadata(),
            }
        else:
            trace["status"] = "warning"
            primary["recommendation"] = primary.get(
                "recommendation"
            ) or self.recommendations.recommendation_for(
                primary["detected_anomaly_type"]
            )

        decision = self._temporal_level_decision(primary, metrics, event)
        trace.update(
            {
                "anomaly_detected": primary["detected_anomaly_type"] != "TEMPORAL_NORMAL",
                "anomaly_type": primary["detected_anomaly_type"],
                "confidence": float(primary.get("confidence") or 0),
                "risk_contribution": int(primary.get("risk_score") or 0),
                "decision_next_level": decision["next_level"],
                "decision_reason": decision["reason"],
            }
        )
        return scored, {
            **primary,
            "analysis_level": "temporal",
            "window": "15m",
            "metrics": metrics,
            "decision": decision,
            "secondary_anomalies": secondary,
        }

    def _execute_graph_contract(
        self,
        event: dict[str, Any],
        analysis_trace: dict[str, dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        analyzer = self.graph_level_analyzer
        model_id = self.model_policy.active_model_id("graph")
        model = getattr(analyzer, "models", {}).get(model_id) if analyzer and model_id else None
        empty_entities = {"producers": [], "consumers": [], "apis": [], "flows": []}
        if analyzer is None or not model_id or model is None:
            reason = "No active Graph-Level model configured"
            analysis_trace["graph"] = {
                **self._skipped_trace(reason),
                "status": "unavailable",
                "window": "30m",
                "metrics": {},
                "impacted_entities": empty_entities,
                "decision_next_level": "stop",
                "decision_reason": "Graph-Level analysis unavailable",
            }
            return [], None
        if model.model_type != "rules" and not model.is_trained:
            reason = "The selected Graph-Level model is not trained"
            analysis_trace["graph"] = {
                "status": "unavailable",
                "executed": False,
                "reason": reason,
                "skip_reason": reason,
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "30m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": {},
                "impacted_entities": empty_entities,
                "decision_next_level": "stop",
                "decision_reason": "Graph-Level model is not executable",
                "model": model.get_metadata(),
            }
            return [], None

        try:
            outcome = analyzer.analyze_contract(event, model_id=model_id)
        except Exception as error:
            logger.exception("[AI-GRAPH] analysis failed model=%s", model_id)
            analysis_trace["graph"] = {
                "status": "failed",
                "executed": False,
                "reason": str(error),
                "skip_reason": str(error),
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "30m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": {},
                "impacted_entities": empty_entities,
                "decision_next_level": "stop",
                "decision_reason": "Graph-Level analysis failed",
                "model": model.get_metadata(),
            }
            return [], None

        metrics = outcome.get("metrics") or {}
        impacted_entities = outcome.get("impacted_entities") or empty_entities
        if outcome.get("status") in {"unavailable", "warming_up"}:
            raw_reason = outcome.get("reason") or "Insufficient graph window data"
            warming_up = outcome.get("status") == "warming_up" or raw_reason == "Insufficient graph window data"
            reason = "Collecting graph dependency window data" if warming_up else raw_reason
            analysis_trace["graph"] = {
                "status": "warming_up" if warming_up else "unavailable",
                "executed": False,
                "reason": reason,
                "skip_reason": reason,
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "window": "30m",
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "metrics": metrics,
                "impacted_entities": impacted_entities,
                "decision_next_level": "stop",
                "decision_reason": "No dependency propagation pattern detected",
                "model": model.get_metadata(),
            }
            return [], None

        anomalies = outcome.get("anomalies") or []
        trace = {
            "status": "success",
            "executed": True,
            "reason": outcome.get("reason") or "Graph dependency window analyzed successfully",
            "skip_reason": None,
            "selected_model_id": model.model_id,
            "selected_model_name": model.model_name,
            "selected_model_version": model.version,
            "window": "30m",
            "anomaly_detected": False,
            "anomaly_type": "GRAPH_NORMAL",
            "confidence": 1.0,
            "risk_contribution": 0,
            "metrics": metrics,
            "impacted_entities": impacted_entities,
            "model": model.get_metadata(),
        }
        analysis_trace["graph"] = trace
        scored = self._score_level(anomalies, event, trace)
        primary, secondary = self._select_primary(scored)

        if primary is None:
            primary = {
                "detected_anomaly_type": "GRAPH_NORMAL",
                "risk_score": 0,
                "severity": "low",
                "confidence": 1.0,
                "explanation": "No dependency propagation anomaly detected in the recent 30-minute graph window",
                "recommendation": "No action required",
                "analysis_type": "realtime",
                "analysis_level": "graph",
                "model": model.get_metadata(),
            }
        else:
            trace["status"] = "warning"
            primary["recommendation"] = primary.get(
                "recommendation"
            ) or self.recommendations.recommendation_for(
                primary["detected_anomaly_type"]
            )

        decision = {
            "next_level": "stop",
            "reason": "Graph-Level is the final dependency propagation analysis stage",
        }
        trace.update(
            {
                "anomaly_detected": primary["detected_anomaly_type"] != "GRAPH_NORMAL",
                "anomaly_type": primary["detected_anomaly_type"],
                "confidence": float(primary.get("confidence") or 0),
                "risk_contribution": int(primary.get("risk_score") or 0),
                "decision_next_level": decision["next_level"],
                "decision_reason": decision["reason"],
            }
        )
        return scored, {
            **primary,
            "analysis_level": "graph",
            "window": "30m",
            "metrics": metrics,
            "impacted_entities": impacted_entities,
            "decision": decision,
            "secondary_anomalies": secondary,
        }

    def _execute_level(
        self,
        level: str,
        analyzer: Any,
        event: dict[str, Any],
        analysis_trace: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        model_id = self.model_policy.active_model_id(level)
        if not model_id:
            analysis_trace[level] = {
                "status": "unavailable",
                "executed": False,
                "reason": "No active model configured",
                "skip_reason": "No active model configured",
                "selected_model_id": None,
                "selected_model_name": None,
                "selected_model_version": None,
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "model": None,
            }
            return []

        model = getattr(analyzer, "models", {}).get(model_id)
        if model is None:
            analysis_trace[level] = {
                "status": "unavailable",
                "executed": False,
                "reason": f"Configured model is not available in the {level} analyzer",
                "skip_reason": f"Configured model is not available in the {level} analyzer",
                "selected_model_id": model_id,
                "selected_model_name": None,
                "selected_model_version": None,
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "model": None,
            }
            return []

        model_metadata = model.get_metadata()
        if model.model_type != "rules" and not model.is_trained:
            analysis_trace[level] = {
                "status": "failed" if level == "event" else "unavailable",
                "executed": level == "event",
                "reason": "The selected model is not trained",
                "skip_reason": "The selected model is not trained",
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "model": model_metadata,
            }
            return []

        try:
            anomalies = analyzer.analyze(event, model_id=model_id)
        except Exception as error:
            logger.exception("[AI-%s] analysis failed model=%s", level.upper(), model_id)
            analysis_trace[level] = {
                "status": "failed",
                "executed": level == "event",
                "reason": str(error),
                "selected_model_id": model.model_id,
                "selected_model_name": model.model_name,
                "selected_model_version": model.version,
                "anomaly_detected": False,
                "anomaly_type": None,
                "confidence": None,
                "risk_contribution": 0,
                "model": model_metadata,
            }
            return []

        analysis_trace[level] = {
            "status": "success",
            "executed": True,
            "reason": "Active model executed successfully",
            "selected_model_id": model.model_id,
            "selected_model_name": model.model_name,
            "selected_model_version": model.version,
            "anomaly_detected": bool(anomalies),
            "anomaly_type": anomalies[0].get("detected_anomaly_type") if anomalies else "NORMAL",
            "confidence": max(
                (float(item.get("confidence") or 0) for item in anomalies),
                default=None,
            ),
            "risk_contribution": 0,
            "model": model_metadata,
        }
        return anomalies

    def _score_level(
        self,
        anomalies: list[dict[str, Any]],
        event: dict[str, Any],
        trace: dict[str, Any],
    ) -> list[dict[str, Any]]:
        scored = [self.scoring.score(anomaly, event) for anomaly in self._deduplicate(anomalies)]
        if not scored:
            return []

        strongest = max(scored, key=lambda item: int(item.get("risk_score") or 0))
        trace.update(
            {
                "status": (
                    "warning"
                    if strongest.get("severity") in {"high", "critical"}
                    else "success"
                ),
                "anomaly_detected": True,
                "anomaly_type": strongest.get("detected_anomaly_type"),
                "confidence": strongest.get("confidence"),
                "risk_contribution": int(strongest.get("risk_score") or 0),
            }
        )
        return scored

    @staticmethod
    def _skipped_trace(reason: str) -> dict[str, Any]:
        return {
            "status": "skipped",
            "executed": False,
            "reason": reason,
            "skip_reason": reason,
            "selected_model_id": None,
            "selected_model_name": None,
            "selected_model_version": None,
            "anomaly_detected": False,
            "anomaly_type": None,
            "confidence": None,
            "risk_contribution": 0,
            "model": None,
        }

    @staticmethod
    def _max_risk(anomalies: list[dict[str, Any]]) -> int:
        return max((int(item.get("risk_score") or 0) for item in anomalies), default=0)

    @staticmethod
    def _max_severity(anomalies: list[dict[str, Any]]) -> str | None:
        rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        severities = [str(item.get("severity")) for item in anomalies if item.get("severity")]
        return max(severities, key=lambda value: rank.get(value, -1)) if severities else None

    def _should_execute_flow(
        self, event: dict[str, Any], event_anomalies: list[dict[str, Any]]
    ) -> bool:
        risk = self._max_risk(event_anomalies)
        severity = self._max_severity(event_anomalies)
        return bool(
            event_anomalies
            or risk >= 40
            or severity in {"medium", "high", "critical"}
            or event.get("flow_criticality") in {"high", "critical"}
            or event.get("api_criticality") in {"high", "critical"}
        )

    @staticmethod
    def _event_level_decision(
        should_continue: bool,
        event_primary: dict[str, Any] | None,
        event: dict[str, Any],
    ) -> dict[str, str]:
        if not should_continue:
            return {
                "next_level": "stop",
                "reason": "Event risk is low and no flow context is required",
                "routing_trigger": "NONE",
            }

        reasons: list[str] = []
        routing_trigger = "MANUAL_POLICY"
        if event_primary is not None:
            routing_trigger = "EVENT_ANOMALY"
            reasons.append(
                f"Event-Level detected {event_primary.get('detected_anomaly_type') or 'an anomaly'}"
            )
        risk_score = int((event_primary or {}).get("risk_score") or 0)
        severity = str((event_primary or {}).get("severity") or "low")
        if risk_score >= 40:
            if event_primary is None:
                routing_trigger = "RISK_THRESHOLD"
            reasons.append(f"event risk score is {risk_score}")
        if severity in {"medium", "high", "critical"}:
            reasons.append(f"event severity is {severity}")
        if event.get("flow_criticality") in {"high", "critical"}:
            if event_primary is None and risk_score < 40:
                routing_trigger = "FLOW_CRITICALITY"
            reasons.append(f"flow criticality is {event.get('flow_criticality')}")
        if event.get("api_criticality") in {"high", "critical"}:
            if (
                event_primary is None
                and risk_score < 40
                and event.get("flow_criticality") not in {"high", "critical"}
            ):
                routing_trigger = "API_CRITICALITY"
            reasons.append(f"API criticality is {event.get('api_criticality')}")

        return {
            "next_level": "flow",
            "reason": "; ".join(reasons) or "Event risk requires flow context",
            "routing_trigger": routing_trigger,
        }

    @staticmethod
    def _flow_level_decision(
        flow_primary: dict[str, Any],
        metrics: dict[str, Any],
    ) -> dict[str, str]:
        anomaly_type = str(flow_primary.get("detected_anomaly_type") or "FLOW_NORMAL")
        risk_score = int(flow_primary.get("risk_score") or 0)
        latency_trend = str(metrics.get("latency_trend") or "stable")
        anomaly_count = int(metrics.get("anomaly_count") or 0)
        timeout_count = int(metrics.get("timeout_count") or 0)
        error_count = int(metrics.get("error_count") or 0)
        sla_breach_count = int(metrics.get("sla_breach_count") or 0)
        repeated_failures = timeout_count >= 3 or error_count >= 3
        repeated_similar_events = anomaly_count >= 3 or sla_breach_count >= 3
        sequential_pattern = latency_trend == "increasing"
        temporal_types = {
            "FLOW_ERROR_RATE_SPIKE",
            "FLOW_HEALTH_DEGRADATION",
            "FLOW_LATENCY_DRIFT",
            "FLOW_INTERMITTENT_FAILURES",
            "FLOW_SLA_DEGRADATION",
            "FLOW_TRAFFIC_DROP",
            "FLOW_TRAFFIC_SPIKE",
        }
        reasons: list[str] = []
        routing_trigger = "NONE"
        if anomaly_type in temporal_types:
            routing_trigger = "FLOW_ANOMALY"
            reasons.append(f"{anomaly_type} requires temporal confirmation")
        if risk_score >= 60:
            if routing_trigger == "NONE":
                routing_trigger = "FLOW_RISK_THRESHOLD"
            reasons.append(f"flow risk score is {risk_score}")
        if repeated_failures or repeated_similar_events:
            if routing_trigger == "NONE":
                routing_trigger = "REPETITIVE_PATTERN"
            reasons.append("multiple similar events exist in the flow window")
        if sequential_pattern:
            if routing_trigger == "NONE":
                routing_trigger = "SEQUENTIAL_PATTERN"
            reasons.append("latency trend is increasing")
        if reasons:
            return {
                "next_level": "temporal",
                "reason": "; ".join(reasons),
                "routing_trigger": routing_trigger,
            }
        return {
            "next_level": "stop",
            "reason": "No repetitive or sequential pattern detected",
            "routing_trigger": "NONE",
        }

    @staticmethod
    def _temporal_level_decision(
        temporal_primary: dict[str, Any],
        metrics: dict[str, Any],
        event: dict[str, Any],
    ) -> dict[str, str]:
        anomaly_type = str(
            temporal_primary.get("detected_anomaly_type") or "TEMPORAL_NORMAL"
        )
        risk_score = int(temporal_primary.get("risk_score") or 0)
        severity = str(temporal_primary.get("severity") or "low")
        propagation_types = {
            "service_flapping",
            "timeout_burst",
            "gradual_performance_degradation",
        }
        reasons: list[str] = []
        if risk_score >= 75:
            reasons.append(f"temporal risk score is {risk_score}")
        if severity in {"high", "critical"}:
            reasons.append(f"temporal severity is {severity}")
        if anomaly_type in propagation_types:
            reasons.append(f"{anomaly_type} may propagate through dependencies")
        if int(metrics.get("consumer_count") or 0) > 1:
            reasons.append("multiple consumers are impacted")
        if int(metrics.get("producer_count") or 0) > 1:
            reasons.append("multiple producers are impacted")
        if event.get("propagation_risk") in {"high", "critical", True}:
            reasons.append("the source event indicates propagation risk")

        if reasons:
            return {
                "next_level": "graph",
                "reason": "; ".join(reasons),
            }
        return {
            "next_level": "stop",
            "reason": "No dependency propagation pattern detected",
        }

    def _should_execute_temporal(self, event: dict[str, Any], risk_after_flow: int) -> bool:
        return bool(
            risk_after_flow >= 55
            or self._has_repetitive_pattern(event)
            or event.get("anomaly_family") in {"temporal", "sequence", "repetitive"}
        )

    def _has_repetitive_pattern(self, event: dict[str, Any]) -> bool:
        flow_code = event.get("flow_code")
        api_id = self._safe_uuid(event.get("api_id"))
        actor_id = self._safe_uuid(event.get("actor_id") or event.get("consumer_actor_id"))
        row = self.database.fetch_one(
            """
            SELECT
                COUNT(*) FILTER (
                    WHERE detected_at >= NOW() - INTERVAL '5 minutes'
                      AND (%s::uuid IS NULL OR api_id = %s::uuid)
                )::int AS recent_api_anomalies,
                COUNT(*) FILTER (
                    WHERE detected_at >= NOW() - INTERVAL '10 minutes'
                      AND (%s::text IS NULL OR flow_code = %s::text)
                      AND detected_anomaly_type = 'SLA_BREACH'
                )::int AS recent_flow_sla,
                COUNT(*) FILTER (
                    WHERE detected_at >= NOW() - INTERVAL '5 minutes'
                      AND (%s::uuid IS NULL OR actor_id = %s::uuid)
                )::int AS recent_actor_anomalies
            FROM ai_analysis_results
            WHERE detected_anomaly_type <> 'NORMAL'
            """,
            (api_id, api_id, flow_code, flow_code, actor_id, actor_id),
        ) or {}
        error_row = self.database.fetch_one(
            """
            SELECT COUNT(*)::int AS successive_errors
            FROM (
                SELECT success, status_code
                FROM api_calls
                WHERE (%s::uuid IS NULL OR api_id = %s::uuid)
                  AND (%s::text IS NULL OR flow_code = %s::text)
                  AND (%s::uuid IS NULL OR consumer_actor_id = %s::uuid)
                ORDER BY called_at DESC
                LIMIT 3
            ) recent
            WHERE success = false OR status_code >= 400
            """,
            (api_id, api_id, flow_code, flow_code, actor_id, actor_id),
        ) or {}
        return bool(
            int(row.get("recent_api_anomalies") or 0) >= 3
            or int(row.get("recent_flow_sla") or 0) >= 5
            or int(row.get("recent_actor_anomalies") or 0) >= 3
            or int(error_row.get("successive_errors") or 0) >= 3
        )

    @staticmethod
    def _should_execute_graph(
        event: dict[str, Any], final_risk: int, severity: str | None
    ) -> bool:
        return bool(
            final_risk >= 75
            or severity in {"high", "critical"}
            or event.get("flow_criticality") == "critical"
            or event.get("producer_criticality") == "critical"
            or event.get("api_criticality") == "critical"
            or event.get("anomaly_family") in {"dependencies", "dependency", "platform", "graph"}
        )

    @staticmethod
    def _normal_confidence(analysis_trace: dict[str, dict[str, Any]]) -> float:
        event_confidence = analysis_trace.get("event", {}).get("confidence")
        return float(event_confidence) if event_confidence is not None else 0.72

    @staticmethod
    def _triage_confidence(analysis_trace: dict[str, dict[str, Any]]) -> float:
        anomaly_confidences = [
            float(trace.get("confidence") or 0)
            for trace in analysis_trace.values()
            if trace.get("executed") is True and trace.get("anomaly_detected") is True
        ]
        if anomaly_confidences:
            return min(anomaly_confidences)
        event_confidence = (analysis_trace.get("event") or {}).get("confidence")
        return float(event_confidence or 0)

    @staticmethod
    def _normalization_metadata(event: dict[str, Any]) -> dict[str, Any]:
        return {
            "status": "success",
            "latency_ms": event.get("latency_ms"),
            "sla_latency_ms": event.get("sla_latency_ms"),
            "latency_ratio": event.get("latency_ratio"),
            "status_code": event.get("status_code"),
            "success": event.get("success"),
            "flow_code": event.get("flow_code"),
            "api_code": event.get("api_code"),
        }

    @staticmethod
    def _incident_reason(
        risk_score: int,
        severity: str,
        anomaly_detected: bool,
        event: dict[str, Any],
    ) -> str:
        if risk_score >= 70:
            return "Final risk score reached the incident threshold"
        if severity in {"high", "critical"}:
            return "Final severity requires incident handling"
        if anomaly_detected and event.get("flow_criticality") in {"high", "critical"}:
            return "An anomaly affects a high-criticality flow"
        return "Risk below incident threshold"

    def _should_keep_anomaly(self, anomaly: dict[str, Any], event: dict[str, Any]) -> bool:
        if anomaly.get("analysis_type") != "historical":
            return True

        if int(anomaly.get("risk_score") or 0) < HISTORICAL_MIN_SCORE:
            return False

        key = self._historical_cooldown_key(anomaly, event)
        if key is None:
            return True

        expires_at = self._historical_cooldowns.get(key)
        return expires_at is None or expires_at <= datetime.now(timezone.utc)

    def _mark_historical_cooldown(self, anomaly: dict[str, Any], event: dict[str, Any]) -> None:
        if anomaly.get("analysis_type") != "historical":
            return

        key = self._historical_cooldown_key(anomaly, event)
        if key is not None:
            self._historical_cooldowns[key] = datetime.now(timezone.utc) + timedelta(seconds=HISTORICAL_COOLDOWN_SECONDS)

    @staticmethod
    def _historical_cooldown_key(anomaly: dict[str, Any], event: dict[str, Any]) -> tuple[str, str] | None:
        flow_key = event.get("flow_id") or event.get("flow_code")
        anomaly_type = anomaly.get("detected_anomaly_type")
        if not flow_key or not anomaly_type:
            return None
        return str(flow_key), str(anomaly_type)

    def _build_flow_result(
        self,
        flow_contract: dict[str, Any],
        event: dict[str, Any],
    ) -> dict[str, Any]:
        detected_type = str(flow_contract.get("detected_anomaly_type") or "FLOW_NORMAL")
        model = flow_contract.get("model") or {}
        workflow_metadata = flow_contract.get("workflow_metadata") or {}
        workflow_trace = workflow_metadata.get("analysis_trace") or {}
        flow_contributions = {
            level: int((workflow_trace.get(level) or {}).get("risk_contribution") or 0)
            for level in ("event", "flow")
        }
        flow_fused_risk = min(100, sum(flow_contributions.values()))
        flow_executed_levels = [
            level
            for level in ("event", "flow")
            if (workflow_trace.get(level) or {}).get("executed") is True
        ]
        flow_skipped_levels = [
            level
            for level in ("event", "flow")
            if (workflow_trace.get(level) or {}).get("status")
            in {"skipped", "warming_up", "unavailable", "failed"}
        ]
        flow_risk_fusion = {
            "status": "success",
            "executed_levels": flow_executed_levels,
            "skipped_levels": flow_skipped_levels,
            "final_risk_score": flow_fused_risk,
            "final_severity": self.scoring._severity(flow_fused_risk),
            "contributions": flow_contributions,
            "fusion_reason": "Event-Level and Flow-Level contributions were combined; skipped levels do not contribute.",
        }
        anomaly_detected = detected_type != "FLOW_NORMAL"
        event_id = self._safe_uuid(event.get("event_id"))
        decision = flow_contract.get("decision") or {
            "next_level": "stop",
            "reason": "No repetitive or sequential pattern detected",
        }
        metrics = flow_contract.get("metrics") or {}
        detected_at = event.get("timestamp") or datetime.now(timezone.utc).isoformat()

        return {
            "analysis_level": "flow",
            "event_id": event_id,
            "flow_code": event.get("flow_code"),
            "model_id": model.get("id"),
            "model_name": model.get("name"),
            "model_version": model.get("version"),
            "window": flow_contract.get("window") or "5m",
            "anomaly_detected": anomaly_detected,
            "anomaly_type": detected_type,
            "risk_score": int(flow_contract.get("risk_score") or 0),
            "severity": str(flow_contract.get("severity") or "low"),
            "confidence": float(flow_contract.get("confidence") or 0),
            "explanation": flow_contract.get("explanation") or "No anomaly detected at flow level",
            "recommendation": flow_contract.get("recommendation") or "No action required",
            "metrics": metrics,
            "decision": decision,
            "source_event_id": event_id,
            "source_event_type": event.get("event_type") or event.get("topic") or "unknown",
            "api_id": self._safe_uuid(event.get("api_id")),
            "actor_id": self._safe_uuid(event.get("actor_id") or event.get("consumer_actor_id")),
            "detected_anomaly_type": detected_type,
            "analysis_type": "realtime",
            "validation_status": flow_contract.get("validation_status") or "pending_review",
            "validation_source": "model_validation",
            "validation": {
                "analysis_level": "flow",
                "simulation_source": event.get("simulation_source"),
                "injected_anomaly_type": event.get("injected_anomaly_type"),
                "matched_simulation": False,
            },
            "metadata": {
                "topic": event.get("topic"),
                "event_id": event_id,
                "analysis_level": "flow",
                "flow_code": event.get("flow_code"),
                "api_code": event.get("api_code"),
                "consumer_code": event.get("consumer_code"),
                "producer_code": event.get("producer_code"),
                "model_id": model.get("id"),
                "model_name": model.get("name"),
                "model_version": model.get("version"),
                "model": {
                    **model,
                    "id": model.get("id"),
                    "name": model.get("name"),
                    "version": model.get("version"),
                },
                "window": flow_contract.get("window") or "5m",
                "anomaly_detected": anomaly_detected,
                "anomaly_type": detected_type,
                "risk_score": int(flow_contract.get("risk_score") or 0),
                "severity": str(flow_contract.get("severity") or "low"),
                "confidence": float(flow_contract.get("confidence") or 0),
                "explanation": flow_contract.get("explanation") or "No anomaly detected at flow level",
                "recommendation": flow_contract.get("recommendation") or "No action required",
                "metrics": metrics,
                "decision": decision,
                "analysis_trace": workflow_trace,
                "risk_fusion": flow_risk_fusion,
                "triage_decision": workflow_metadata.get("triage_decision"),
                "secondary_anomalies": flow_contract.get("secondary_anomalies") or [],
            },
            "detected_at": detected_at,
        }

    def _build_temporal_result(
        self,
        temporal_contract: dict[str, Any],
        event: dict[str, Any],
    ) -> dict[str, Any]:
        detected_type = str(
            temporal_contract.get("detected_anomaly_type") or "TEMPORAL_NORMAL"
        )
        model = temporal_contract.get("model") or {}
        workflow_metadata = temporal_contract.get("workflow_metadata") or {}
        workflow_trace = workflow_metadata.get("analysis_trace") or {}
        anomaly_detected = detected_type != "TEMPORAL_NORMAL"
        event_id = self._safe_uuid(event.get("event_id"))
        decision = temporal_contract.get("decision") or {
            "next_level": "stop",
            "reason": "No dependency propagation pattern detected",
        }
        metrics = temporal_contract.get("metrics") or {}
        detected_at = event.get("timestamp") or datetime.now(timezone.utc).isoformat()
        explanation = temporal_contract.get(
            "explanation"
        ) or "No temporal anomaly detected in the recent 15-minute window"
        recommendation = temporal_contract.get("recommendation") or "No action required"

        return {
            "analysis_level": "temporal",
            "event_id": event_id,
            "flow_code": event.get("flow_code"),
            "api_code": event.get("api_code"),
            "model_id": model.get("id"),
            "model_name": model.get("name"),
            "model_version": model.get("version"),
            "window": temporal_contract.get("window") or "15m",
            "anomaly_detected": anomaly_detected,
            "anomaly_type": detected_type,
            "risk_score": int(temporal_contract.get("risk_score") or 0),
            "severity": str(temporal_contract.get("severity") or "low"),
            "confidence": float(temporal_contract.get("confidence") or 0),
            "explanation": explanation,
            "recommendation": recommendation,
            "metrics": metrics,
            "decision": decision,
            "source_event_id": event_id,
            "source_event_type": event.get("event_type") or event.get("topic") or "unknown",
            "api_id": self._safe_uuid(event.get("api_id")),
            "actor_id": self._safe_uuid(
                event.get("actor_id") or event.get("consumer_actor_id")
            ),
            "detected_anomaly_type": detected_type,
            "analysis_type": "realtime",
            "validation_status": temporal_contract.get(
                "validation_status"
            ) or "pending_review",
            "validation_source": "model_validation",
            "validation": {
                "analysis_level": "temporal",
                "simulation_source": event.get("simulation_source"),
                "injected_anomaly_type": event.get("injected_anomaly_type"),
                "matched_simulation": False,
            },
            "metadata": {
                "topic": event.get("topic"),
                "event_id": event_id,
                "analysis_level": "temporal",
                "flow_code": event.get("flow_code"),
                "api_code": event.get("api_code"),
                "consumer_code": event.get("consumer_code"),
                "producer_code": event.get("producer_code"),
                "model_id": model.get("id"),
                "model_name": model.get("name"),
                "model_version": model.get("version"),
                "model": {
                    **model,
                    "id": model.get("id"),
                    "name": model.get("name"),
                    "version": model.get("version"),
                },
                "window": temporal_contract.get("window") or "15m",
                "anomaly_detected": anomaly_detected,
                "anomaly_type": detected_type,
                "risk_score": int(temporal_contract.get("risk_score") or 0),
                "severity": str(temporal_contract.get("severity") or "low"),
                "confidence": float(temporal_contract.get("confidence") or 0),
                "explanation": explanation,
                "recommendation": recommendation,
                "metrics": metrics,
                "decision": decision,
                "analysis_trace": workflow_trace,
                "risk_fusion": workflow_metadata.get("risk_fusion"),
                "triage_decision": workflow_metadata.get("triage_decision"),
                "secondary_anomalies": temporal_contract.get("secondary_anomalies")
                or [],
            },
            "detected_at": detected_at,
        }

    def _build_graph_result(
        self,
        graph_contract: dict[str, Any],
        event: dict[str, Any],
    ) -> dict[str, Any]:
        detected_type = str(graph_contract.get("detected_anomaly_type") or "GRAPH_NORMAL")
        model = graph_contract.get("model") or {}
        workflow_metadata = graph_contract.get("workflow_metadata") or {}
        workflow_trace = workflow_metadata.get("analysis_trace") or {}
        anomaly_detected = detected_type != "GRAPH_NORMAL"
        event_id = self._safe_uuid(event.get("event_id"))
        decision = graph_contract.get("decision") or {
            "next_level": "stop",
            "reason": "Graph-Level is the final dependency propagation analysis stage",
        }
        metrics = graph_contract.get("metrics") or {}
        impacted_entities = graph_contract.get("impacted_entities") or {
            "producers": [],
            "consumers": [],
            "apis": [],
            "flows": [],
        }
        detected_at = event.get("timestamp") or datetime.now(timezone.utc).isoformat()
        explanation = graph_contract.get(
            "explanation"
        ) or "No dependency propagation anomaly detected in the recent 30-minute graph window"
        recommendation = graph_contract.get("recommendation") or "No action required"

        return {
            "analysis_level": "graph",
            "event_id": event_id,
            "flow_code": event.get("flow_code"),
            "api_code": event.get("api_code"),
            "model_id": model.get("id"),
            "model_name": model.get("name"),
            "model_version": model.get("version"),
            "window": graph_contract.get("window") or "30m",
            "anomaly_detected": anomaly_detected,
            "anomaly_type": detected_type,
            "risk_score": int(graph_contract.get("risk_score") or 0),
            "severity": str(graph_contract.get("severity") or "low"),
            "confidence": float(graph_contract.get("confidence") or 0),
            "explanation": explanation,
            "recommendation": recommendation,
            "metrics": metrics,
            "impacted_entities": impacted_entities,
            "decision": decision,
            "source_event_id": event_id,
            "source_event_type": event.get("event_type") or event.get("topic") or "unknown",
            "api_id": self._safe_uuid(event.get("api_id")),
            "actor_id": self._safe_uuid(
                event.get("actor_id") or event.get("consumer_actor_id")
            ),
            "detected_anomaly_type": detected_type,
            "analysis_type": "realtime",
            "validation_status": graph_contract.get("validation_status") or "pending_review",
            "validation_source": "model_validation",
            "validation": {
                "analysis_level": "graph",
                "simulation_source": event.get("simulation_source"),
                "injected_anomaly_type": event.get("injected_anomaly_type"),
                "matched_simulation": False,
            },
            "metadata": {
                "topic": event.get("topic"),
                "event_id": event_id,
                "analysis_level": "graph",
                "flow_code": event.get("flow_code"),
                "api_code": event.get("api_code"),
                "consumer_code": event.get("consumer_code"),
                "producer_code": event.get("producer_code"),
                "model_id": model.get("id"),
                "model_name": model.get("name"),
                "model_version": model.get("version"),
                "model": {
                    **model,
                    "id": model.get("id"),
                    "name": model.get("name"),
                    "version": model.get("version"),
                },
                "window": graph_contract.get("window") or "30m",
                "anomaly_detected": anomaly_detected,
                "anomaly_type": detected_type,
                "risk_score": int(graph_contract.get("risk_score") or 0),
                "severity": str(graph_contract.get("severity") or "low"),
                "confidence": float(graph_contract.get("confidence") or 0),
                "explanation": explanation,
                "recommendation": recommendation,
                "metrics": metrics,
                "impacted_entities": impacted_entities,
                "decision": decision,
                "analysis_trace": workflow_trace,
                "risk_fusion": workflow_metadata.get("risk_fusion"),
                "triage_decision": workflow_metadata.get("triage_decision"),
                "secondary_anomalies": graph_contract.get("secondary_anomalies") or [],
            },
            "detected_at": detected_at,
        }

    def _build_result(self, anomaly: dict[str, Any], event: dict[str, Any]) -> dict[str, Any]:
        detected_type = anomaly["detected_anomaly_type"]
        injected_type = event.get("injected_anomaly_type")
        expected_detection = SIMULATION_PRIMARY_AI.get(injected_type or "")
        detected_types = self._detected_types_for_validation(anomaly)
        matched_simulation = self._matches_expected_detection(detected_types, expected_detection)
        model = anomaly.get("model") or {}
        decision = anomaly.get("decision") or {
            "next_level": "stop",
            "reason": "Event risk is low and no flow context is required",
        }
        event_id = self._safe_uuid(event.get("event_id"))
        analysis_level = "event"
        anomaly_detected = detected_type != "NORMAL"

        return {
            "analysis_level": analysis_level,
            "event_id": event_id,
            "model_id": model.get("id"),
            "model_name": model.get("name"),
            "model_version": model.get("version"),
            "anomaly_detected": anomaly_detected,
            "anomaly_type": detected_type,
            "risk_score": int(anomaly.get("risk_score") or 0),
            "severity": str(anomaly.get("severity") or "low"),
            "confidence": float(anomaly.get("confidence") or 0),
            "explanation": anomaly.get("explanation") or "No anomaly detected at event level",
            "recommendation": anomaly.get("recommendation") or "No action required",
            "flow_code": event.get("flow_code"),
            "api_code": event.get("api_code"),
            "consumer_code": event.get("consumer_code"),
            "producer_code": event.get("producer_code"),
            "decision": decision,
            "source_event_id": event_id,
            "source_event_type": event.get("event_type") or event.get("topic") or "unknown",
            "api_id": self._safe_uuid(event.get("api_id")),
            "actor_id": self._safe_uuid(event.get("actor_id") or event.get("consumer_actor_id")),
            "detected_anomaly_type": detected_type,
            "analysis_type": anomaly.get("analysis_type", "realtime"),
            "validation_status": anomaly.get("validation_status") or "pending_review",
            "validation_source": "model_validation",
            "validation": {
                "simulation_source": event.get("simulation_source"),
                "injected_anomaly_type": injected_type,
                "analysis_level": analysis_level,
                "anomaly_family": event.get("anomaly_family"),
                "expected_detection": expected_detection or None,
                "matched_simulation": bool(injected_type and matched_simulation),
                "matched_detection_scope": "primary_or_secondary" if matched_simulation else "primary_only",
                "detected_candidates": sorted(detected_types),
            },
            "metadata": {
                "topic": event.get("topic"),
                "correlation_id": event.get("correlation_id"),
                "event_sequence_number": event.get("event_sequence_number"),
                "scenario_id": event.get("scenario_id"),
                "simulation_mode": event.get("simulation_mode"),
                "program_code": event.get("program_code"),
                "api_code": event.get("api_code"),
                "consumer_code": event.get("consumer_code"),
                "producer_code": event.get("producer_code"),
                "analysis_level": analysis_level,
                "event_id": event_id,
                "model_id": model.get("id"),
                "model_name": model.get("name"),
                "model_version": model.get("version"),
                "anomaly_detected": anomaly_detected,
                "anomaly_type": detected_type,
                "risk_score": int(anomaly.get("risk_score") or 0),
                "severity": str(anomaly.get("severity") or "low"),
                "confidence": float(anomaly.get("confidence") or 0),
                "explanation": anomaly.get("explanation") or "No anomaly detected at event level",
                "recommendation": anomaly.get("recommendation") or "No action required",
                "flow_code": event.get("flow_code"),
                "decision": decision,
                "anomaly_family": event.get("anomaly_family"),
                "anomaly_scope": event.get("anomaly_scope"),
                "anomaly_origin": event.get("anomaly_origin"),
                "anomaly_correlation_id": event.get("anomaly_correlation_id"),
                "scenario_step": event.get("scenario_step"),
                "scenario_total_steps": event.get("scenario_total_steps"),
                "anomaly_indicators": event.get("anomaly_indicators"),
                "anomaly_impacts": event.get("anomaly_impacts"),
                "latency_ms": event.get("latency_ms"),
                "sla_latency_ms": event.get("sla_latency_ms"),
                "latency_ratio": event.get("latency_ratio"),
                "traffic_ratio": event.get("traffic_ratio"),
                "expected_calls_per_minute": event.get("expected_calls_per_minute"),
                "simulated_calls_per_minute": event.get("simulated_calls_per_minute"),
                "ingestion_delay_ms": event.get("ingestion_delay_ms"),
                "status_code": event.get("status_code"),
                "success": event.get("success"),
                "error_type": event.get("error_type"),
                "source_ip": event.get("source_ip"),
                "api_criticality": event.get("api_criticality"),
                "producer_criticality": event.get("producer_criticality"),
                "consumer_criticality": event.get("consumer_criticality"),
                "flow_criticality": event.get("flow_criticality"),
                "model": {
                    **model,
                    "id": model.get("id"),
                    "name": model.get("name"),
                    "version": model.get("version"),
                },
                "selected_model_id": model.get("id"),
                "selected_model_name": model.get("name"),
                "selected_model_version": model.get("version"),
                "secondary_anomalies": anomaly.get("secondary_anomalies", []),
                **(anomaly.get("workflow_metadata") or {}),
            },
            "detected_at": event.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _select_primary(anomalies: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        if not anomalies:
            return None, []

        ordered = sorted(
            anomalies,
            key=lambda item: (
                ANOMALY_PRIORITY.get(item["detected_anomaly_type"], 100),
                0 if item.get("analysis_type") == "realtime" else 1,
                -float(item.get("confidence") or 0),
            ),
        )
        return ordered[0], ordered[1:]

    @staticmethod
    def _deduplicate(anomalies: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[tuple[str, str]] = set()
        unique: list[dict[str, Any]] = []
        for anomaly in anomalies:
            key = (anomaly["detected_anomaly_type"], anomaly.get("analysis_type", "realtime"))
            if key not in seen:
                seen.add(key)
                unique.append(anomaly)
        return unique

    @staticmethod
    def _detected_types_for_validation(anomaly: dict[str, Any]) -> set[str]:
        detected_types = {str(anomaly["detected_anomaly_type"])}
        for secondary in anomaly.get("secondary_anomalies") or []:
            anomaly_type = secondary.get("detected_anomaly_type")
            if anomaly_type:
                detected_types.add(str(anomaly_type))
        return detected_types

    @staticmethod
    def _matches_expected_detection(detected_types: set[str], expected_detection: str | None) -> bool:
        if not expected_detection:
            return False
        return expected_detection in detected_types

    @staticmethod
    def _safe_uuid(value: Any) -> str | None:
        if not value:
            return None
        return str(value)
