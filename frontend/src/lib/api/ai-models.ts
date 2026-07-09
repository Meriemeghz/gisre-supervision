import { AI_API_URL } from "@/lib/api";
import type {
  ActivationPolicyLevel,
  AiModel,
  AiModelImprovement,
  AiModelMetrics,
  AiModelResult,
  AnalysisLevel,
  DriftPoint,
  FeedbackDatasetSummary,
  FeedbackTrainingReadiness,
  ModelActivationPolicy,
  ModelLifecycle,
  RetrainingRecommendation,
  TrainingJob,
} from "@/types/ai-models";

const FRONTEND_STALE_MS = 5 * 60 * 1000;
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method || "GET").toUpperCase();
  const cacheable = method === "GET";
  const cacheKey = `${method}:${url}`;
  const now = Date.now();
  if (cacheable) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      logApiTiming(url, "hit", 0);
      return cached.value as T;
    }
  }
  const start = nowMs();
  const response = await fetch(url, { cache: "no-store", ...init });
  const elapsedMs = nowMs() - start;
  if (!response.ok) {
    const detail = await response.text();
    logApiTiming(url, "error", elapsedMs);
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }
  const payload = (await response.json()) as T;
  if (cacheable) {
    responseCache.set(cacheKey, { expiresAt: now + FRONTEND_STALE_MS, value: payload });
  }
  logApiTiming(url, "miss", elapsedMs);
  return payload;
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function logApiTiming(url: string, cacheState: "hit" | "miss" | "error", elapsedMs: number) {
  if (typeof console === "undefined") return;
  console.info(`[AI Models API] ${cacheState} ${Math.round(elapsedMs)}ms ${url}`);
}

export async function getAiModels(options: { includeMetrics?: boolean } = {}): Promise<AiModel[]> {
  try {
    const includeMetrics = options.includeMetrics === true;
    const models = await readJson<unknown[]>(`${AI_API_URL}/ai-models?include_metrics=${includeMetrics ? "true" : "false"}`);
    return withCanonicalTemporalModels(models.map(normalizeModel));
  } catch {
    return withCanonicalTemporalModels(mockModels);
  }
}

export async function getAiModelMetricsMap(): Promise<Record<string, AiModelMetrics>> {
  try {
    const payload = await readJson<{ metrics?: Record<string, unknown> }>(`${AI_API_URL}/ai-models/metrics`);
    const metrics = payload.metrics || {};
    return Object.fromEntries(
      Object.entries(metrics).map(([modelId, value]) => [modelId, normalizeMetrics(value)]),
    );
  } catch {
    return {};
  }
}

export async function getAiModel(id: string): Promise<AiModel | null> {
  try {
    return normalizeModel(await readJson<unknown>(`${AI_API_URL}/ai-models/${id}`));
  } catch {
    return mockModels.find((model) => model.id === id) || null;
  }
}

export async function getAiModelResults(id: string): Promise<AiModelResult[]> {
  try {
    const payload = await readJson<{ results?: unknown[] }>(`${AI_API_URL}/ai-models/${id}/results`);
    return (payload.results || []).map(normalizeResult).filter(isAnomalyResult);
  } catch {
    return (mockResults[id] || []).filter(isAnomalyResult);
  }
}

export async function getAiModelImprovements(id: string): Promise<AiModelImprovement[]> {
  try {
    const payload = await readJson<{ improvements?: unknown[] }>(`${AI_API_URL}/ai-models/${id}/improvements`);
    return (payload.improvements || []).map(normalizeImprovement);
  } catch {
    return mockImprovements[id] || [];
  }
}

export async function getAiModelLifecycle(id: string): Promise<ModelLifecycle | null> {
  try {
    return normalizeLifecycle(await readJson<unknown>(`${AI_API_URL}/ai-models/${id}/lifecycle`));
  } catch {
    return null;
  }
}

