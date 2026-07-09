const RAW_AI_API_URL = process.env.NEXT_PUBLIC_AI_API_URL || "/api/ai";
const RAW_BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL || "/api/backend";

function browserSafeApiUrl(value: string, proxyPath: string) {
  if (typeof window === "undefined") return value;
  try {
    const url = new URL(value, window.location.origin);
    if (["backend", "ai-layer"].includes(url.hostname)) {
      return proxyPath;
    }
  } catch {
    return proxyPath;
  }
  return value;
}

export const AI_API_URL = browserSafeApiUrl(RAW_AI_API_URL, "/api/ai");
export const BACKEND_API_URL = browserSafeApiUrl(RAW_BACKEND_API_URL, "/api/backend");

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
  validation_status?: string | null;
  validated_by?: string | null;
  validated_at?: string | null;
  validation_comment?: string | null;
  validation_source?: string | null;
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
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    response = await fetch(url, { cache: "no-store", signal: controller.signal });
  } catch (error) {
    throw new Error(`endpoint unreachable (${url}): ${error instanceof Error ? error.message : "fetch failed"}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(formatHttpError(url, response.status, response.statusText, detail));
  }
  return response.json() as Promise<T>;
}

function formatHttpError(url: string, status: number, statusText: string, detail: string) {
  const parsed = parseErrorDetail(detail);
  if (status === 404) {
    return `endpoint not found (${url})`;
  }
  if (status >= 500) {
    return `backend unavailable (${status}) on ${url}: ${parsed || statusText}`;
  }
  return `${status} ${statusText}${parsed ? `: ${parsed}` : ""}`;
}

function parseErrorDetail(detail: string) {
  if (!detail) return "";
  try {
    const payload = JSON.parse(detail) as { detail?: unknown; error?: unknown; message?: unknown; target?: unknown };
    const message = payload.message || payload.detail || payload.error;
    const target = typeof payload.target === "string" ? ` target=${payload.target}` : "";
    return `${typeof message === "string" ? message : detail}${target}`;
  } catch {
    return detail;
  }
}

export function fetchAiResults(limit = 100) {
  return readJson<AiResult[]>(`${AI_API_URL}/ai/results?limit=${limit}`).then((results) => results.filter(isAnomalyResult));
}

export function fetchAiWorkflowResults(limit = 200) {
  return readJson<AiResult[]>(`${AI_API_URL}/ai/results?limit=${limit}&include_normal=true`);
}

export function fetchAiSummary() {
  return readJson<AiSummary>(`${AI_API_URL}/ai/summary`).then((summary) => ({
    ...summary,
    by_type: summary.by_type.filter((item) => item.detected_anomaly_type !== "NORMAL"),
  }));
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

export type ValidationSummary = {
  unverified: number;
  pending_review: number;
  confirmed: number;
  partial: number;
  false_positive: number;
  ignored: number;
  resolved: number;
  auto_confirmed: number;
  auto_dismissed: number;
  pending_review_total: number;
  reviewed: number;
};

export type IncidentInterpretResult = {
  configured: boolean;
  message?: string;
  diagnosis?: string;
  is_likely_real?: boolean;
  confidence?: "high" | "medium" | "low";
  risk_assessment?: string;
  action_plan?: string[];
  confidence_note?: string;
};

export type DemoValidationSeedResult = {
  requested_limit: number;
  updated: number;
  validation_source: "demo_seed";
  validated_by: "demo_supervisor";
  include_demo_feedback: boolean;
  counts: Record<string, number>;
  results: AiResult[];
};

export function fetchPendingReviewResults(limit = 100) {
  return readJson<AiResult[]>(`${AI_API_URL}/ai/results/pending-review?limit=${limit}`);
}

export function fetchValidationSummary() {
  return readJson<ValidationSummary>(`${AI_API_URL}/ai/results/validation-summary`);
}

export async function generateDemoValidations(limit: 20 | 50 | 100): Promise<DemoValidationSeedResult> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    response = await fetch(`${AI_API_URL}/results/demo-validations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`demo validation endpoint unreachable: ${error instanceof Error ? error.message : "fetch failed"}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(formatHttpError("/results/demo-validations", response.status, response.statusText, detail));
  }
  return response.json() as Promise<DemoValidationSeedResult>;
}

export async function patchResultValidation(
  id: string,
  status: string,
  comment: string | null,
  validatedBy: string,
): Promise<AiResult> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    response = await fetch(`${AI_API_URL}/results/${id}/validation`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ validation_status: status, validation_comment: comment, validated_by: validatedBy }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`validation endpoint unreachable: ${error instanceof Error ? error.message : "fetch failed"}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(formatHttpError(`/results/${id}/validation`, response.status, response.statusText, detail));
  }
  return response.json() as Promise<AiResult>;
}

export async function postIncidentInterpret(resultId: string): Promise<IncidentInterpretResult> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    response = await fetch(`${AI_API_URL}/ai/results/${resultId}/interpret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`AI assistant unreachable: ${error instanceof Error ? error.message : "fetch failed"}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(formatHttpError(`/ai/results/${resultId}/interpret`, response.status, response.statusText, detail));
  }
  return response.json() as Promise<IncidentInterpretResult>;
}

function isAnomalyResult(result: AiResult): boolean {
  return result.detected_anomaly_type !== "NORMAL" && Number(result.risk_score || 0) > 0;
}
