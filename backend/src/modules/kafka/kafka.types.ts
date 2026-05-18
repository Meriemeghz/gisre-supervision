export type KafkaTopic = 'gisre.api.calls' | 'gisre.audit.events';

export interface BaseKafkaEvent {
  event_id?: string;
  event_type: string;
  flow_id?: string;
  api_id?: string;
  correlation_id?: string;
  scenario_type?: string;
  injected_anomaly_type?: string | null;
  rule_code?: string | null;
  rule_description?: string | null;
  simulation_source?: string;
  timestamp?: string;
  flow_code?: string | null;
  api_code?: string | null;
  consumer_code?: string | null;
  producer_code?: string | null;
  program_code?: string | null;
  sla_latency_ms?: number | null;
  expected_calls_per_minute?: number | null;
  api_criticality?: string | null;
  consumer_criticality?: string | null;
  producer_criticality?: string | null;
  flow_criticality?: string | null;
  is_anomaly?: boolean;
  anomaly_type?: string | null;
  anomaly_family?: string | null;
  analysis_level?: string | null;
  anomaly_scope?: string | null;
  anomaly_correlation_id?: string | null;
  scenario_id?: string | null;
  simulation_mode?: string | null;
  event_sequence_number?: number | null;
  ingestion_delay_ms?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface ApiCallKafkaEvent extends BaseKafkaEvent {
  event_type: 'api_call';
  consumer_actor_id?: string;
  producer_actor_id?: string;
  method?: string;
  endpoint_path?: string;
  status_code?: number;
  latency_ms?: number;
  success?: boolean;
  error_type?: string | null;
  error_code?: string | null;
  source_ip?: string | null;
  gateway_node?: string | null;
  is_sla_breach?: boolean;
}

export interface AuditKafkaEvent extends BaseKafkaEvent {
  event_type: 'audit_event';
  actor_id?: string;
  action?: string;
  outcome?: string;
  source_ip?: string | null;
}
