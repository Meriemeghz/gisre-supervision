import type { AiModel } from "@/types/ai-models";

type ChartPoint = {
  label: string;
  value: number;
};

const LEVELS = ["event", "temporal", "flow", "graph", "actor", "platform", "global"];
const LEVEL_COLORS: Record<string, string> = {
  event: "#2563eb",
  temporal: "#0f766e",
  flow: "#d97706",
  graph: "#7c3aed",
  actor: "#dc2626",
  platform: "#15803d",
  global: "#64748b",
};

export function ModelsDashboardCharts({ models }: { models: AiModel[] }) {
  const totalModels = models.length;
  const activeModels = models.filter((model) => model.status === "active").length;
  const trainedModels = models.filter((model) => model.lifecycle?.trained || model.status === "active").length;
  const totalAnomalies = models.reduce((sum, model) => sum + model.anomalies_detected, 0);
  const avgConfidence = average(models.map((model) => model.avg_confidence).filter(isNumber));
  const avgDrift = average(models.map((model) => model.lifecycle?.drift_score).filter(isNumber));

  const byLevel = countBy(models, analysisLevelForModel);
  const byType = countBy(models, (model) => model.type);
  const byStatus = countBy(models, (model) => model.status);
  const topModels = [...models].sort((left, right) => right.anomalies_detected - left.anomalies_detected).slice(0, 7);
  const heatmapRows = LEVELS.map((level) => ({
    level,
    active: models.filter((model) => analysisLevelForModel(model) === level && model.status === "active").length,
    training: models.filter((model) => analysisLevelForModel(model) === level && model.status === "training").length,
    experimental: models.filter((model) => analysisLevelForModel(model) === level && model.status === "experimental").length,
    inactive: models.filter((model) => analysisLevelForModel(model) === level && model.status === "inactive").length,
  })).filter((row) => row.active + row.training + row.experimental + row.inactive > 0);

  return (
    <section className="aiDashboard">
      <div className="aiDashboardKpis">
        <MetricTile label="Modeles supervises" value={totalModels} />
        <MetricTile label="Modeles actifs" value={activeModels} />
        <MetricTile label="Modeles entraines" value={trainedModels} />
        <MetricTile label="Anomalies detectees" value={totalAnomalies} />
        <MetricTile label="Confiance moyenne" value={formatPercent(avgConfidence)} />
        <MetricTile label="Drift moyen" value={formatPercent(avgDrift)} />
      </div>

      <div className="aiChartsGrid">
        <div className="card chartPanel">
          <div className="cardHeader">
            <h2>Niveaux d'analyse</h2>
          </div>
          <div className="cardBody donutPanel">
            <DonutChart items={mapToPoints(byLevel)} />
            <Legend items={mapToPoints(byLevel)} />
          </div>
        </div>

        <div className="card chartPanel">
          <div className="cardHeader">
            <h2>Types de modeles</h2>
          </div>
          <div className="cardBody">
            <HorizontalBars items={mapToPoints(byType)} tone="blue" />
          </div>
        </div>

        <div className="card chartPanel">
          <div className="cardHeader">
            <h2>Statut operationnel</h2>
          </div>
          <div className="cardBody">
            <StackedStatusBar counts={byStatus} total={Math.max(totalModels, 1)} />
            <HorizontalBars items={mapToPoints(byStatus)} tone="teal" />
          </div>
        </div>

        <div className="card chartPanel">
          <div className="cardHeader">
            <h2>Top detections</h2>
          </div>
          <div className="cardBody">
            <HorizontalBars items={topModels.map((model) => ({ label: model.name, value: model.anomalies_detected }))} tone="orange" />
          </div>
        </div>
      </div>

      <div className="card modelHeatmapCard">
        <div className="cardHeader">
          <h2>Matrice modeles par niveau</h2>
        </div>
        <div className="cardBody modelHeatmap">
          <strong>Niveau</strong>
          <strong>Active</strong>
          <strong>Training</strong>
          <strong>Experimental</strong>
          <strong>Inactive</strong>
          {heatmapRows.map((row) => (
            <div className="modelHeatmapRow" key={row.level}>
              <span>{row.level}</span>
              <HeatCell value={row.active} />
              <HeatCell value={row.training} />
              <HeatCell value={row.experimental} />
              <HeatCell value={row.inactive} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card aiMetricTile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DonutChart({ items }: { items: ChartPoint[] }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.value, 0));
  let offset = 25;
  return (
    <svg className="donutChart" viewBox="0 0 42 42" role="img" aria-label="Distribution des modeles par niveau">
      <circle className="donutBase" cx="21" cy="21" r="15.915" />
      {items.map((item) => {
        const dash = (item.value / total) * 100;
        const circle = (
          <circle
            className="donutSegment"
            cx="21"
            cy="21"
            key={item.label}
            r="15.915"
            stroke={LEVEL_COLORS[item.label] || "#2563eb"}
            strokeDasharray={`${dash} ${100 - dash}`}
            strokeDashoffset={offset}
          />
        );
        offset -= dash;
        return circle;
      })}
      <text x="21" y="20" textAnchor="middle" className="donutValue">{total}</text>
      <text x="21" y="25" textAnchor="middle" className="donutLabel">modeles</text>
    </svg>
  );
}

function Legend({ items }: { items: ChartPoint[] }) {
  return (
    <div className="chartLegend">
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ background: LEVEL_COLORS[item.label] || "#2563eb" }} />
          {item.label} <strong>{item.value}</strong>
        </span>
      ))}
    </div>
  );
}

function HorizontalBars({ items, tone }: { items: ChartPoint[]; tone: "blue" | "teal" | "orange" }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="chartBars">
      {items.map((item) => (
        <div className="chartBarRow" key={item.label}>
          <span title={item.label}>{item.label}</span>
          <div className="chartBarTrack">
            <div className={`chartBarFill ${tone}`} style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }} />
          </div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function StackedStatusBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  const statuses = ["active", "training", "experimental", "inactive"];
  return (
    <div className="statusStack">
      {statuses.map((status) => (
        <span
          className={`statusStackSegment ${status}`}
          key={status}
          style={{ width: `${((counts[status] || 0) / total) * 100}%` }}
          title={`${status}: ${counts[status] || 0}`}
        />
      ))}
    </div>
  );
}

function HeatCell({ value }: { value: number }) {
  const level = value >= 4 ? "hot" : value >= 2 ? "warm" : value === 1 ? "cool" : "empty";
  return <span className={`modelHeatCell ${level}`}>{value}</span>;
}

function countBy(models: AiModel[], keyFor: (model: AiModel) => string) {
  return models.reduce<Record<string, number>>((acc, model) => {
    const key = keyFor(model);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function mapToPoints(input: Record<string, number>) {
  return Object.entries(input)
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

function analysisLevelForModel(model: AiModel) {
  if (model.id.startsWith("event_")) return "event";
  if (model.id.startsWith("temporal_") || model.id.includes("gru_sequence")) return "temporal";
  if (model.id.startsWith("flow_")) return "flow";
  if (model.id.startsWith("graph_") || model.type === "graph_ai") return "graph";
  if (model.objective.toLowerCase().includes("acteur") || model.objective.toLowerCase().includes("actor")) return "actor";
  if (model.id.includes("ensemble") || model.id.includes("hybrid")) return "platform";
  return "global";
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPercent(value: number | null) {
  if (value === null) return "N/A";
  return `${Math.round(value * 100)}%`;
}
