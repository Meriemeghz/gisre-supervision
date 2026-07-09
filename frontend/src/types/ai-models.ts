export type AiModelStatus = "active" | "training" | "experimental" | "inactive";
export type AiModelType = "supervised" | "unsupervised" | "deep learning" | "experimental" | "statistical" | "transformer" | "graph_ai";

export type AiModelMetricValue = number | string | null;

export type AiModelMetrics = {
  accuracy?: AiModelMetricValue;
  precision?: AiModelMetricValue;
  recall?: AiModelMetricValue;
  f1_score?: AiModelMetricValue;
  auc?: AiModelMetricValue;
  false_positive_rate?: AiModelMetricValue;
  false_negative_rate?: AiModelMetricValue;
  true_positive?: AiModelMetricValue;
  false_positive?: AiModelMetricValue;
  true_negative?: AiModelMetricValue;
  false_negative?: AiModelMetricValue;
  labelled_eval_count?: AiModelMetricValue;
  sample_count?: AiModelMetricValue;
  confusion_matrix?: number[][];
  confusion_labels?: string[];
  avg_confidence?: AiModelMetricValue;
  avg_inference_ms?: AiModelMetricValue;
  avg_normal_score?: AiModelMetricValue;
  avg_anomaly_score?: AiModelMetricValue;
  score_threshold?: AiModelMetricValue;
  anomaly_rate?: AiModelMetricValue;
  silhouette_score?: AiModelMetricValue;
  contamination_rate?: AiModelMetricValue;
  n_neighbors?: AiModelMetricValue;
  model_family?: string;
  training_required?: boolean;
  active_rule_count?: AiModelMetricValue;
  triggered_rule_count?: AiModelMetricValue;
  rule_coverage?: AiModelMetricValue;
  validation_match_rate?: AiModelMetricValue;
  validation_evaluable?: AiModelMetricValue;
  validation_matched?: AiModelMetricValue;
  scoring_coverage?: AiModelMetricValue;
  recommendation_coverage?: AiModelMetricValue;
  rule_audit_status?: string;
  rule_audit_issues?: string[];
  rule_definitions?: Array<{
    anomaly_type: string;
    condition: string;
    confidence: number;
    base_score?: number | null;
    recommendation?: string | null;
  }>;
  loss?: AiModelMetricValue;
  validation_loss?: AiModelMetricValue;
  reconstruction_error?: AiModelMetricValue;
  detection_threshold?: AiModelMetricValue;
  total_anomalies?: number;
  detected_anomalies?: number;
  avg_risk_score?: number;
  confidence_trend?: Array<{ date: string; value: number }>;
  anomalies_by_day?: Array<{ date: string; count: number }>;
  anomalies_by_type?: Array<{ type: string; count: number }>;
  top_anomaly_types?: Array<{ detected_anomaly_type?: string; type?: string; count: number }>;
  top_flows?: Array<{ flow_code?: string; flow?: string; count: number }>;
};

export type ModelLifecycle = {
  model_id: string;
  trained: boolean;
  current_version: string;
  last_trained_at: string | null;
  freshness_score: number;
  drift_score: number;
  retraining_recommended: boolean;
  new_events_since_training: number;
  days_since_last_training: number | null;
};

export type RetrainingRecommendation = {
  model_id: string;
  recommended: boolean;
  reasons: string[];
  drift_score: number;
  freshness_score: number;
  days_since_last_training: number | null;
  new_events_since_training: number;
  degradation_level: "low" | "medium" | "high" | string;
  policy?: Record<string, unknown>;
};

export type TrainingJob = {
  id: string;
  model_id: string;
  model_version: string | null;
  analysis_level: string | null;
  status: "pending" | "training" | "completed" | "failed" | string;
  training_mode: string;
  started_at: string | null;
  completed_at: string | null;
  dataset_start: string | null;
  dataset_end: string | null;
  sample_size: number | null;
  accuracy: number | null;
  precision_score: number | null;
  recall_score: number | null;
  f1_score: number | null;
  drift_score: number | null;
  triggered_by: string | null;
  recommendation_reason: string | null;
  training_metadata?: Record<string, unknown>;
  created_at: string;
};

export type DriftPoint = {
  date: string;
  drift_score: number;
};

export type AnalysisLevel = "event" | "flow" | "temporal" | "graph";

export type ActivationPolicyModel = {
  model_id: string;
  model_name: string;
  analysis_level: AnalysisLevel;
  enabled: boolean;
  active: boolean;
  version: string | null;
  trained_status: "trained" | "not_trained" | "not_required" | string;
  last_trained_at: string | null;
  freshness_score: number | null;
  drift_score: number | null;
  retraining_recommended: boolean | null;
};

export type ActivationPolicyLevel = {
  analysis_level: AnalysisLevel;
  active_model_id: string | null;
  available: boolean;
  models: ActivationPolicyModel[];
};

export type ModelActivationPolicy = Record<AnalysisLevel, ActivationPolicyLevel>;

export type FeedbackModelSummary = {
  model_id: string;
  analysis_level: string;
  usable_samples: number;
  anomaly_labels: number;
  normal_labels: number;
  validation_acceptance_rate: number;
};

export type FeedbackAnomalySummary = {
  anomaly_type: string;
  count: number;
};

export type FeedbackDatasetSummary = {
  total_validated: number;
  usable_for_training: number;
  confirmed_anomalies: number;
  false_positives: number;
  excluded_pending: number;
  label_distribution: {
    anomaly: number;
    normal: number;
  };
  by_model: FeedbackModelSummary[];
  by_anomaly_type: FeedbackAnomalySummary[];
};

export type FeedbackTrainingReadiness = {
  model_id: string;
  ready: boolean;
  trainable: boolean;
  usable_samples: number;
  min_required_samples: number;
  label_distribution: {
    anomaly: number;
    normal: number;
  };
  warnings: string[];
  message: string;
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
  validation_status?: string;
  validated_by?: string | null;
  validated_at?: string | null;
  validation_comment?: string | null;
  validation_source?: string | null;
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
  lifecycle?: ModelLifecycle | null;
};
