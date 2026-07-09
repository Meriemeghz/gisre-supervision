export const ANOMALY_FAMILIES = [
  "Performance",
  "Fiabilité",
  "Trafic",
  "Sécurité",
  "Comportement",
  "Dépendances",
  "Traçabilité",
  "Plateforme",
  "Autre",
] as const;

export type AnomalyFamily = typeof ANOMALY_FAMILIES[number];

export const ANOMALY_FAMILY_COLORS: Record<AnomalyFamily, string> = {
  Performance: "#f59e0b",
  Fiabilité: "#ef4444",
  Trafic: "#0ea5e9",
  Sécurité: "#dc2626",
  Comportement: "#8b5cf6",
  Dépendances: "#ec4899",
  Traçabilité: "#64748b",
  Plateforme: "#14b8a6",
  Autre: "#94a3b8",
};

const FAMILY_BY_ANOMALY: Record<string, AnomalyFamily> = createFamilyMap({
  Performance: [
    "sla_breach", "response_time_spike", "latency_drift",
    "gradual_performance_degradation", "sla_instability", "provider_slowdown",
    "slow_api_endpoint", "partial_provider_degradation", "flow_sla_degradation",
    "flow_latency_drift", "sla_breach_trend", "dl_gru_sequence",
    "dl_flow_sequence",
  ],
  Fiabilité: [
    "high_error_rate", "timeout_burst", "provider_unreachable",
    "repeated_retry_pattern", "service_flapping", "intermittent_failure",
    "server_error", "timeout", "flow_error_rate_spike",
    "flow_provider_degradation", "flow_intermittent_failures",
    "flow_health_degradation", "critical_flow_instability",
    "error_rate_increase", "intermittent_instability", "recovery_failure",
    "critical_provider_instability",
  ],
  Trafic: [
    "traffic_spike", "traffic_drop", "unexpected_volume", "consumer_overuse",
    "silent_flow", "off_hours_activity", "flow_traffic_spike", "flow_traffic_drop",
    "flow_consumer_abuse", "business_hours_deviation", "traffic_asymmetry",
    "api_underuse",
  ],
  Sécurité: [
    "authentication_abuse", "access_denied_anomaly", "access_denied",
    "rate_limit_exceeded", "unauthorized_api_attempt", "token_failure_pattern",
    "endpoint_enumeration", "privilege_misuse",
  ],
  Comportement: [
    "consumer_behavior_shift", "consumer_behaviour_shift", "consumer_profile_drift",
    "unusual_api_usage", "rare_api_access", "rare_flow_activation",
    "workflow_sequence_anomaly", "behavioral_outlier", "behavioural_outlier",
    "ml_flow_cluster_outlier", "dl_flow_autoencoder", "event_outlier_signal",
    "event_isolation_forest_signal", "event_lof_signal", "event_autoencoder_signal",
    "dl_lstm_sequence", "transformer_tranad_anomaly",
  ],
  Dépendances: [
    "cascade_failure", "dependent_service_failure", "multi_consumer_impact",
    "shared_provider_failure", "dependency_hotspot", "dependency_chain_latency",
    "cross_flow_propagation", "synchronized_failure_pattern",
    "graph_connectivity_anomaly", "graph_gdn_anomaly", "graph_mtad_gat_anomaly",
    "graph_topology_anomaly",
  ],
  Traçabilité: [
    "audit_gap", "missing_latency_metric", "duplicate_event", "out_of_order_event",
    "missing_correlation_id", "delayed_event_ingestion", "corrupted_event_payload",
  ],
  Plateforme: [
    "interoperability_degradation", "metric_collection_failure",
    "event_pipeline_congestion", "platform_health_degradation",
    "global_risk_elevation", "hybrid_risk_signal", "monitoring_blind_spot",
    "critical_service_saturation", "global_security_alert", "stream_processing_delay",
  ],
});

export function getAnomalyFamily(anomalyType?: string | null): AnomalyFamily {
  if (!anomalyType) return "Autre";
  return FAMILY_BY_ANOMALY[normalizeAnomalyType(anomalyType)] || "Autre";
}

function createFamilyMap(groups: Partial<Record<AnomalyFamily, string[]>>) {
  return Object.entries(groups).reduce<Record<string, AnomalyFamily>>((mapping, [family, anomalies]) => {
    anomalies?.forEach((anomaly) => {
      mapping[normalizeAnomalyType(anomaly)] = family as AnomalyFamily;
    });
    return mapping;
  }, {});
}

function normalizeAnomalyType(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
