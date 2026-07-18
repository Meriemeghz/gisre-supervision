"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AiResult, fetchAiResults } from "@/lib/api";
import { SeverityBadge } from "./SeverityBadge";

export function IncidentDetailClient({ id }: { id: string }) {
  const [incident, setIncident] = useState<AiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAiResults(300);
        const found = data.find((item) => item.id === id) || null;
        setIncident(found);
        setError(found ? null : "Incident introuvable dans les resultats recents");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de chargement");
      }
    }

    load();
  }, [id]);

  const model = useMemo(() => {
    const metadata = incident?.metadata || {};
    const modelMetadata = metadata.model;
    if (isModelMetadata(modelMetadata)) {
      return modelMetadata;
    }
    if (incident?.analysis_type === "realtime") {
      return {
        id: "event_rules_engine",
        name: "Event-Level Rules Engine",
        family: "event_level",
      };
    }
    return null;
  }, [incident]);

  if (error) {
    return (
      <>
        <div className="pageHeader">
          <div>
            <h1>Detail incident</h1>
            <p>Analyse IA et contexte technique.</p>
          </div>
          <Link className="button" href="/investigations">
            Retour
          </Link>
        </div>
        <div className="errorBox">{error}</div>
      </>
    );
  }

  if (!incident) {
    return (
      <div className="pageHeader">
        <div>
          <h1>Detail incident</h1>
          <p>Chargement...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>{incident.detected_anomaly_type}</h1>
          <p>
            Flow {incident.flow_code || "n/a"} - score {incident.risk_score} - {incident.analysis_type}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {model && <span className="modelDetectionBadge rules"><span>{model.name}</span><small>{model.family}</small></span>}
          <SeverityBadge anomalyType={incident.detected_anomaly_type} severity={incident.severity} />
          <Link className="button" href="/investigations">
            Retour
          </Link>
        </div>
      </div>

      <section className="detailGrid">
        <div className="grid">
          <div className="card">
            <div className="cardHeader">
              <h2>Resultat IA</h2>
            </div>
            <div className="cardBody">
              <div className="kv">
                <span>Incident</span>
                <strong>{incident.detected_anomaly_type}</strong>
              </div>
              <div className="kv">
                <span>Risk score</span>
                <strong>{incident.risk_score}</strong>
              </div>
              <div className="kv">
                <span>Confidence</span>
                <strong>{incident.confidence ?? "n/a"}</strong>
              </div>
              <div className="kv">
                <span>Explication</span>
                <span>{incident.explanation || "n/a"}</span>
              </div>
              <div className="kv">
                <span>Recommandation</span>
                <strong>{incident.recommendation || "A confirmer"}</strong>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <h2>Modele utilise</h2>
            </div>
            <div className="cardBody modelUsedPanel">
              {model ? (
                <>
                  <div className="modelUsedIcon">IA</div>
                  <div>
                    <span className="sectionEyebrow">Detecteur actif</span>
                    <h3>{model.name}</h3>
                    <p>
                      Cette anomalie a ete detectee au niveau event-level par le moteur de regles temps reel.
                    </p>
                    <div className="modelUsedMeta">
                      <span>ID: {model.id}</span>
                      <span>Famille: {model.family}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p className="muted">Detection par analyse historique ou statistique sans modele specifique expose.</p>
              )}
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="cardHeader">
              <h2>Evenement</h2>
            </div>
            <div className="cardBody">
              <div className="kv">
                <span>Source event</span>
                <span>{incident.source_event_type}</span>
              </div>
              <div className="kv">
                <span>Source ID</span>
                <span>{incident.source_event_id || "n/a"}</span>
              </div>
              <div className="kv">
                <span>Correlation</span>
                <span>{String(incident.metadata?.correlation_id || "n/a")}</span>
              </div>
              <div className="kv">
                <span>Date detection</span>
                <span>{incident.detected_at}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <h2>Validation & metadata</h2>
            </div>
            <div className="cardBody">
              <pre>{JSON.stringify({ validation: incident.validation, metadata: incident.metadata }, null, 2)}</pre>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function isModelMetadata(value: unknown): value is { id: string; name: string; family: string } {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.name === "string" && typeof candidate.family === "string";
}
