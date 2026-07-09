import Link from "next/link";
import type { AiModel } from "@/types/ai-models";

export function ModelCard({ model }: { model: AiModel }) {
  const confidence = model.avg_confidence === null ? null : Math.round(model.avg_confidence * 100);
  const drift = Math.round((model.lifecycle?.drift_score || 0) * 100);
  return (
    <article className="modelCard">
      <div className="modelCardTop">
        <div>
          <strong>{model.name}</strong>
          <span className="modelLevelBadge">{analysisLevel(model.id)}</span>
        </div>
        <span className={`modelStatus ${statusClass(model.status)}`}>{model.status}</span>
      </div>
      <p>{model.objective}</p>
      <div className="modelMeta">
        <span>{model.type}</span>
        <span>v{model.version}</span>
        <span>{model.sample_count || "-"} samples</span>
      </div>
      <div className="modelKpiLine">
        <span>{model.anomalies_detected} anomalies</span>
        <span>{confidence === null ? "N/A confiance" : `${confidence}% confiance`}</span>
      </div>
      <div className="modelSignalBars">
        <MetricBar label="Confiance" value={confidence} />
        <MetricBar label="Drift" value={drift} tone="orange" />
      </div>
      <div className="modelLabels">
        {model.detectable_labels.slice(0, 4).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <Link className="button modelCardButton" href={`/models/${model.id}`}>
        Voir details
      </Link>
    </article>
  );
}

function MetricBar({ label, value, tone = "teal" }: { label: string; value: number | null; tone?: "teal" | "orange" }) {
  const displayValue = value === null ? "N/A" : `${value}%`;
  return (
    <div className="modelSignalBar">
      <span>{label}</span>
      <div>
        <i className={tone} style={{ width: value === null ? "0%" : `${Math.max(4, Math.min(100, value))}%` }} />
      </div>
      <strong>{displayValue}</strong>
    </div>
  );
}

function analysisLevel(id: string) {
  if (id.startsWith("event_")) return "event";
  if (id.startsWith("temporal_") || id.includes("gru_sequence")) return "temporal";
  if (id.startsWith("flow_")) return "flow";
  if (id.startsWith("graph_") || ["gdn", "mtad_gat", "topo_gdn"].includes(id)) return "graph";
  if (id.includes("hybrid") || id.includes("ensemble")) return "platform";
  return "global";
}

export function statusClass(status: string) {
  if (status === "active") return "ready";
  if (status === "training" || status === "experimental") return "warning";
  return "disabled";
}
