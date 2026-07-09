import type { AiModel } from "@/types/ai-models";

const supervisedMetrics = ["accuracy", "precision", "recall", "f1_score", "auc", "false_positive_rate", "false_negative_rate"];
const deepMetrics = ["loss", "validation_loss", "reconstruction_error", "detection_threshold"];
const unsupervisedMetrics = ["anomaly_rate", "silhouette_score", "contamination_rate"];
const rulesMetrics = ["active_rule_count", "triggered_rule_count", "rule_coverage", "validation_match_rate", "scoring_coverage", "recommendation_coverage", "avg_risk_score"];

export function ModelMetrics({ model }: { model: AiModel }) {
  const isRulesEngine = isDeterministicRules(model);
  const metricKeys =
    model.type === "supervised"
      ? supervisedMetrics
      : model.type === "deep learning"
        ? deepMetrics
        : isRulesEngine
          ? rulesMetrics
          : unsupervisedMetrics;

  const shared = isRulesEngine ? ["avg_inference_ms"] : ["avg_confidence", "avg_inference_ms"];

  return (
    <>
      <div className="modelMetricGrid">
        {[...metricKeys, ...shared].map((key) => (
          <div className="metricBox" key={key}>
            <span>{label(key)}</span>
            <strong>{formatMetric(key, model.metrics[key as keyof typeof model.metrics])}</strong>
          </div>
        ))}
      </div>
      <RulesAuditPanel model={model} />
      <ConfusionMatrixScores model={model} />
    </>
  );
}

