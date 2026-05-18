import { AI_API_URL } from "@/lib/api";
import type { AiModel, AiModelImprovement, AiModelResult } from "@/types/ai-models";

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function getAiModels(): Promise<AiModel[]> {
  try {
    const models = await readJson<unknown[]>(`${AI_API_URL}/ai-models`);
    return models.map(normalizeModel);
  } catch {
    return mockModels;
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
    return (payload.results || []).map(normalizeResult);
  } catch {
    return mockResults[id] || [];
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

function normalizeModel(input: unknown): AiModel {
  const item = input as Record<string, any>;
  const metrics = item.metrics || {};
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
    avg_confidence: nullableNumber(item.avg_confidence ?? metrics.avg_confidence ?? 0.86),
    avg_inference_ms: nullableNumber(item.avg_inference_ms ?? metrics.avg_inference_ms ?? 12),
    metrics: {
      ...metrics,
      avg_confidence: nullableNumber(item.avg_confidence ?? metrics.avg_confidence ?? 0.86),
      avg_inference_ms: nullableNumber(item.avg_inference_ms ?? metrics.avg_inference_ms ?? 12),
      confidence_trend: metrics.confidence_trend || defaultTrend(0.82),
      anomalies_by_day: metrics.anomalies_by_day || defaultAnomaliesByDay(),
      anomalies_by_type: normalizeTypes(metrics.top_anomaly_types || metrics.anomalies_by_type || item.detectable_labels),
    },
  };
}

function normalizeResult(input: unknown): AiModelResult {
  const item = input as Record<string, any>;
  return {
    id: String(item.id),
    date: String(item.detected_at || item.date || "-"),
    flow_or_api: String(item.flow_code || item.api_code || item.flow_or_api || "unknown"),
    anomaly_type: String(item.detected_anomaly_type || item.anomaly_type || "NORMAL"),
    risk_score: Number(item.risk_score || 0),
    severity: item.severity || "low",
    confidence: nullableNumber(item.confidence),
    result: Number(item.risk_score || 0) >= 40 ? "anomaly" : "normal",
    validation: item.validation?.matched_simulation === true ? "matched simulation" : item.validation ? "not matched" : "N/A",
  };
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

export const mockModels: AiModel[] = [
  mockModel("isolation_forest", "Isolation Forest", "unsupervised", "active", "Detection d'anomalies globales sur les evenements API", ["ML_ISOLATION_FOREST", "LATENCY_SPIKE", "TRAFFIC_SPIKE"], 318),
  mockModel("one_class_svm", "One-Class SVM", "unsupervised", "active", "Detection des ecarts par rapport au comportement normal", ["ML_ONE_CLASS_SVM", "PROVIDER_SLOWDOWN", "LATENCY_DRIFT"], 184),
  mockModel("kmeans", "K-Means", "unsupervised", "active", "Regroupement des profils de trafic et detection des clusters rares", ["ML_KMEANS_CLUSTER", "TRAFFIC_SPIKE"], 129),
  mockModel("autoencoder_mlp", "Autoencoder MLP", "deep learning", "experimental", "Detection par erreur de reconstruction", ["DL_AUTOENCODER_RECONSTRUCTION", "DATA_CONSISTENCY_SIGNAL"], 96),
  mockModel("random_forest_classifier", "Random Forest Classifier", "supervised", "active", "Classification des anomalies connues", ["TIMEOUT", "SLA_BREACH", "ACCESS_DENIED", "SERVER_ERROR"], 842),
  mockModel("gru_sequence", "GRU Sequence Model", "experimental", "experimental", "Analyse sequentielle des derives temporelles", ["DL_GRU_SEQUENCE", "LATENCY_DRIFT", "PROVIDER_SLOWDOWN"], 43),
];

function mockModel(id: string, name: string, type: AiModel["type"], status: AiModel["status"], objective: string, labels: string[], anomalies: number): AiModel {
  return {
    id,
    name,
    type,
    version: id === "gru_sequence" ? "0.6.0" : "1.2.0",
    status,
    developed_at: "2026-05-10",
    last_training_at: "2026-05-14T17:22:28Z",
    last_improvement_at: "2026-05-15",
    objective,
    description: `${name} est utilise pour renforcer la detection intelligente des incidents GISRE.`,
    dataset: "PostgreSQL / api_calls / audit_events / ai_analysis_results",
    analyzed_events: 20000,
    sample_count: 20000,
    target_anomalies: labels,
    detectable_labels: labels,
    features: commonFeatures,
    data_sources: ["PostgreSQL", "performance_metrics", "incident_events"],
    training_period: "Derniers 20 000 evenements API et audit",
    anomalies_detected: anomalies,
    avg_confidence: 0.87,
    avg_inference_ms: type === "deep learning" ? 31 : 11,
    metrics: {
      accuracy: type === "supervised" ? 0.924 : null,
      precision: type === "supervised" ? 0.91 : null,
      recall: type === "supervised" ? 0.9 : null,
      f1_score: type === "supervised" ? 0.904 : null,
      auc: type === "supervised" ? 0.93 : null,
      false_positive_rate: 0.04,
      false_negative_rate: 0.06,
      avg_confidence: 0.87,
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
