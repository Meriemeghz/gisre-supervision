import type { AiResult } from "@/lib/api";
import { BarChart } from "./BarChart";
import { IncidentTable } from "./IncidentTable";

export function AnalysisPanel({
  title,
  subtitle,
  results,
  tone,
  flowNames,
}: {
  title: string;
  subtitle: string;
  results: AiResult[];
  tone: "blue" | "teal";
  flowNames?: Map<string, string>;
}) {
  const anomalyResults = results.filter(isAnomalyResult);

  const byType = countBy(anomalyResults, (item) => item.detected_anomaly_type)
    .slice(0, 6)
    .map(([label, value]) => ({ label, value, tone }));

  const byFlow = countBy(anomalyResults, (item) => getFlowLabel(item.flow_code, flowNames))
    .slice(0, 6)
    .map(([label, value]) => ({ label, value, tone }));

  const avgScore =
    anomalyResults.length === 0
      ? "0.0"
      : (anomalyResults.reduce((sum, item) => sum + item.risk_score, 0) / anomalyResults.length).toFixed(1);

  return (
    <section className="analysisPanel">
      <div className="analysisHeader">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="analysisStats">
          <span>{anomalyResults.length} incidents</span>
          <strong>Score moyen {avgScore}</strong>
        </div>
      </div>

      <div className="analysisGrid">
        <div className="card">
          <div className="cardHeader">
            <h2>Derniers resultats</h2>
          </div>
          <div className="cardBody">
            <IncidentTable results={anomalyResults.slice(0, 6)} compact flowNames={flowNames} />
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="cardHeader">
              <h2>Types detectes</h2>
            </div>
            <div className="cardBody">
              <BarChart items={byType} />
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <h2>Flows concernes</h2>
            </div>
            <div className="cardBody">
              <BarChart items={byFlow} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function isAnomalyResult(item: AiResult) {
  return item.detected_anomaly_type !== "NORMAL" && Number(item.risk_score || 0) > 0;
}

function getFlowLabel(flowCode: string | null, flowNames?: Map<string, string>) {
  if (!flowCode) {
    return "unknown";
  }
  return flowNames?.get(flowCode) || flowCode;
}

function countBy(results: AiResult[], keyFn: (item: AiResult) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  results.forEach((item) => {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}