function RulesAuditPanel({ model }: { model: AiModel }) {
  const rules = model.metrics.rule_definitions || [];
  if (!isDeterministicRules(model) && rules.length === 0) {
    return null;
  }
  const issues = model.metrics.rule_audit_issues || [];
  return (
    <div className="rulesAuditPanel">
      <div className="rulesAuditHeader">
        <div>
          <strong>Audit des regles Event-Level</strong>
          <span>{rules.length} regles declarees / statut {model.metrics.rule_audit_status || "N/A"}</span>
        </div>
        <span className={`modelStatus ${issues.length ? "warning" : "ready"}`}>{issues.length ? "issues" : "valid"}</span>
      </div>
      {issues.length > 0 && (
        <ul className="reasonList">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      <div className="rulesAuditList">
        {rules.map((rule) => (
          <div key={rule.anomaly_type}>
            <strong>{rule.anomaly_type}</strong>
            <span>{rule.condition}</span>
            <small>confidence {formatRatio(rule.confidence)} / score {rule.base_score ?? "N/A"}</small>
            <em>{rule.recommendation || "Recommendation manquante"}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function isDeterministicRules(model: AiModel) {
  return model.id === "event_rules_engine" || model.metrics.model_family === "deterministic_rules";
}

function ConfusionMatrixScores({ model }: { model: AiModel }) {
  const matrix = normalizeMatrix(model.metrics.confusion_matrix);
  if (!matrix) {
    return null;
  }

  const labels = matrix.map((_, index) => model.metrics.confusion_labels?.[index] || fallbackClassLabel(index, matrix.length));
  const scores = computeConfusionScores(matrix, labels);

  return (
    <div className="confusionScoresPanel">
      <div className="confusionScoresHeader">
        <div>
          <strong>Matrice de confusion</strong>
          <span>Scores one-vs-rest par classe</span>
        </div>
        <div className="confusionGlobalScores">
          <span>Accuracy <b>{formatRatio(scores.accuracy)}</b></span>
          <span>Macro F1 <b>{formatRatio(scores.macroF1)}</b></span>
          <span>Micro F1 <b>{formatRatio(scores.microF1)}</b></span>
        </div>
      </div>

      <div className="confusionMatrixGrid" style={{ gridTemplateColumns: `110px repeat(${matrix.length}, minmax(54px, 1fr))` }}>
        <span />
        {labels.map((item) => <strong key={`pred-${item}`}>Pred {item}</strong>)}
        {matrix.map((row, rowIndex) => (
          <div className="confusionMatrixRow" key={labels[rowIndex]}>
            <strong>Real {labels[rowIndex]}</strong>
            {row.map((value, columnIndex) => (
              <span className={rowIndex === columnIndex ? "diagonal" : ""} key={`${rowIndex}-${columnIndex}`}>{value}</span>
            ))}
          </div>
        ))}
      </div>

      <div className="confusionScoreTableWrap">
        <table className="table confusionScoreTable">
          <thead>
            <tr>
              <th>Classe</th>
              <th>TP</th>
              <th>FP</th>
              <th>FN</th>
              <th>TN</th>
              <th>Precision</th>
              <th>Recall</th>
              <th>Specificity</th>
              <th>F1</th>
              <th>Support</th>
            </tr>
          </thead>
          <tbody>
            {scores.classes.map((item) => (
              <tr key={item.label}>
                <td><strong>{item.label}</strong></td>
                <td>{item.tp}</td>
                <td>{item.fp}</td>
                <td>{item.fn}</td>
                <td>{item.tn}</td>
                <td>{formatRatio(item.precision)}</td>
                <td>{formatRatio(item.recall)}</td>
                <td>{formatRatio(item.specificity)}</td>
                <td>{formatRatio(item.f1)}</td>
                <td>{item.support}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="confusionFormulaNote">
        <span>Precision = TP / (TP + FP)</span>
        <span>Recall = TP / (TP + FN)</span>
        <span>Specificity = TN / (TN + FP)</span>
        <span>F1 = 2PR / (P + R)</span>
      </div>
    </div>
  );
}

function normalizeMatrix(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const matrix = value.map((row) => (Array.isArray(row) ? row.map(Number) : []));
  const size = matrix.length;
  if (matrix.some((row) => row.length !== size || row.some((cell) => !Number.isFinite(cell)))) {
    return null;
  }
  return matrix;
}

function computeConfusionScores(matrix: number[][], labels: string[]) {
  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  const diagonal = matrix.reduce((sum, row, index) => sum + row[index], 0);
  const classes = matrix.map((row, index) => {
    const tp = row[index];
    const fn = row.reduce((sum, value, columnIndex) => (columnIndex === index ? sum : sum + value), 0);
    const fp = matrix.reduce((sum, currentRow, rowIndex) => (rowIndex === index ? sum : sum + currentRow[index]), 0);
    const tn = total - tp - fp - fn;
    const precision = safeDivide(tp, tp + fp);
    const recall = safeDivide(tp, tp + fn);
    const specificity = safeDivide(tn, tn + fp);
    const f1 = safeDivide(2 * precision * recall, precision + recall);
    return {
      label: labels[index],
      tp,
      fp,
      fn,
      tn,
      precision,
      recall,
      specificity,
      f1,
      support: tp + fn,
    };
  });
  const macroPrecision = average(classes.map((item) => item.precision));
  const macroRecall = average(classes.map((item) => item.recall));
  const macroF1 = average(classes.map((item) => item.f1));
  const microF1 = safeDivide(diagonal, total);
  return {
    classes,
    accuracy: safeDivide(diagonal, total),
    macroPrecision,
    macroRecall,
    macroF1,
    microF1,
  };
}

function fallbackClassLabel(index: number, size: number) {
  if (size === 2) {
    return index === 0 ? "normal" : "anomaly";
  }
  return ["normal", "anomaly", "critical"][index] || `class ${index + 1}`;
}

function safeDivide(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function label(key: string) {
  return key.replaceAll("_", " ");
}

function formatRatio(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMetric(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "N/A";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  if (key.includes("rate") || key.includes("coverage") || ["accuracy", "precision", "recall", "f1_score", "auc", "avg_confidence"].includes(key)) {
    return `${Math.round(numeric * 100)}%`;
  }
  if (key.includes("ms")) {
    return `${numeric} ms`;
  }
  return numeric.toFixed(3);
}
