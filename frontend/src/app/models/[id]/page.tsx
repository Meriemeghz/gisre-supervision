"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAiModel, getAiModelImprovements, getAiModelResults } from "@/lib/api/ai-models";
import type { AiModel, AiModelImprovement, AiModelResult } from "@/types/ai-models";
import { ModelImprovementsTimeline } from "@/components/models/ModelImprovementsTimeline";
import { ModelMetrics } from "@/components/models/ModelMetrics";
import { ModelResultsTable } from "@/components/models/ModelResultsTable";
import { statusClass } from "@/components/models/ModelCard";
import { BarChart } from "@/components/BarChart";

export default function ModelDetailPage({ params }: { params: { id: string } }) {
  const [model, setModel] = useState<AiModel | null>(null);
  const [results, setResults] = useState<AiModelResult[]>([]);
  const [improvements, setImprovements] = useState<AiModelImprovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [modelData, resultData, improvementData] = await Promise.all([
          getAiModel(params.id),
          getAiModelResults(params.id),
          getAiModelImprovements(params.id),
        ]);
        setModel(modelData);
        setResults(resultData);
        setImprovements(improvementData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [params.id]);

  const confidenceTrend = useMemo(
    () => (model?.metrics.confidence_trend || []).map((item) => ({ label: item.date, value: item.value, tone: "blue" as const })),
    [model],
  );
  const anomaliesByDay = useMemo(
    () => (model?.metrics.anomalies_by_day || []).map((item) => ({ label: item.date, value: item.count, tone: "teal" as const })),
    [model],
  );
  const anomaliesByType = useMemo(
    () => (model?.metrics.anomalies_by_type || []).map((item) => ({ label: item.type, value: item.count, tone: "orange" as const })),
    [model],
  );

  if (loading) {
    return <div className="card cardBody">Chargement du modele...</div>;
  }

  if (error || !model) {
    return (
      <>
        <div className="pageHeader">
          <div>
            <h1>Modele introuvable</h1>
            <p>{error || "Aucun modele ne correspond a cet identifiant."}</p>
          </div>
          <Link className="button" href="/models">Retour</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>{model.name}</h1>
          <p>{model.description}</p>
        </div>
        <div className="headerStatus">
          <span className={`modelStatus ${statusClass(model.status)}`}>{model.status}</span>
          <Link className="button" href="/models">Retour</Link>
        </div>
      </div>

      <section className="modelDetailHero card">
        <div>
          <span className="sectionEyebrow">{model.type} - v{model.version}</span>
          <h2>{model.objective}</h2>
          <p>{model.description}</p>
        </div>
        <div className="modelLabels">
          {model.target_anomalies.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <section className="grid kpiGrid">
        <div className="card kpi"><span>Developpement</span><strong>{model.developed_at}</strong></div>
        <div className="card kpi"><span>Dernier entrainement</span><strong className="smallStrong">{model.last_training_at || "N/A"}</strong></div>
        <div className="card kpi"><span>Derniere amelioration</span><strong>{model.last_improvement_at}</strong></div>
        <div className="card kpi"><span>Evenements analyses</span><strong>{model.analyzed_events}</strong></div>
        <div className="card kpi"><span>Anomalies detectees</span><strong>{model.anomalies_detected}</strong></div>
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader"><h2>Informations generales</h2></div>
          <div className="cardBody">
            <div className="kv"><span>Dataset</span><strong>{model.dataset}</strong></div>
            <div className="kv"><span>Periode d'entrainement</span><span>{model.training_period}</span></div>
            <div className="kv"><span>Sources</span><span>{model.data_sources.join(", ")}</span></div>
            <div className="modelLabels featureList">{model.features.map((item) => <span key={item}>{item}</span>)}</div>
          </div>
        </div>

        <div className="card">
          <div className="cardHeader"><h2>Metriques de performance</h2></div>
          <div className="cardBody"><ModelMetrics model={model} /></div>
        </div>
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader"><h2>Derniers resultats du modele</h2></div>
          <div className="cardBody"><ModelResultsTable results={results} /></div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="cardHeader"><h2>Score confiance / F1</h2></div>
            <div className="cardBody"><BarChart items={confidenceTrend} /></div>
          </div>
          <div className="card">
            <div className="cardHeader"><h2>Anomalies par jour</h2></div>
            <div className="cardBody"><BarChart items={anomaliesByDay} /></div>
          </div>
          <div className="card">
            <div className="cardHeader"><h2>Repartition par type</h2></div>
            <div className="cardBody"><BarChart items={anomaliesByType} /></div>
          </div>
        </div>
      </section>

      <section className="card modelPanel">
        <div className="cardHeader"><h2>Historique des ameliorations</h2></div>
        <div className="cardBody"><ModelImprovementsTimeline improvements={improvements} /></div>
      </section>
    </>
  );
}
