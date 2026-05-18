export const AI_API_URL = process.env.NEXT_PUBLIC_AI_API_URL || "/api/ai";
export const BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL || "/api/backend";

export type Severity = "low" | "medium" | "high" | "critical";

export type AiResult = {
  id: string;
  source_event_id: string | null;
  source_event_type: string;
  flow_code: string | null;
  api_id: string | null;
  actor_id: string | null;
  detected_anomaly_type: string;
  risk_score: number;
  severity: Severity;
  confidence: number | null;
  explanation: string | null;
  recommendation: string | null;
  analysis_type: string;
  validation: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  detected_at: string;
  created_at: string;
};

export type AiSummary = {
  total_results: number;
  critical_count: number;
  high_count: number;
  realtime_count: number;
  historical_count: number;
  avg_risk_score: string | number | null;
  last_detection_at: string | null;
  by_type: Array<{ detected_anomaly_type: string; count: number }>;
};

export type BackendSummary = {
  total_api_calls: number;
  total_errors: number;
  avg_latency_ms: string | number;
  sla_breaches: number;
  total_audit_denied: number;
  total_simulated_anomalies?: number;
  platform_level_events?: number;
  graph_level_events?: number;
};

export type FlowMetric = {
  flow_code: string;
  flow_name: string;
  count: number;
  avg_latency_ms: string | number;
  error_count: number;
  sla_breach_count: number;
  anomaly_count?: number;
  flow_criticality?: string | null;
};

export type ApiCallEvent = {
  id: string;
  flow_code: string | null;
  api_code?: string | null;
  consumer_code?: string | null;
  producer_code?: string | null;
  program_code?: string | null;
  endpoint_path?: string | null;
  method?: string | null;
  status_code: number | null;
  latency_ms: number | null;
  sla_latency_ms?: number | null;
  expected_calls_per_minute?: number | null;
  success: boolean;
  error_type?: string | null;
  is_sla_breach: boolean;
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
  correlation_id?: string | null;
  called_at: string;
};

export type AuditEvent = {
  id: string;
  flow_code: string | null;
  api_code?: string | null;
  payload_api_code?: string | null;
  actor_code?: string | null;
  consumer_code?: string | null;
  producer_code?: string | null;
  program_code?: string | null;
  action: string | null;
  outcome: string | null;
  source_ip: string | null;
  anomaly_type?: string | null;
  anomaly_family?: string | null;
  analysis_level?: string | null;
  anomaly_scope?: string | null;
  anomaly_correlation_id?: string | null;
  scenario_id?: string | null;
  simulation_mode?: string | null;
  correlation_id?: string | null;
  event_timestamp: string;
  technical_context?: Record<string, unknown> | null;
};

export type ModelTrainingStatus = {
  status: string;
  trained_at?: string;
  sample_count?: number;
  label_counts?: Record<string, number>;
  trained_models?: string[];
  metrics?: {
    random_forest_classifier?: {
      accuracy?: number;
      classification_report?: Record<string, { precision?: number; recall?: number; "f1-score"?: number } | number>;
    };
  };
  model_dir?: string;
  models?: string[];
};

export type AiModelInfo = {
  id: string;
  name: string;
  type: string;
  objective: string;
  status: string;
  developed_at: string;
  last_improvement_at: string;
  last_training_at?: string | null;
  version: string;
  description?: string;
  use_case?: string;
  data_sources?: string[];
  training_period?: string;
  features?: string[];
  sample_count: number;
  detectable_labels: string[];
  improvements?: Array<{ date: string; modification: string; impact: string }>;
  metrics: Record<string, unknown>;
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function fetchAiResults(limit = 100) {
  return readJson<AiResult[]>(`${AI_API_URL}/ai/results?limit=${limit}`);
}

export function fetchAiSummary() {
  return readJson<AiSummary>(`${AI_API_URL}/ai/summary`);
}

export function fetchBackendSummary() {
  return readJson<BackendSummary>(`${BACKEND_API_URL}/metrics/summary`);
}

export function fetchFlowMetrics() {
  return readJson<FlowMetric[]>(`${BACKEND_API_URL}/metrics/by-flow`);
}

export function fetchApiEvents(limit = 100) {
  return readJson<ApiCallEvent[]>(`${BACKEND_API_URL}/events/api-calls?limit=${limit}`);
}

export function fetchAuditEvents(limit = 100) {
  return readJson<AuditEvent[]>(`${BACKEND_API_URL}/events/audit-events?limit=${limit}`);
}

export function fetchModelTrainingStatus() {
  return readJson<ModelTrainingStatus>(`${AI_API_URL}/ai/models/status`);
}

export function fetchAiModels() {
  return readJson<AiModelInfo[]>(`${AI_API_URL}/ai-models`);
}

export function fetchAiModel(id: string) {
  return readJson<AiModelInfo>(`${AI_API_URL}/ai-models/${id}`);
}
