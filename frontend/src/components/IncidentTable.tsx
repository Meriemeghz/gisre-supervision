import Link from "next/link";
import type { AiResult } from "@/lib/api";
import { getAnomalyVisualLevel } from "@/lib/anomaly-visual";
import { SeverityBadge } from "./SeverityBadge";

export type IncidentStatus = "OPEN" | "INVESTIGATING" | "RESOLVED" | "CLOSED";

export function getIncidentStatus(item: AiResult): IncidentStatus {
  const detectedAt = parseDate(item.detected_at);
  const ageMinutes = detectedAt ? (Date.now() - detectedAt.getTime()) / 60000 : 9999;

  if ((item.severity === "critical" || item.severity === "high") && ageMinutes <= 30) {
    return "OPEN";
  }

  if ((item.severity === "critical" || item.severity === "high") && ageMinutes <= 180) {
    return "INVESTIGATING";
  }

  if (ageMinutes <= 720) {
    return "RESOLVED";
  }

  return "CLOSED";
}

export function IncidentTable({
  results,
  compact = false,
  flowNames,
}: {
  results: AiResult[];
  compact?: boolean;
  flowNames?: Map<string, string>;
}) {
  const anomalyResults = results.filter((item) => item.detected_anomaly_type !== "NORMAL" && Number(item.risk_score || 0) > 0);

  if (anomalyResults.length === 0) {
    return <p className="muted">Aucune anomalie detectee pour cette vue.</p>;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Type</th>
          <th>Flux metier</th>
          <th>Detecteur IA</th>
          <th>Statut</th>
          <th>Severity</th>
          <th>Score</th>
          {!compact && <th>Recommandation</th>}
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {anomalyResults.map((item) => (
          <tr className={`anomalyVisualRow ${getAnomalyVisualLevel(item.detected_anomaly_type, item.severity)}`} key={item.id}>
            <td className="typeCell">{item.detected_anomaly_type}</td>
            <td>
              <strong>{getFlowLabel(item.flow_code, flowNames)}</strong>
              {flowNames?.has(item.flow_code || "") && <small className="flowCode">{item.flow_code}</small>}
            </td>
            <td>
              <ModelBadge result={item} />
            </td>
            <td>
              <span className={`incidentStatus ${getIncidentStatus(item).toLowerCase()}`}>{getIncidentStatus(item)}</span>
            </td>
            <td>
              <SeverityBadge anomalyType={item.detected_anomaly_type} severity={item.severity} />
            </td>
            <td className="score">{item.risk_score}</td>
            {!compact && <td>{item.recommendation || item.explanation || "A confirmer"}</td>}
            <td>
              <Link className="button" href={`/incidents/${item.id}`}>
                Ouvrir
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ModelBadge({ result }: { result: AiResult }) {
  const model = getDetectionModel(result);
  const isRulesEngine = model.id === "event_rules_engine";

  return (
    <span className={`modelDetectionBadge ${isRulesEngine ? "rules" : ""}`}>
      <span>{model.name}</span>
      <small>{model.family}</small>
    </span>
  );
}

function getDetectionModel(result: AiResult) {
  const model = result.metadata?.model;
  if (isModelMetadata(model)) {
    return {
      id: model.id,
      name: model.name,
      family: model.family,
    };
  }

  if (result.analysis_type === "realtime") {
    return {
      id: "event_rules_engine",
      name: "Event-Level Rules Engine",
      family: "event_level",
    };
  }

  return {
    id: "historical_ai",
    name: "Historical AI",
    family: result.analysis_type || "ai",
  };
}

function isModelMetadata(value: unknown): value is { id: string; name: string; family: string } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.family === "string";
}

function getFlowLabel(flowCode: string | null, flowNames?: Map<string, string>) {
  if (!flowCode) {
    return "n/a";
  }
  return flowNames?.get(flowCode) || flowCode;
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
