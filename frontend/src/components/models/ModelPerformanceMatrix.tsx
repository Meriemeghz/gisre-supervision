import Link from "next/link";
import type { AiModel } from "@/types/ai-models";

export function ModelPerformanceMatrix({ models }: { models: AiModel[] }) {
  const rows = [...models].sort((left, right) => modelHealthScore(right) - modelHealthScore(left));

  return (
    <section className="card modelPerformanceMatrix">
      <div className="cardHeader">
        <div>
          <h2>Model Performance Matrix</h2>
          <p>Vue consolidee pour comparer les modeles un par un.</p>
        </div>
        <span className="statusPill">{rows.length} modeles</span>
      </div>
      <div className="cardBody modelPerformanceTableWrap">
        <table className="table modelPerformanceTable">
          <thead>
            <tr>
              <th>Modele</th>
              <th>Niveau</th>
              <th>Health</th>
              <th>Metric principale</th>
              <th>Confidence</th>
              <th>Drift</th>
              <th>Freshness</th>
              <th>Detections</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((model) => {
              const health = modelHealthScore(model);
              return (
                <tr key={model.id}>
                  <td>
                    <strong>{model.name}</strong>
                    <small>{model.id}</small>
                  </td>
                  <td><span className="modelLevelBadge">{analysisLevel(model)}</span></td>
                  <td>
                    <div className="modelHealthCell">
                      <span className={healthTone(health)}>{health}</span>
                      <div><i className={healthTone(health)} style={{ width: `${health}%` }} /></div>
                    </div>
                  </td>
                  <td>{primaryMetric(model)}</td>
                  <td>{isDeterministicRules(model) ? "rule-based" : formatPercent(model.avg_confidence)}</td>
                  <td>{isDeterministicRules(model) ? formatPercent(metricNumber(model.metrics.scoring_coverage)) : formatPercent(model.lifecycle?.drift_score ?? null)}</td>
                  <td>{isDeterministicRules(model) ? formatPercent(metricNumber(model.metrics.recommendation_coverage)) : formatPercent(model.lifecycle?.freshness_score ?? null)}</td>
                  <td>{model.anomalies_detected}</td>
                  <td>
                    <Link className="button" href={`/models/${model.id}`}>
                      Voir performance
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function modelHealthScore(model: AiModel) {
  if (isDeterministicRules(model)) {
    const coverage = clamp01(metricNumber(model.metrics.rule_coverage) ?? 0);
    const confidence = clamp01(model.avg_confidence ?? 0.8);
    const validation = clamp01(metricNumber(model.metrics.validation_match_rate) ?? confidence);
    return Math.max(0, Math.min(100, Math.round((coverage * 0.35 + confidence * 0.35 + validation * 0.2 + 0.1) * 100)));
  }
  const confidence = clamp01(model.avg_confidence ?? 0);
  const freshness = clamp01(model.lifecycle?.freshness_score ?? 0.7);
  const driftPenalty = clamp01(model.lifecycle?.drift_score ?? 0) * 0.35;
  const f1 = metricNumber(model.metrics.f1_score);
  const accuracy = metricNumber(model.metrics.accuracy);
  const quality = f1 ?? accuracy ?? confidence;
  const confidenceWeight = model.avg_confidence === null ? 0 : 0.25;
  const score = (quality * 0.45 + confidence * confidenceWeight + freshness * 0.2 + (1 - driftPenalty) * 0.1) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function primaryMetric(model: AiModel) {
  if (model.type === "supervised") {
    return `F1 ${formatPercent(metricNumber(model.metrics.f1_score))}`;
  }
  if (model.type === "deep learning") {
    const loss = metricNumber(model.metrics.validation_loss ?? model.metrics.loss);
    return loss === null ? "Loss N/A" : `Loss ${loss.toFixed(3)}`;
  }
  if (model.type === "unsupervised") {
    const silhouette = metricNumber(model.metrics.silhouette_score);
    const anomalyRate = metricNumber(model.metrics.anomaly_rate);
    return silhouette !== null ? `Silhouette ${silhouette.toFixed(2)}` : `Anomaly rate ${formatPercent(anomalyRate)}`;
  }
  if (isDeterministicRules(model)) {
    const coverage = metricNumber(model.metrics.rule_coverage);
    const triggered = metricNumber(model.metrics.triggered_rule_count);
    const active = metricNumber(model.metrics.active_rule_count);
    return coverage !== null ? `Rules ${triggered ?? 0}/${active ?? 0} (${formatPercent(coverage)})` : "Rules engine";
  }
  return `Risk avg ${metricNumber(model.metrics.avg_risk_score)?.toFixed(0) ?? "N/A"}`;
}

function isDeterministicRules(model: AiModel) {
  return model.id === "event_rules_engine" || model.metrics.model_family === "deterministic_rules";
}

export function analysisLevel(model: AiModel) {
  if (model.id.startsWith("event_")) return "event";
  if (model.id.startsWith("temporal_") || model.id.includes("gru_sequence")) return "temporal";
  if (model.id.startsWith("flow_")) return "flow";
  if (model.id.startsWith("graph_") || model.type === "graph_ai") return "graph";
  if (model.objective.toLowerCase().includes("acteur") || model.objective.toLowerCase().includes("actor")) return "actor";
  if (model.id.includes("ensemble") || model.id.includes("hybrid")) return "platform";
  return "global";
}

export function metricNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function healthTone(value: number) {
  if (value >= 80) return "good";
  if (value >= 60) return "warn";
  return "bad";
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return `${Math.round(value * 100)}%`;
}
