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
