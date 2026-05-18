import type { AiModelResult } from "@/types/ai-models";
import { SeverityBadge } from "@/components/SeverityBadge";

export function ModelResultsTable({ results }: { results: AiModelResult[] }) {
  if (results.length === 0) {
    return <p className="muted">Aucun resultat recent pour ce modele.</p>;
  }

  return (
    <div className="tableScroll">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Flow/API</th>
            <th>Anomalie</th>
            <th>Risque</th>
            <th>Severite</th>
            <th>Confiance</th>
            <th>Resultat</th>
            <th>Validation</th>
          </tr>
        </thead>
        <tbody>
          {results.map((item) => (
            <tr key={item.id}>
              <td>{item.date}</td>
              <td>{item.flow_or_api}</td>
              <td className="typeCell">{item.anomaly_type}</td>
              <td className="score">{item.risk_score}</td>
              <td><SeverityBadge severity={item.severity} /></td>
              <td>{item.confidence === null ? "N/A" : `${Math.round(item.confidence * 100)}%`}</td>
              <td><span className={`eventStatus ${item.result === "anomaly" ? "failed" : "ok"}`}>{item.result}</span></td>
              <td>{item.validation || "N/A"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
