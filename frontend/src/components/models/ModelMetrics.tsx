import type { AiModel } from "@/types/ai-models";

const supervisedMetrics = ["accuracy", "precision", "recall", "f1_score", "auc", "false_positive_rate", "false_negative_rate"];
const deepMetrics = ["loss", "validation_loss", "reconstruction_error", "detection_threshold"];
const unsupervisedMetrics = ["anomaly_rate", "silhouette_score", "contamination_rate"];

export function ModelMetrics({ model }: { model: AiModel }) {
  const metricKeys =
    model.type === "supervised"
      ? supervisedMetrics
      : model.type === "deep learning"
        ? deepMetrics
        : unsupervisedMetrics;

  const shared = ["avg_confidence", "avg_inference_ms"];

  return (
    <div className="modelMetricGrid">
      {[...metricKeys, ...shared].map((key) => (
        <div className="metricBox" key={key}>
          <span>{label(key)}</span>
          <strong>{formatMetric(key, model.metrics[key as keyof typeof model.metrics])}</strong>
        </div>
      ))}
    </div>
  );
}

function label(key: string) {
  return key.replaceAll("_", " ");
}

function formatMetric(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  if (key.includes("rate") || ["accuracy", "precision", "recall", "f1_score", "auc", "avg_confidence"].includes(key)) {
    return `${Math.round(numeric * 100)}%`;
  }
  if (key.includes("ms")) {
    return `${numeric} ms`;
  }
  return numeric.toFixed(3);
}
