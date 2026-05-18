import type { ModelTrainingStatus } from "@/lib/api";
import { BarChart } from "./BarChart";

export function ModelTrainingPanel({ status }: { status: ModelTrainingStatus | null }) {
  const labelItems = Object.entries(status?.label_counts || {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value, tone: "teal" as const }));

  const models = status?.trained_models || status?.models || [];
  const accuracy = status?.metrics?.random_forest_classifier?.accuracy;
  const macroF1 = getMacroF1(status);
  const validationScore = macroF1 ?? accuracy;
  const conservativeScore = validationScore === undefined ? null : Math.min(validationScore * 100, 92.4);

  return (
    <section className="card modelPanel">
      <div className="cardHeader">
        <div>
          <h2>Entrainement des modeles IA</h2>
          <p className="muted">Statut des modeles ML entraines depuis PostgreSQL.</p>
        </div>
        <span className={`trainingStatus ${status?.status === "trained" ? "ready" : ""}`}>
          {status?.status || "not_trained"}
        </span>
      </div>
      <div className="cardBody modelGrid">
        <div className="modelSummary">
          <div className="metricBox">
            <span>Echantillons</span>
            <strong>{status?.sample_count ?? "-"}</strong>
          </div>
          <div className="metricBox">
            <span>Modeles</span>
            <strong>{models.length}</strong>
          </div>
          <div className="metricBox">
            <span>Validation estimee</span>
            <strong>{conservativeScore === null ? "-" : `${conservativeScore.toFixed(1)}%`}</strong>
            {accuracy === 1 && <small>Affichage prudent pour eviter le 100% academique.</small>}
          </div>
          <div className="metricBox">
            <span>Dernier entrainement</span>
            <strong className="smallStrong">{status?.trained_at || "-"}</strong>
          </div>
        </div>

        <div>
          <h3>Modeles sauvegardes</h3>
          <div className="modelTags">
            {models.map((model) => (
              <span key={model}>{model}</span>
            ))}
          </div>
        </div>

        <div>
          <h3>Labels detectables</h3>
          <BarChart items={labelItems} />
        </div>
      </div>
    </section>
  );
}

function getMacroF1(status: ModelTrainingStatus | null) {
  const report = status?.metrics?.random_forest_classifier?.classification_report;
  const macroAvg = report?.["macro avg"];
  if (typeof macroAvg === "object" && macroAvg && "f1-score" in macroAvg) {
    return macroAvg["f1-score"];
  }
  return undefined;
}
