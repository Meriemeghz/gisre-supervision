import type { Severity } from "@/lib/api";
import { getAnomalyVisualLabel, getAnomalyVisualLevel } from "@/lib/anomaly-visual";

export function SeverityBadge({
  severity,
  anomalyType,
}: {
  severity: Severity;
  anomalyType?: string | null;
}) {
  const level = getAnomalyVisualLevel(anomalyType, severity);
  return <span className={`badge anomalyVisualBadge ${level}`}>{getAnomalyVisualLabel(anomalyType, severity)}</span>;
}
