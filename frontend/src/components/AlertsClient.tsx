"use client";

import { useEffect, useMemo, useState } from "react";
import { AiResult, FlowMetric, Severity, fetchAiResults, fetchFlowMetrics } from "@/lib/api";
import { IncidentTable } from "./IncidentTable";

const severities: Array<"all" | Severity> = ["all", "critical", "high", "medium", "low"];

export function AlertsClient() {
  const [results, setResults] = useState<AiResult[]>([]);
  const [flows, setFlows] = useState<FlowMetric[]>([]);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [analysisType, setAnalysisType] = useState("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [data, flowData] = await Promise.all([fetchAiResults(300), fetchFlowMetrics()]);
        if (active) {
          setResults(data);
          setFlows(flowData);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Erreur de chargement");
        }
      }
    }

    load();
    const timer = window.setInterval(load, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const flowNames = useMemo(() => new Map(flows.map((flow) => [flow.flow_code, flow.flow_name])), [flows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return results.filter((item) => {
      const matchesQuery =
        !needle ||
        item.detected_anomaly_type.toLowerCase().includes(needle) ||
        (item.flow_code || "").toLowerCase().includes(needle) ||
        (flowNames.get(item.flow_code || "") || "").toLowerCase().includes(needle) ||
        (item.recommendation || "").toLowerCase().includes(needle);

      const matchesSeverity = severity === "all" || item.severity === severity;
      const matchesAnalysis = analysisType === "all" || item.analysis_type === analysisType;
      return matchesQuery && matchesSeverity && matchesAnalysis;
    });
  }, [analysisType, flowNames, query, results, severity]);

  const realtimeCount = results.filter((item) => item.analysis_type === "realtime").length;
  const historicalCount = results.filter((item) => item.analysis_type === "historical").length;

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>Alertes IA</h1>
          <p>Liste exploitable des anomalies, scores, severites, flows et recommandations.</p>
        </div>
        <span className="statusPill">{filtered.length} visibles</span>
      </div>

      {error && <div className="errorBox">Impossible de charger les alertes: {error}</div>}

      <section className="analysisSplit">
        <button className={`splitButton ${analysisType === "all" ? "active" : ""}`} onClick={() => setAnalysisType("all")}>
          Toutes
          <strong>{results.length}</strong>
        </button>
        <button className={`splitButton ${analysisType === "realtime" ? "active" : ""}`} onClick={() => setAnalysisType("realtime")}>
          Temps reel
          <strong>{realtimeCount}</strong>
        </button>
        <button className={`splitButton ${analysisType === "historical" ? "active" : ""}`} onClick={() => setAnalysisType("historical")}>
          Historique / ML-DL
          <strong>{historicalCount}</strong>
        </button>
      </section>

      <div className="alertToolbar">
        <input
          className="input"
          placeholder="Rechercher type, flow ou recommandation"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="select" value={severity} onChange={(event) => setSeverity(event.target.value as "all" | Severity)}>
          {severities.map((item) => (
            <option key={item} value={item}>
              {item === "all" ? "Toutes severites" : item}
            </option>
          ))}
        </select>
        <select className="select" value={analysisType} onChange={(event) => setAnalysisType(event.target.value)}>
          <option value="all">Toutes analyses</option>
          <option value="realtime">Realtime</option>
          <option value="historical">Historique / ML</option>
        </select>
      </div>

      <div className="card">
        <div className="cardBody">
          <IncidentTable results={filtered} flowNames={flowNames} />
        </div>
      </div>
    </>
  );
}
