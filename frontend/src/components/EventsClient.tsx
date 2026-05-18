"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiCallEvent, AuditEvent, FlowMetric, fetchApiEvents, fetchAuditEvents, fetchFlowMetrics } from "@/lib/api";

type UnifiedEvent = {
  id: string;
  source: "api_call" | "audit_event";
  flow_code: string | null;
  api_code: string | null;
  actor: string | null;
  status: string;
  latency: number | null;
  success: boolean | null;
  correlation_id: string | null;
  timestamp: string;
  raw: ApiCallEvent | AuditEvent;
};

export function EventsClient() {
  const [apiEvents, setApiEvents] = useState<ApiCallEvent[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [flows, setFlows] = useState<FlowMetric[]>([]);
  const [source, setSource] = useState<"all" | "api_call" | "audit_event">("all");
  const [query, setQuery] = useState("");
  const [analysisLevel, setAnalysisLevel] = useState("");
  const [anomalyFamily, setAnomalyFamily] = useState("");
  const [simulationMode, setSimulationMode] = useState("");
  const [criticality, setCriticality] = useState("");
  const [selected, setSelected] = useState<UnifiedEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [apiData, auditData, flowData] = await Promise.all([fetchApiEvents(500), fetchAuditEvents(500), fetchFlowMetrics()]);
        if (active) {
          setApiEvents(apiData);
          setAuditEvents(auditData);
          setFlows(flowData);
          setLastUpdated(new Date());
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

  const events = useMemo(() => {
    const apiRows: UnifiedEvent[] = apiEvents.map((event) => ({
      id: event.id,
      source: "api_call",
      flow_code: event.flow_code,
      api_code: event.api_code || null,
      actor: event.consumer_code ? `${event.consumer_code} -> ${event.producer_code || "producer"}` : null,
      status: event.status_code ? `${event.status_code}${event.error_type ? ` / ${event.error_type}` : ""}` : "n/a",
      latency: event.latency_ms,
      success: event.success,
      correlation_id: event.correlation_id || null,
      timestamp: event.called_at,
      raw: event,
    }));

    const auditRows: UnifiedEvent[] = auditEvents.map((event) => ({
      id: event.id,
      source: "audit_event",
      flow_code: event.flow_code,
      api_code: event.api_code || null,
      actor: event.actor_code || null,
      status: `${event.action || "action"} / ${event.outcome || "outcome"}`,
      latency: null,
      success: event.outcome ? event.outcome === "success" : null,
      correlation_id: event.correlation_id || null,
      timestamp: event.event_timestamp,
      raw: event,
    }));

    return [...apiRows, ...auditRows].sort((left, right) => parseDate(right.timestamp) - parseDate(left.timestamp));
  }, [apiEvents, auditEvents]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      const matchesSource = source === "all" || event.source === source;
      const flowLabel = flowNames.get(event.flow_code || "") || "";
      const raw = event.raw as ApiCallEvent | AuditEvent;
      const matchesAnalysisLevel = !analysisLevel || raw.analysis_level === analysisLevel;
      const matchesAnomalyFamily = !anomalyFamily || raw.anomaly_family === anomalyFamily;
      const matchesSimulationMode = !simulationMode || raw.simulation_mode === simulationMode;
      const matchesCriticality =
        !criticality ||
        (raw as ApiCallEvent).flow_criticality === criticality ||
        (raw as ApiCallEvent).producer_criticality === criticality ||
        (raw as ApiCallEvent).api_criticality === criticality;
      const matchesQuery =
        !needle ||
        event.id.toLowerCase().includes(needle) ||
        event.source.toLowerCase().includes(needle) ||
        (event.flow_code || "").toLowerCase().includes(needle) ||
        flowLabel.toLowerCase().includes(needle) ||
        (event.api_code || "").toLowerCase().includes(needle) ||
        (event.actor || "").toLowerCase().includes(needle) ||
        (event.status || "").toLowerCase().includes(needle) ||
        (event.correlation_id || "").toLowerCase().includes(needle);

      return matchesSource && matchesQuery && matchesAnalysisLevel && matchesAnomalyFamily && matchesSimulationMode && matchesCriticality;
    });
  }, [analysisLevel, anomalyFamily, criticality, events, flowNames, query, simulationMode, source]);

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>Evenements simulateur</h1>
          <p>Journal brut des appels API et evenements d'audit recus depuis Kafka puis stockes dans PostgreSQL.</p>
        </div>
        <div className="headerStatus">
          <span className="statusPill">{filtered.length} visibles</span>
          <span className="lastUpdated">Derniere mise a jour: {lastUpdated ? formatTime(lastUpdated) : "-"}</span>
        </div>
      </div>

      {error && <div className="errorBox">Impossible de charger les evenements: {error}</div>}

      <section className="analysisSplit">
        <button className={`splitButton ${source === "all" ? "active" : ""}`} onClick={() => setSource("all")}>
          Tous
          <strong>{events.length}</strong>
        </button>
        <button className={`splitButton ${source === "api_call" ? "active" : ""}`} onClick={() => setSource("api_call")}>
          API calls
          <strong>{apiEvents.length}</strong>
        </button>
        <button className={`splitButton ${source === "audit_event" ? "active" : ""}`} onClick={() => setSource("audit_event")}>
          Audit events
          <strong>{auditEvents.length}</strong>
        </button>
      </section>

      <div className="alertToolbar">
        <input
          className="input"
          placeholder="Rechercher flow, API, acteur, statut, correlation ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="select" value={source} onChange={(event) => setSource(event.target.value as "all" | "api_call" | "audit_event")}>
          <option value="all">Toutes sources</option>
          <option value="api_call">API calls</option>
          <option value="audit_event">Audit events</option>
        </select>
        <select className="select" value={analysisLevel} onChange={(event) => setAnalysisLevel(event.target.value)}>
          <option value="">Tous niveaux IA</option>
          <option value="event">Event</option>
          <option value="flow">Flow</option>
          <option value="actor">Actor</option>
          <option value="temporal">Temporal</option>
          <option value="graph">Graph</option>
          <option value="platform">Platform</option>
        </select>
        <select className="select" value={anomalyFamily} onChange={(event) => setAnomalyFamily(event.target.value)}>
          <option value="">Toutes familles</option>
          <option value="performance">Performance</option>
          <option value="reliability">Reliability</option>
          <option value="traffic">Traffic</option>
          <option value="security">Security</option>
          <option value="behavior">Behavior</option>
          <option value="dependency">Dependency</option>
          <option value="traceability">Traceability</option>
          <option value="platform">Platform</option>
        </select>
        <select className="select" value={simulationMode} onChange={(event) => setSimulationMode(event.target.value)}>
          <option value="">Tous modes</option>
          <option value="normal">Normal</option>
          <option value="degraded">Degraded</option>
          <option value="incident">Incident</option>
          <option value="recovery">Recovery</option>
        </select>
        <select className="select" value={criticality} onChange={(event) => setCriticality(event.target.value)}>
          <option value="">Toutes criticites</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <section className="detailGrid">
        <div className="card">
          <div className="cardHeader">
            <h2>Evenements recents</h2>
          </div>
          <div className="cardBody tableScroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Flux metier</th>
                  <th>API</th>
                  <th>Acteur</th>
                  <th>Statut</th>
                  <th>IA</th>
                  <th>Criticite</th>
                  <th>Latence</th>
                  <th>Date</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((event) => (
                  <tr key={`${event.source}-${event.id}`}>
                    <td>
                      <span className={`sourceBadge ${event.source}`}>{event.source}</span>
                    </td>
                    <td>
                      <strong>{flowNames.get(event.flow_code || "") || event.flow_code || "n/a"}</strong>
                      {event.flow_code && <small className="flowCode">{event.flow_code}</small>}
                    </td>
                    <td>{event.api_code || "n/a"}</td>
                    <td>{event.actor || "n/a"}</td>
                    <td>
                      <span className={event.success === false ? "eventStatus failed" : "eventStatus ok"}>{event.status}</span>
                    </td>
                    <td>
                      <small>{(event.raw as ApiCallEvent | AuditEvent).analysis_level || "normal"} / {(event.raw as ApiCallEvent | AuditEvent).anomaly_family || "-"}</small>
                    </td>
                    <td>
                      {event.source === "api_call" ? <small>{(event.raw as ApiCallEvent).flow_criticality || "-"}</small> : "-"}
                    </td>
                    <td>{event.latency === null ? "-" : `${event.latency} ms`}</td>
                    <td>{formatDate(event.timestamp)}</td>
                    <td>
                      <button className="button" onClick={() => setSelected(event)}>
                        Voir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="cardHeader">
            <h2>Detail brut</h2>
          </div>
          <div className="cardBody">
            {selected ? (
              <pre>{JSON.stringify(selected.raw, null, 2)}</pre>
            ) : (
              <p className="muted">Selectionne un evenement pour consulter le payload stocke.</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function parseDate(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(value: string) {
  const timestamp = parseDate(value);
  if (!timestamp) {
    return value;
  }
  return new Date(timestamp).toLocaleString("fr-FR");
}
