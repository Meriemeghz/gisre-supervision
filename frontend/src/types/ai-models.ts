export type AiModelStatus = "active" | "training" | "experimental" | "inactive";
export type AiModelType = "supervised" | "unsupervised" | "deep learning" | "experimental" | "statistical";

export type AiModelMetricValue = number | string | null;

export type AiModelMetrics = {
  accuracy?: AiModelMetricValue;
  precision?: AiModelMetricValue;
  recall?: AiModelMetricValue;
  f1_score?: AiModelMetricValue;
  auc?: AiModelMetricValue;
  false_positive_rate?: AiModelMetricValue;
  false_negative_rate?: AiModelMetricValue;
  avg_confidence?: AiModelMetricValue;
  avg_inference_ms?: AiModelMetricValue;
  anomaly_rate?: AiModelMetricValue;
  silhouette_score?: AiModelMetricValue;
  contamination_rate?: AiModelMetricValue;
  loss?: AiModelMetricValue;
  validation_loss?: AiModelMetricValue;
  reconstruction_error?: AiModelMetricValue;
  detection_threshold?: AiModelMetricValue;
  total_anomalies?: number;
  avg_risk_score?: number;
  confidence_trend?: Array<{ date: string; value: number }>;
  anomalies_by_day?: Array<{ date: string; count: number }>;
  anomalies_by_type?: Array<{ type: string; count: number }>;
};

export type AiModelImprovement = {
  date: string;
  version: string;
  change: string;
  expected_impact: string;
  measured_impact?: string;
};

export type AiModelResult = {
  id: string;
  date: string;
  flow_or_api: string;
  anomaly_type: string;
  risk_score: number;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number | null;
  result: "anomaly" | "normal";
  validation?: string;
};

export type AiModel = {
  id: string;
  name: string;
  type: AiModelType;
  version: string;
  status: AiModelStatus;
  developed_at: string;
  last_training_at: string | null;
  last_improvement_at: string;
  objective: string;
  description: string;
  dataset: string;
  analyzed_events: number;
  sample_count: number;
  target_anomalies: string[];
  detectable_labels: string[];
  features: string[];
  data_sources: string[];
  training_period: string;
  anomalies_detected: number;
  avg_confidence: number | null;
  avg_inference_ms: number | null;
  metrics: AiModelMetrics;
};
