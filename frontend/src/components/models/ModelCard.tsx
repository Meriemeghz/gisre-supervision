import Link from "next/link";
import type { AiModel } from "@/types/ai-models";

export function ModelCard({ model }: { model: AiModel }) {
  return (
    <article className="modelCard">
      <div className="modelCardTop">
        <strong>{model.name}</strong>
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
        <span>{model.avg_confidence === null ? "N/A" : `${Math.round(model.avg_confidence * 100)}% confiance`}</span>
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

export function statusClass(status: string) {
  if (status === "active") return "ready";
  if (status === "training" || status === "experimental") return "warning";
  return "disabled";
}
