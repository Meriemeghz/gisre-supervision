import type { AiResult, Severity } from "@/lib/api";

export type WorkflowStepStatus =
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "failed"
  | "review"
  | "legacy"
  | "skipped"
  | "warming_up"
  | "unavailable";

export type WorkflowStepId =
  | "kafka_received"
  | "backend_ingestion"
  | "postgres_persistence"
  | "ai_analysis"
  | "anomaly_detection"
  | "risk_scoring"
  | "incident_creation"
  | "recommendation_generation"
  | "human_review"
  | "resolution_closure";

export type WorkflowLiveState = "NORMAL" | "WARNING" | "CRITICAL";

export type WorkflowLiveEvent = {
  id: string;
  source: "api_call" | "audit_event";
  timestamp: string;
  flow_code: string | null;
  api_code: string | null;
  consumer: string | null;
  provider: string | null;
  actor: string | null;
  latency_ms: number | null;
  status_code: number | null;
  success: boolean | null;
  is_sla_breach: boolean;
  correlation_id: string | null;
  state: WorkflowLiveState;
  anomalyType: string | null;
  aiResult: AiResult | null;
  raw: Record<string, unknown>;
  receivedAt?: number;
};

export type WorkflowStep = {
  id: WorkflowStepId;
  name: string;
  status: WorkflowStepStatus;
  timestamp: string | null;
  durationMs: number | null;
  message: string;
  source: string;
};

export type WorkflowItem = {
  id: string;
  event_id: string;
  source: WorkflowLiveEvent["source"];
  api_name: string | null;
  flow_code: string | null;
  consumer_code: string | null;
  producer_code: string | null;
  anomaly_type: string | null;
  risk_score: number | null;
  severity: Severity | null;
  confidence: number | null;
  explanation: string | null;
  recommendation: string | null;
  validation_status: string;
  timestamp: string;
  status: WorkflowStepStatus;
  steps: WorkflowStep[];
  raw: WorkflowLiveEvent;
};

export type WorkflowConnectionStatus = "connecting" | "live" | "error";

export type AnalysisTraceStatus =
  | "success"
  | "warning"
  | "failed"
  | "skipped"
  | "warming_up"
  | "unavailable";

export type AnalysisLevelTrace = {
  status?: AnalysisTraceStatus;
  executed?: boolean;
  reason?: string | null;
  skip_reason?: string | null;
  selected_model_id?: string | null;
  selected_model_name?: string | null;
  selected_model_version?: string | null;
  anomaly_detected?: boolean;
  anomaly_type?: string | null;
  confidence?: number | null;
  risk_contribution?: number | null;
  decision_next_level?: "stop" | "flow" | "temporal" | "graph" | null;
  decision_reason?: string | null;
  routing_trigger?:
    | "EVENT_ANOMALY"
    | "RISK_THRESHOLD"
    | "FLOW_CRITICALITY"
    | "API_CRITICALITY"
    | "MANUAL_POLICY"
    | "FLOW_ANOMALY"
    | "FLOW_RISK_THRESHOLD"
    | "REPETITIVE_PATTERN"
    | "SEQUENTIAL_PATTERN"
    | "NONE"
    | null;
};

export type FlowAnalysisMetrics = {
  total_calls?: number;
  success_count?: number;
  error_count?: number;
  success_rate?: number;
  error_rate?: number;
  avg_latency_ms?: number;
  p95_latency_ms?: number;
  sla_breach_count?: number;
  sla_breach_rate?: number;
  timeout_count?: number;
  server_error_count?: number;
  consumer_count?: number;
  producer_count?: number;
  traffic_change_rate?: number;
  latency_trend?: "stable" | "increasing" | "decreasing" | string;
  flow_criticality?: string;
  [key: string]: unknown;
};

export type EventAnalysisTrace = AnalysisLevelTrace;

export type FlowAnalysisTrace = AnalysisLevelTrace & {
  window?: string | null;
  metrics?: FlowAnalysisMetrics | null;
};

export type TemporalAnalysisMetrics = {
  event_count?: number;
  anomaly_count?: number;
  avg_latency_ms?: number;
  latency_slope?: number;
  error_rate_trend?: string;
  sla_breach_trend?: string;
  dominant_anomaly_type?: string;
  pattern_repetition_score?: number;
  [key: string]: unknown;
};

export type TemporalAnalysisTrace = AnalysisLevelTrace & {
  window?: string | null;
  metrics?: TemporalAnalysisMetrics | null;
};

export type GraphAnalysisMetrics = {
  nodes_count?: number;
  edges_count?: number;
  impacted_producers_count?: number;
  impacted_consumers_count?: number;
  impacted_apis_count?: number;
  impacted_flows_count?: number;
  shared_provider_score?: number;
  cascade_risk_score?: number;
  dependency_hotspot_score?: number;
  propagation_depth?: number;
  dominant_impacted_node?: string | null;
  dominant_anomaly_type?: string | null;
  [key: string]: unknown;
};

export type GraphAnalysisTrace = AnalysisLevelTrace & {
  window?: string | null;
  metrics?: GraphAnalysisMetrics | null;
  impacted_entities?: {
    producers?: unknown[];
    consumers?: unknown[];
    apis?: unknown[];
    flows?: unknown[];
  } | null;
};

export type AnalysisTrace = {
  event?: EventAnalysisTrace;
  flow?: FlowAnalysisTrace;
  temporal?: TemporalAnalysisTrace;
  graph?: GraphAnalysisTrace;
};

export type RiskFusionMetadata = {
  status?: AnalysisTraceStatus;
  final_risk_score?: number | null;
  final_severity?: Severity | string | null;
  contributions?: {
    event?: number | null;
    flow?: number | null;
    temporal?: number | null;
    graph?: number | null;
  };
  executed_levels?: string[];
  skipped_levels?: string[];
  fusion_reason?: string | null;
};
