import type { AiModelResult } from "@/types/ai-models";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#d97706",
  medium: "#ca8a04",
  low: "#15803d",
};

export function ModelResultVisuals({ results }: { results: AiModelResult[] }) {
  const anomalyResults = results.filter((result) => result.result === "anomaly" && result.anomaly_type !== "NORMAL");

  if (anomalyResults.length === 0) {
    return <p className="muted">Aucun resultat recent a visualiser.</p>;
  }

  const ordered = [...anomalyResults].reverse();
  const severityCounts = countBy(anomalyResults, (result) => result.severity);
  const typeCounts = countBy(anomalyResults, (result) => result.anomaly_type);
  const maxTypeCount = Math.max(1, ...Object.values(typeCounts));
  const avgRisk = Math.round(anomalyResults.reduce((sum, result) => sum + result.risk_score, 0) / anomalyResults.length);
  const criticalCount = anomalyResults.filter((result) => result.severity === "critical").length;

  return (
    <div className="resultVisualGrid">
      <div className="resultVisualMain">
        <div className="resultVisualHeader">
          <div>
            <span>Risque moyen</span>
            <strong>{avgRisk}/100</strong>
          </div>
          <div>
            <span>Critiques</span>
            <strong>{criticalCount}</strong>
          </div>
          <div>
            <span>Resultats</span>
            <strong>{anomalyResults.length}</strong>
          </div>
        </div>
        <RiskLineChart results={ordered} />
      </div>

      <div className="resultVisualSide">
        <SeverityDonut counts={severityCounts} />
        <div className="resultTypeBars">
          {Object.entries(typeCounts).slice(0, 6).map(([type, count]) => (
            <div className="resultTypeRow" key={type}>
              <span title={type}>{type}</span>
              <div>
                <i style={{ width: `${Math.max(8, (count / maxTypeCount) * 100)}%` }} />
              </div>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RiskLineChart({ results }: { results: AiModelResult[] }) {
  const width = 560;
  const height = 180;
  const padding = 18;
  const points = results.map((result, index) => {
    const x = padding + (index / Math.max(1, results.length - 1)) * (width - padding * 2);
    const y = height - padding - (Math.max(0, Math.min(100, result.risk_score)) / 100) * (height - padding * 2);
    return { x, y, result };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <svg className="riskLineChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolution du risque des resultats recents">
      <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} className="chartAxis" />
      <line x1={padding} x2={padding} y1={padding} y2={height - padding} className="chartAxis" />
      <line x1={padding} x2={width - padding} y1={height - padding - 0.8 * (height - padding * 2)} y2={height - padding - 0.8 * (height - padding * 2)} className="chartThreshold" />
      <path d={path} className="riskLinePath" />
      {points.map((point) => (
        <circle
          className="riskLinePoint"
          cx={point.x}
          cy={point.y}
          fill={SEVERITY_COLORS[point.result.severity] || "#2563eb"}
          key={point.result.id}
          r="4"
        />
      ))}
      <text x={padding + 4} y={height - padding - 0.8 * (height - padding * 2) - 6} className="chartThresholdLabel">critical</text>
    </svg>
  );
}

function SeverityDonut({ counts }: { counts: Record<string, number> }) {
  const total = Math.max(1, Object.values(counts).reduce((sum, value) => sum + value, 0));
  let offset = 25;
  return (
    <div className="severityDonutBlock">
      <svg className="severityDonut" viewBox="0 0 42 42" role="img" aria-label="Repartition par severite">
        <circle className="donutBase" cx="21" cy="21" r="15.915" />
        {Object.entries(counts).map(([severity, count]) => {
          const dash = (count / total) * 100;
          const segment = (
            <circle
              className="donutSegment"
              cx="21"
              cy="21"
              key={severity}
              r="15.915"
              stroke={SEVERITY_COLORS[severity] || "#64748b"}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={offset}
            />
          );
          offset -= dash;
          return segment;
        })}
        <text x="21" y="22" textAnchor="middle" className="donutValue">{total}</text>
      </svg>
      <div className="severityLegend">
        {Object.entries(counts).map(([severity, count]) => (
          <span key={severity}><i style={{ background: SEVERITY_COLORS[severity] || "#64748b" }} />{severity}<strong>{count}</strong></span>
        ))}
      </div>
    </div>
  );
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = keyFor(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}
