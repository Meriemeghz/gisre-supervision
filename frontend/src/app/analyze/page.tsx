"use client";

import { FormEvent, useEffect, useState } from "react";
import { fetchFlowMetrics } from "@/lib/api";
import { getAiModels } from "@/lib/api/ai-models";
import { runHistoricalAnalysis } from "@/lib/api/historical-analysis";
import type { HistoricalAnalyzeResult } from "@/lib/api/historical-analysis";
import type { AiModel } from "@/types/ai-models";
import type { FlowMetric } from "@/lib/api";
import { SeverityBadge } from "@/components/SeverityBadge";

export default function AnalyzePage() {
  const [models, setModels] = useState<AiModel[]>([]);
  const [flows, setFlows] = useState<FlowMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HistoricalAnalyzeResult | null>(null);
  const [form, setForm] = useState({
    start_date: "",
    end_date: "",
    flow_code: "",
    api_name: "",
    producer: "",
    consumer: "",
    criticality: "all",
    event_type: "api_call",
    sample_size: 500,
    sampling_method: "latest",
    model_id: "isolation_forest",
  });

  useEffect(() => {
    async function load() {
      setModels(await getAiModels());
      setFlows(await fetchFlowMetrics());
    }
    load();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload = {
        ...form,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        flow_code: form.flow_code || undefined,
        api_name: form.api_name || undefined,
        producer: form.producer || undefined,
        consumer: form.consumer || undefined,
      };
      setResult(await runHistoricalAnalysis(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur analyse historique");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>Analyse historique personnalisee</h1>
          <p>Selectionne un echantillon PostgreSQL, choisis un modele IA, puis lance une investigation a la demande.</p>
        </div>
        <span className="statusPill">Investigation IA</span>
      </div>

      {error && <div className="errorBox">Impossible de lancer l'analyse: {error}</div>}

      <section className="analyzeLayout">
        <form className="card" onSubmit={submit}>
          <div className="cardHeader">
            <h2>Parametres d'analyse</h2>
          </div>
          <div className="cardBody analyzeForm">
            <label>
              Date debut
              <input className="input" type="datetime-local" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} />
            </label>
            <label>
              Date fin
              <input className="input" type="datetime-local" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} />
            </label>
            <label>
              Flow
              <select className="select" value={form.flow_code} onChange={(event) => setForm({ ...form, flow_code: event.target.value })}>
                <option value="">Tous les flows</option>
                {flows.map((flow) => (
                  <option key={flow.flow_code} value={flow.flow_code}>{flow.flow_code} - {flow.flow_name}</option>
                ))}
              </select>
            </label>
            <label>
              API
              <input className="input" placeholder="verify_health_coverage" value={form.api_name} onChange={(event) => setForm({ ...form, api_name: event.target.value })} />
            </label>
            <label>
              Producteur
              <input className="input" placeholder="CNSS / AMO" value={form.producer} onChange={(event) => setForm({ ...form, producer: event.target.value })} />
            </label>
            <label>
              Consommateur
              <input className="input" placeholder="Hopital_Rabat" value={form.consumer} onChange={(event) => setForm({ ...form, consumer: event.target.value })} />
            </label>
            <label>
              Criticite
              <select className="select" value={form.criticality} onChange={(event) => setForm({ ...form, criticality: event.target.value })}>
                <option value="all">Toutes</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label>
              Type evenement
              <select className="select" value={form.event_type} onChange={(event) => setForm({ ...form, event_type: event.target.value })}>
                <option value="api_call">Appels API</option>
                <option value="audit_event">Audit events</option>
              </select>
            </label>
            <label>
              Taille echantillon
              <input className="input" type="number" min={1} max={2000} value={form.sample_size} onChange={(event) => setForm({ ...form, sample_size: Number(event.target.value) })} />
            </label>
            <label>
              Methode echantillonnage
              <select className="select" value={form.sampling_method} onChange={(event) => setForm({ ...form, sampling_method: event.target.value })}>
                <option value="latest">Derniers evenements</option>
                <option value="random">Aleatoire</option>
                <option value="critical">Evenements critiques</option>
                <option value="by_flow">Par flow</option>
              </select>
            </label>
            <label>
              Modele IA
              <select className="select" value={form.model_id} onChange={(event) => setForm({ ...form, model_id: event.target.value })}>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </label>
            <button className="button primary analyzeButton" disabled={loading}>
              {loading ? "Analyse en cours..." : "Lancer l'analyse"}
            </button>
          </div>
        </form>

        <div className="grid">
          <div className="card">
            <div className="cardHeader"><h2>Resultat</h2></div>
            <div className="cardBody">
              {result ? <AnalysisSummary result={result} /> : <p className="muted">Aucune analyse lancee pour le moment.</p>}
            </div>
          </div>
          <div className="card">
            <div className="cardHeader"><h2>Anomalies detectees</h2></div>
            <div className="cardBody">
              {result ? <ResultTable result={result} /> : <p className="muted">Les anomalies apparaitront ici apres execution.</p>}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function AnalysisSummary({ result }: { result: HistoricalAnalyzeResult }) {
  return (
    <div className="analysisResultGrid">
      <div className="metricBox"><span>Analysis ID</span><strong className="smallStrong">{result.analysis_id}</strong></div>
      <div className="metricBox"><span>Modele</span><strong>{result.model_used}</strong></div>
      <div className="metricBox"><span>Records analyses</span><strong>{result.records_analyzed}</strong></div>
      <div className="metricBox"><span>Anomalies</span><strong>{result.anomalies_detected}</strong></div>
      <div className="metricBox"><span>Score moyen</span><strong>{result.average_risk_score}</strong></div>
      <div className="metricBox"><span>Critiques</span><strong>{result.critical_anomalies}</strong></div>
    </div>
  );
}

function ResultTable({ result }: { result: HistoricalAnalyzeResult }) {
  if (result.results.length === 0) {
    return <p className="muted">Aucune anomalie detectee sur cet echantillon.</p>;
  }

  return (
    <div className="tableScroll">
      <table className="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Flow</th>
            <th>Score</th>
            <th>Severite</th>
            <th>Diagnostic</th>
            <th>Recommandation</th>
          </tr>
        </thead>
        <tbody>
          {result.results.map((item, index) => (
            <tr key={`${item.detected_anomaly_type}-${index}`}>
              <td className="typeCell">{item.detected_anomaly_type}</td>
              <td>{item.flow_code || "n/a"}</td>
              <td className="score">{item.risk_score}</td>
              <td><SeverityBadge severity={item.severity as "low" | "medium" | "high" | "critical"} /></td>
              <td>{item.explanation}</td>
              <td>{item.recommendation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
