export type AnomalyVisualLevel = "success" | "warning" | "critical";

const ANOMALY_VISUAL_LEVELS: Record<string, AnomalyVisualLevel> = {
  NORMAL: "success",
  SUCCESS: "success",
  FLOW_NORMAL: "success",

  WARNING: "warning",
  HIGH_LATENCY: "warning",
  RESPONSE_TIME_SPIKE: "warning",
  SLA_BREACH: "warning",
  ACCESS_DENIED: "warning",
  RATE_LIMIT_EXCEEDED: "warning",
  MISSING_LATENCY_METRIC: "warning",
  FLOW_SLA_DEGRADATION: "warning",
  FLOW_LATENCY_DRIFT: "warning",
  FLOW_TRAFFIC_SPIKE: "warning",
  FLOW_TRAFFIC_DROP: "warning",
  DEPENDENCY_HOTSPOT: "warning",
  INTEROPERABILITY_DEGRADATION: "warning",

  CRITICAL: "critical",
  SERVER_ERROR: "critical",
  PROVIDER_UNREACHABLE: "critical",
  TIMEOUT: "critical",
  CORRUPTED_EVENT_PAYLOAD: "critical",
  FLOW_ERROR_RATE_SPIKE: "critical",
  FLOW_PROVIDER_DEGRADATION: "critical",
  FLOW_INTERMITTENT_FAILURES: "critical",
  FLOW_HEALTH_DEGRADATION: "critical",
  CASCADE_FAILURE: "critical",
  DEPENDENT_SERVICE_FAILURE: "critical",
  MULTI_CONSUMER_IMPACT: "critical",
  SHARED_PROVIDER_FAILURE: "critical",
};

export function getAnomalyVisualLevel(
  anomalyType: string | null | undefined,
  severity?: string | null,
): AnomalyVisualLevel {
  const normalizedType = normalizeAnomalyType(anomalyType);
  const mappedLevel = ANOMALY_VISUAL_LEVELS[normalizedType];
  if (mappedLevel) return mappedLevel;

  const normalizedSeverity = String(severity || "").trim().toLowerCase();
  if (normalizedSeverity === "critical") return "critical";
  if (normalizedSeverity === "high" || normalizedSeverity === "medium" || normalizedSeverity === "warning") {
    return "warning";
  }
  return "success";
}

export function getAnomalyVisualLabel(
  anomalyType: string | null | undefined,
  severity?: string | null,
) {
  return getAnomalyVisualLevel(anomalyType, severity).toUpperCase();
}

function normalizeAnomalyType(value: string | null | undefined) {
  return String(value || "NORMAL").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
