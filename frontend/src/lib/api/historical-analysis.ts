import { AI_API_URL } from "@/lib/api";

export type HistoricalAnalyzePayload = {
  start_date?: string;
  end_date?: string;
  flow_code?: string;
  api_name?: string;
  producer?: string;
  consumer?: string;
  criticality?: string;
  event_type?: string;
  sample_size: number;
  sampling_method: string;
  model_id: string;
};

export type HistoricalAnalyzeResult = {
  analysis_id: string;
  model_used: string;
  records_analyzed: number;
  anomalies_detected: number;
  average_risk_score: number;
  critical_anomalies: number;
  status: string;
  results: Array<{
    detected_anomaly_type: string;
    flow_code: string | null;
    risk_score: number;
    severity: string;
    confidence: number | null;
    explanation: string | null;
    recommendation: string | null;
    metadata?: Record<string, unknown>;
  }>;
};

export type HistoricalPeriodPreset = "24h" | "7d" | "30d" | "90d" | "custom";

export type HistoricalAnalyticsFilters = {
  start_date: string;
  end_date: string;
  flow_code?: string;
  api_code?: string;
  producer_code?: string;
  consumer_code?: string;
  anomaly_type?: string;
};

export type HistoricalTrendPoint = {
  bucket: string;
  anomaly_count: number;
  average_risk_score: number | null;
  average_latency_ms: number | null;
  error_rate: number | null;
};

export type HistoricalAnomalyTimelinePoint = {
  bucket: string;
  anomaly_type: string;
  count: number;
};

export type HistoricalEvolvingAnomaly = {
  anomaly_type: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  previous_period_count: number;
  recent_period_count: number;
};

export type HistoricalTemporalHeatmapCell = {
  day: number;
  hour: number;
  anomaly_count: number;
  top_anomaly_type: string | null;
  average_risk_score: number | null;
};

export type HistoricalRankedItem = {
  code: string;
  anomaly_count: number;
  average_risk_score: number | null;
  max_risk_score: number;
};

export type HistoricalRootCauseChain = {
  producer_code: string;
  api_code: string;
  anomaly_type: string;
  occurrences: number;
  average_risk_score: number | null;
  max_risk_score: number;
  risk_sum: number;
  criticality: "low" | "medium" | "high" | "critical";
  average_severity_score: number;
  first_seen: string;
  last_seen: string;
  impacted_flows: number;
};

export type HistoricalAnalytics = {
  period: { start_date: string; end_date: string; bucket: "hour" | "day" | "week" };
  filters: Record<string, string | null>;
  filter_options: {
    flow_code: string[];
    api_code: string[];
    producer_code: string[];
    consumer_code: string[];
    anomaly_type: string[];
  };
  trends: HistoricalTrendPoint[];
  anomaly_timeline: HistoricalAnomalyTimelinePoint[];
  evolving_anomalies: HistoricalEvolvingAnomaly[];
  temporal_heatmap: HistoricalTemporalHeatmapCell[];
  recurrences: {
    top_anomalies: Array<{ anomaly_type: string; count: number }>;
    by_hour: Array<{ hour: number; count: number }>;
    by_day: Array<{ day: number; count: number }>;
  };
  root_cause_chains: HistoricalRootCauseChain[];
  root_cause_groups: {
    producer_code: HistoricalRankedItem[];
    consumer_code: HistoricalRankedItem[];
    api_code: HistoricalRankedItem[];
    flow_code: HistoricalRankedItem[];
  };
  supervision_quality: {
    total_results: number;
    anomalies_detected: number;
    normal_results: number;
    false_positives: number;
    true_positives: number;
    pending_reviews: number;
    reviewed_results: number;
    validation_rate: number | null;
  };
  llm_ready_summary_payload: Record<string, unknown>;
};

export type HistoricalInterpretResult = {
  configured: boolean;
  message?: string;
  executive_summary?: string;
  key_findings?: string[];
  risk_interpretation?: string;
  root_cause_interpretation?: string;
  temporal_interpretation?: string;
  recommendations?: string[];
  confidence_note?: string;
};

export async function postHistoricalInterpret(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<HistoricalInterpretResult> {
  const response = await fetch(`${AI_API_URL}/ai/analytics/historical/interpret`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }
  return response.json() as Promise<HistoricalInterpretResult>;
}

export async function runHistoricalAnalysis(payload: HistoricalAnalyzePayload): Promise<HistoricalAnalyzeResult> {
  const response = await fetch(`${AI_API_URL}/ai/historical/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<HistoricalAnalyzeResult>;
}

export async function getHistoricalAnalytics(
  filters: HistoricalAnalyticsFilters,
  signal?: AbortSignal,
): Promise<HistoricalAnalytics> {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), 65000);
  const abortRequest = () => timeoutController.abort();
  signal?.addEventListener("abort", abortRequest, { once: true });

  let response: Response;
  try {
    response = await fetch(`${AI_API_URL}/ai/analytics/historical?${query.toString()}`, {
      cache: "no-store",
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(
        signal?.aborted
          ? "Historical request cancelled"
          : "Historical analytics timed out after 65 seconds",
      );
    }
    throw new Error(error instanceof Error ? error.message : "Historical analytics endpoint unreachable");
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortRequest);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }
  return response.json() as Promise<HistoricalAnalytics>;
}