export async function getRetrainingRecommendation(id: string): Promise<RetrainingRecommendation | null> {
  try {
    return normalizeRecommendation(await readJson<unknown>(`${AI_API_URL}/ai-models/${id}/retraining-recommendation`));
  } catch {
    return null;
  }
}

export async function getTrainingHistory(id: string): Promise<TrainingJob[]> {
  try {
    const payload = await readJson<{ jobs?: unknown[] }>(`${AI_API_URL}/ai-models/${id}/training-history`);
    return (payload.jobs || []).map(normalizeTrainingJob);
  } catch {
    return [];
  }
}

export async function getModelDriftSeries(id: string): Promise<DriftPoint[]> {
  try {
    const payload = await readJson<{ series?: unknown[] }>(`${AI_API_URL}/ai-models/${id}/drift`);
    return (payload.series || []).map((item) => {
      const row = item as Record<string, any>;
      return { date: String(row.date || "-"), drift_score: Number(row.drift_score || 0) };
    });
  } catch {
    return [];
  }
}

export async function getModelActivationPolicy(): Promise<ModelActivationPolicy> {
  return readJson<ModelActivationPolicy>(`${AI_API_URL}/ai/models/activation-policy`);
}

export async function updateModelActivationPolicy(
  analysisLevel: AnalysisLevel,
  body: {
    active_model_id?: string | null;
    enabled_models?: Record<string, boolean>;
  },
): Promise<ActivationPolicyLevel> {
  return readJson<ActivationPolicyLevel>(`${AI_API_URL}/ai/models/activation-policy/${analysisLevel}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getFeedbackDatasetSummary(): Promise<FeedbackDatasetSummary> {
  return readJson<FeedbackDatasetSummary>(`${AI_API_URL}/ai/models/feedback-dataset/summary`);
}

export async function prepareFeedbackTraining(modelId: string): Promise<FeedbackTrainingReadiness> {
  return readJson<FeedbackTrainingReadiness>(
    `${AI_API_URL}/ai/models/${encodeURIComponent(modelId)}/prepare-feedback-training`,
    { method: "POST" },
  );
}

export type RLPolicyStatus = {
  enabled: boolean;
  algorithm: string;
  policy_version: string;
  total_experiences: number;
  average_reward: number;
  cumulative_reward: number;
  decision_distribution: Record<string, number>;
  human_override_rate: number;
  top_contexts_learned: Array<{
    context: string;
    total_experiences: number;
    best_action?: string | null;
    best_average_reward?: number | null;
    last_update?: string | null;
  }>;
  last_policy_update: string | null;
  config?: Record<string, unknown>;
};

export async function getRLPolicyStatus(): Promise<RLPolicyStatus> {
  return readJson<RLPolicyStatus>(`${AI_API_URL}/ai/rl/status`);
}

export async function trainAiModel(
  id: string,
  body: {
    dataset_start?: string;
    dataset_end?: string;
    sample_size: number;
    triggered_by?: string;
    training_mode?: string;
    training_options?: Record<string, unknown>;
  },
) {
  return readJson<{ model_id: string; job: TrainingJob; message: string }>(`${AI_API_URL}/ai-models/${id}/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateAiResultValidation(
  id: string,
  body: {
    validation_status: string;
    validation_comment?: string;
    validated_by?: string;
  },
): Promise<AiModelResult> {
  return normalizeResult(await readJson<unknown>(`${AI_API_URL}/results/${id}/validation`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function getAiPendingReviewResults(limit = 100): Promise<AiModelResult[]> {
  const payload = await readJson<unknown[]>(`${AI_API_URL}/results/pending-review?limit=${limit}`);
  return payload.map(normalizeResult).filter(isAnomalyResult);
}

export async function getAiValidationSummary(): Promise<Record<string, number>> {
  return readJson<Record<string, number>>(`${AI_API_URL}/results/validation-summary`);
}

function normalizeModel(input: unknown): AiModel {
  const item = input as Record<string, any>;
  const metrics = normalizeMetrics(item.metrics || {});
  const status = normalizeStatus(item.status);
  const type = normalizeType(item.type);
  return {
    id: String(item.id),
    name: String(item.name),
    type,
    version: String(item.version || "1.0.0"),
    status,
    developed_at: String(item.developed_at || "2026-05-10"),
    last_training_at: item.last_training_at || item.last_training || null,
    last_improvement_at: String(item.last_improvement_at || "2026-05-15"),
    objective: String(item.objective || "Detection intelligente d'anomalies GISRE"),
    description: String(item.description || item.use_case || "Modele IA utilise dans la supervision GISRE."),
    dataset: String(item.dataset || item.training_period || "PostgreSQL / api_calls / ai_analysis_results"),
    analyzed_events: Number(item.analyzed_events || item.sample_count || metrics.sample_count || 0),
    sample_count: Number(item.sample_count || metrics.sample_count || 0),
    target_anomalies: arrayOfStrings(item.target_anomalies || item.detectable_labels),
    detectable_labels: arrayOfStrings(item.detectable_labels || item.target_anomalies),
    features: arrayOfStrings(item.features),
    data_sources: arrayOfStrings(item.data_sources),
    training_period: String(item.training_period || "Fenetre recente PostgreSQL"),
    anomalies_detected: Number(item.anomalies_detected || metrics.total_anomalies || metrics.detected_anomalies || 0),
    avg_confidence: nullableNumber(item.avg_confidence ?? metrics.avg_confidence),
    avg_inference_ms: nullableNumber(item.avg_inference_ms ?? metrics.avg_inference_ms ?? 12),
    metrics: {
      ...metrics,
      avg_confidence: nullableNumber(item.avg_confidence ?? metrics.avg_confidence),
      avg_inference_ms: nullableNumber(item.avg_inference_ms ?? metrics.avg_inference_ms ?? 12),
      confidence_trend: metrics.confidence_trend || defaultTrend(nullableNumber(item.avg_confidence ?? metrics.avg_confidence) ?? 0),
      anomalies_by_day: metrics.anomalies_by_day || defaultAnomaliesByDay(),
      anomalies_by_type: normalizeTypes(metrics.top_anomaly_types || metrics.anomalies_by_type || item.detectable_labels),
    },
    lifecycle: item.lifecycle ? normalizeLifecycle(item.lifecycle) : null,
  };
}

function normalizeMetrics(input: unknown): AiModelMetrics {
  const metrics = (input || {}) as Record<string, any>;
  return {
    ...metrics,
    avg_confidence: nullableNumber(metrics.avg_confidence),
    avg_inference_ms: nullableNumber(metrics.avg_inference_ms ?? 12),
    confidence_trend: metrics.confidence_trend || defaultTrend(nullableNumber(metrics.avg_confidence) ?? 0),
    anomalies_by_day: metrics.anomalies_by_day || defaultAnomaliesByDay(),
    anomalies_by_type: normalizeTypes(metrics.top_anomaly_types || metrics.anomalies_by_type),
  };
}

function normalizeResult(input: unknown): AiModelResult {
  const item = input as Record<string, any>;
  const anomalyType = String(item.detected_anomaly_type || item.anomaly_type || "NORMAL");
  const riskScore = Number(item.risk_score || 0);
  const validation = normalizeValidationState(item.validation);
  const validationStatus = String(item.validation_status || validation || "unverified");
  return {
    id: String(item.id),
    date: String(item.detected_at || item.date || "-"),
    flow_or_api: String(item.flow_code || item.api_code || item.flow_or_api || "unknown"),
    anomaly_type: anomalyType,
    risk_score: riskScore,
    severity: item.severity || "low",
    confidence: nullableNumber(item.confidence),
    result: anomalyType !== "NORMAL" && riskScore > 0 ? "anomaly" : "normal",
    validation,
    validation_status: validationStatus,
    validated_by: item.validated_by || null,
    validated_at: item.validated_at || null,
    validation_comment: item.validation_comment || null,
    validation_source: item.validation_source || null,
  };
}

function normalizeValidationState(value: unknown): string {
  const validation = value as Record<string, any> | null;
  if (!validation || typeof validation !== "object") return "unverified";
  if (validation.confirmed === true) return "confirmed";
  if (validation.false_positive === true) return "false_positive";
  if (validation.matched_simulation === true) return "matched";
  if (Array.isArray(validation.detected_candidates) && validation.expected_detection) {
    return validation.detected_candidates.includes(validation.expected_detection) ? "matched" : "partial";
  }
  if (validation.expected_detection) return "partial";
  return "unverified";
}

function isAnomalyResult(result: AiModelResult): boolean {
  return result.result === "anomaly" && result.anomaly_type !== "NORMAL" && result.risk_score > 0;
}

function normalizeImprovement(input: unknown): AiModelImprovement {
  const item = input as Record<string, any>;
  return {
    date: String(item.date),
    version: String(item.version || "v1.0"),
    change: String(item.change || item.modification),
    expected_impact: String(item.expected_impact || item.impact),
    measured_impact: item.measured_impact ? String(item.measured_impact) : undefined,
  };
}

function normalizeLifecycle(input: unknown): ModelLifecycle {
  const item = input as Record<string, any>;
  return {
    model_id: String(item.model_id || item.id || ""),
    trained: Boolean(item.trained),
    current_version: String(item.current_version || item.model_version || "v0.0.0"),
    last_trained_at: item.last_trained_at || null,
    freshness_score: Number(item.freshness_score || 0),
    drift_score: Number(item.drift_score || 0),
    retraining_recommended: Boolean(item.retraining_recommended),
    new_events_since_training: Number(item.new_events_since_training || 0),
    days_since_last_training: item.days_since_last_training === null || item.days_since_last_training === undefined ? null : Number(item.days_since_last_training),
  };
}

function normalizeRecommendation(input: unknown): RetrainingRecommendation {
  const item = input as Record<string, any>;
  return {
    model_id: String(item.model_id || ""),
    recommended: Boolean(item.recommended),
    reasons: arrayOfStrings(item.reasons),
    drift_score: Number(item.drift_score || 0),
    freshness_score: Number(item.freshness_score || 0),
    days_since_last_training: item.days_since_last_training === null || item.days_since_last_training === undefined ? null : Number(item.days_since_last_training),
    new_events_since_training: Number(item.new_events_since_training || 0),
    degradation_level: String(item.degradation_level || "low"),
    policy: item.policy || undefined,
  };
}

function normalizeTrainingJob(input: unknown): TrainingJob {
  const item = input as Record<string, any>;
  return {
    id: String(item.id),
    model_id: String(item.model_id),
    model_version: item.model_version || null,
    analysis_level: item.analysis_level || null,
    status: String(item.status || "pending"),
    training_mode: String(item.training_mode || "manual"),
    started_at: item.started_at || null,
    completed_at: item.completed_at || null,
    dataset_start: item.dataset_start || null,
    dataset_end: item.dataset_end || null,
    sample_size: item.sample_size === null || item.sample_size === undefined ? null : Number(item.sample_size),
    accuracy: nullableNumber(item.accuracy),
    precision_score: nullableNumber(item.precision_score),
    recall_score: nullableNumber(item.recall_score),
    f1_score: nullableNumber(item.f1_score),
    drift_score: nullableNumber(item.drift_score),
    triggered_by: item.triggered_by || null,
    recommendation_reason: item.recommendation_reason || null,
    training_metadata: item.training_metadata || undefined,
    created_at: String(item.created_at || "-"),
  };
}

function normalizeStatus(status: string): AiModel["status"] {
  const value = String(status || "").toLowerCase();
  if (["actif", "active", "entraine", "trained"].includes(value)) return "active";
  if (["training", "entrainement"].includes(value)) return "training";
  if (["experimental", "expérimental"].includes(value)) return "experimental";
  return "inactive";
}

function normalizeType(type: string): AiModel["type"] {
  const value = String(type || "").toLowerCase();
  if (["supervise", "supervised"].includes(value)) return "supervised";
  if (["non supervise", "unsupervised"].includes(value)) return "unsupervised";
  if (value.includes("deep")) return "deep learning";
  if (value.includes("stat")) return "statistical";
  if (value.includes("transformer")) return "transformer";
  if (value.includes("graph")) return "graph_ai";
  return "experimental";
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTypes(value: unknown): Array<{ type: string; count: number }> {
  if (Array.isArray(value) && value.length && typeof value[0] === "object") {
    return (value as Array<Record<string, unknown>>).map((item) => ({
      type: String(item.detected_anomaly_type || item.type || "unknown"),
      count: Number(item.count || 0),
    }));
  }
  return arrayOfStrings(value).slice(0, 5).map((label, index) => ({ type: label, count: Math.max(4, 18 - index * 3) }));
}

function defaultTrend(base: number) {
  return ["J-6", "J-5", "J-4", "J-3", "J-2", "J-1", "J"].map((date, index) => ({
    date,
    value: Math.round((base + index * 0.01) * 100),
  }));
}

function defaultAnomaliesByDay() {
  return ["J-6", "J-5", "J-4", "J-3", "J-2", "J-1", "J"].map((date, index) => ({
    date,
    count: [12, 18, 15, 21, 19, 24, 28][index],
  }));
}

const commonFeatures = ["latency_ms", "error_rate", "request_rate", "availability_rate", "sla_breach", "status_code", "flow_id", "api_id"];

const canonicalTemporalModelIds = new Set([
  "temporal_rules_engine",
  "temporal_gru_sequence",
  "temporal_lstm_sequence",
  "temporal_tranad",
]);

function withCanonicalTemporalModels(models: AiModel[]): AiModel[] {
  const withoutLegacyTemporal = models.filter((model) => model.id !== "gru_sequence");
  const existingIds = new Set(withoutLegacyTemporal.map((model) => model.id));
  const missingTemporalModels = mockModels.filter(
    (model) => canonicalTemporalModelIds.has(model.id) && !existingIds.has(model.id),
  );
  return [...withoutLegacyTemporal, ...missingTemporalModels];
}

export const mockModels: AiModel[] = [
  mockModel("event_rules_engine", "Event-Level Rules Engine", "statistical", "active", "Detection deterministe temps reel sur evenement individuel", ["SLA_BREACH", "RESPONSE_TIME_SPIKE", "SERVER_ERROR", "TIMEOUT"], 12221),
  mockModel("event_random_forest", "Event-Level Random Forest", "supervised", "experimental", "Classification supervisee des anomalies Event-Level connues", ["TIMEOUT", "SLA_BREACH", "ACCESS_DENIED", "SERVER_ERROR"], 10856),
  mockModel("event_isolation_forest", "Event-Level Isolation Forest", "unsupervised", "experimental", "Detection non supervisee d'evenements individuels rares", ["EVENT_ISOLATION_FOREST_SIGNAL", "RESPONSE_TIME_SPIKE"], 3123),
  mockModel("event_lof", "Event-Level Local Outlier Factor", "unsupervised", "experimental", "Detection locale d'outliers Event-Level", ["EVENT_LOF_SIGNAL", "RESPONSE_TIME_SPIKE"], 6298),
  mockModel("event_autoencoder_mlp", "Event-Level MLP Autoencoder", "deep learning", "experimental", "Detection par reconstruction d'evenements individuels", ["EVENT_AUTOENCODER_SIGNAL", "RESPONSE_TIME_SPIKE"], 1386),
  mockModel("flow_rules_engine", "Flow-Level Rules Engine", "statistical", "active", "Detection de degradation au niveau du flow consumer -> API -> producer", ["HIGH_ERROR_RATE", "SLOW_API_ENDPOINT", "PROVIDER_SLOWDOWN", "CRITICAL_FLOW_INSTABILITY"], 845),
  mockModel("flow_kmeans_profile", "Flow-Level K-Means Profile", "unsupervised", "experimental", "Clustering des profils de flow et detection des flows atypiques", ["ML_FLOW_CLUSTER_OUTLIER", "UNEXPECTED_VOLUME", "SLOW_API_ENDPOINT"], 126),
  mockModel("flow_autoencoder", "Flow-Level Autoencoder", "deep learning", "experimental", "Detection de profils flow atypiques par reconstruction", ["DL_FLOW_AUTOENCODER", "CRITICAL_FLOW_INSTABILITY"], 84),
  mockModel("flow_gru_profile", "Flow-Level GRU Profile", "deep learning", "experimental", "Analyse sequence-level des profils successifs d'un flow", ["DL_FLOW_SEQUENCE", "TRAFFIC_ASYMMETRY", "API_UNDERUSE"], 42),
  mockModel(
    "temporal_rules_engine",
    "Temporal-Level Rules Engine",
    "statistical",
    "active",
    "Detection des derives et instabilites sur une fenetre temporelle de 15 minutes",
    ["latency_drift", "sla_instability", "timeout_burst", "service_flapping"],
    0,
    { version: "1.0.0", sampleCount: 0, confidence: null },
  ),
  mockModel(
    "temporal_gru_sequence",
    "Temporal-Level GRU Sequence",
    "deep learning",
    "experimental",
    "Detection sequentielle des ecarts de latence, erreurs et SLA",
    ["DL_GRU_SEQUENCE", "LATENCY_DRIFT", "GRADUAL_PERFORMANCE_DEGRADATION"],
    0,
    { version: "0.2.0", sampleCount: 0, confidence: null },
  ),
  mockModel(
    "temporal_lstm_sequence",
    "Temporal-Level LSTM Sequence",
    "deep learning",
    "inactive",
    "Experimental disabled model for future long sequence drift analysis",
    ["DL_LSTM_SEQUENCE", "SLA_INSTABILITY", "SERVICE_FLAPPING"],
    0,
    { version: "0.1.0", sampleCount: 0, confidence: null },
  ),
  mockModel(
    "temporal_tranad",
    "Temporal-Level TranAD",
    "transformer",
    "inactive",
    "Experimental disabled transformer model for future multivariate temporal analysis",
    ["TRANSFORMER_TRANAD_ANOMALY", "TRAFFIC_SPIKE", "TRAFFIC_DROP"],
    0,
    { version: "0.1.0", sampleCount: 0, confidence: null },
  ),
  mockModel("isolation_forest", "Isolation Forest", "unsupervised", "active", "Detection d'anomalies globales sur les evenements API", ["ML_ISOLATION_FOREST", "LATENCY_SPIKE", "TRAFFIC_SPIKE"], 318),
  mockModel("one_class_svm", "One-Class SVM", "unsupervised", "active", "Detection des ecarts par rapport au comportement normal", ["ML_ONE_CLASS_SVM", "PROVIDER_SLOWDOWN", "LATENCY_DRIFT"], 184),
  mockModel("kmeans", "K-Means", "unsupervised", "active", "Regroupement des profils de trafic et detection des clusters rares", ["ML_KMEANS_CLUSTER", "TRAFFIC_SPIKE"], 129),
  mockModel("autoencoder_mlp", "Autoencoder MLP", "deep learning", "experimental", "Detection par erreur de reconstruction", ["DL_AUTOENCODER_RECONSTRUCTION", "DATA_CONSISTENCY_SIGNAL"], 96),
  mockModel("random_forest_classifier", "Random Forest Classifier", "supervised", "active", "Classification des anomalies connues", ["TIMEOUT", "SLA_BREACH", "ACCESS_DENIED", "SERVER_ERROR"], 842),
];

function mockModel(
  id: string,
  name: string,
  type: AiModel["type"],
  status: AiModel["status"],
  objective: string,
  labels: string[],
  anomalies: number,
  options: {
    version?: string;
    sampleCount?: number;
    confidence?: number | null;
  } = {},
): AiModel {
  const sampleCount = options.sampleCount ?? 20000;
  const confidence = options.confidence === undefined ? 0.87 : options.confidence;
  return {
    id,
    name,
    type,
    version: options.version || "1.2.0",
    status,
    developed_at: "2026-05-10",
    last_training_at: "2026-05-14T17:22:28Z",
    last_improvement_at: "2026-05-15",
    objective,
    description: `${name} est utilise pour renforcer la detection intelligente des incidents GISRE.`,
    dataset: "PostgreSQL / api_calls / audit_events / ai_analysis_results",
    analyzed_events: sampleCount,
    sample_count: sampleCount,
    target_anomalies: labels,
    detectable_labels: labels,
    features: commonFeatures,
    data_sources: ["PostgreSQL", "performance_metrics", "incident_events"],
    training_period: "Derniers 20 000 evenements API et audit",
    anomalies_detected: anomalies,
    avg_confidence: confidence,
    avg_inference_ms: type === "deep learning" ? 31 : 11,
    metrics: {
      accuracy: type === "supervised" ? 0.924 : null,
      precision: type === "supervised" ? 0.91 : null,
      recall: type === "supervised" ? 0.9 : null,
      f1_score: type === "supervised" ? 0.904 : null,
      auc: type === "supervised" ? 0.93 : null,
      false_positive_rate: 0.04,
      false_negative_rate: 0.06,
      avg_confidence: confidence,
      avg_inference_ms: type === "deep learning" ? 31 : 11,
      total_anomalies: anomalies,
      anomaly_rate: type === "unsupervised" ? 0.035 : null,
      silhouette_score: id === "kmeans" ? 0.61 : null,
      contamination_rate: type === "unsupervised" ? 0.04 : null,
      loss: type === "deep learning" ? 0.038 : null,
      validation_loss: type === "deep learning" ? 0.046 : null,
      reconstruction_error: type === "deep learning" ? 0.119 : null,
      detection_threshold: type === "deep learning" ? 0.18 : null,
      confidence_trend: defaultTrend(0.82),
      anomalies_by_day: defaultAnomaliesByDay(),
      anomalies_by_type: labels.map((label, index) => ({ type: label, count: Math.max(5, anomalies - index * 23) })),
    },
  };
}

export const mockResults: Record<string, AiModelResult[]> = Object.fromEntries(
  mockModels.map((model) => [
    model.id,
    model.detectable_labels.slice(0, 6).map((label, index) => ({
      id: `${model.id}-${index}`,
      date: `2026-05-${15 - index} 14:${20 + index}:00`,
      flow_or_api: ["F14 / get_patient_eligibility", "F24 / verify_vehicle_registration", "F29 / verify_birth_record"][index % 3],
      anomaly_type: label,
      risk_score: 55 + index * 7,
      severity: index > 3 ? "critical" : index > 1 ? "high" : "medium",
      confidence: 0.78 + index * 0.02,
      result: "anomaly",
      validation: index % 2 === 0 ? "matched simulation" : "not matched",
    })),
  ]),
);

export const mockImprovements: Record<string, AiModelImprovement[]> = Object.fromEntries(
  mockModels.map((model) => [
    model.id,
    [
      { date: "2026-05-14", version: model.version, change: "Ajout des features error_rate et p95_latency.", expected_impact: "Meilleure detection des degradations progressives.", measured_impact: "+8% de stabilite sur les flux critiques." },
      { date: "2026-05-15", version: model.version, change: "Ajustement du seuil de detection.", expected_impact: "Reduction des faux positifs.", measured_impact: "Baisse du bruit historique." },
      { date: "2026-05-15", version: model.version, change: "Ajout des scenarios provider_unreachable.", expected_impact: "Detection plus rapide des ruptures producteur.", measured_impact: "Incidents critiques plus visibles." },
    ],
  ]),
);
