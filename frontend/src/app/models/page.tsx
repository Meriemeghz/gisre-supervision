"use client";

import { useEffect, useMemo, useState } from "react";
import { getAiModelMetricsMap, getAiModels, getFeedbackDatasetSummary, getTrainingHistory } from "@/lib/api/ai-models";
import type { AiModel, AiModelMetrics } from "@/types/ai-models";
import { ModelCard } from "@/components/models/ModelCard";
import { ModelActivationConfiguration } from "@/components/models/ModelActivationConfiguration";
import { HumanFeedbackLearning } from "@/components/models/HumanFeedbackLearning";
import { RLDecisionPolicy } from "@/components/models/RLDecisionPolicy";
import { ModelsDashboardCharts } from "@/components/models/ModelsDashboardCharts";
import { ModelsTrainingHistory } from "@/components/models/ModelsTrainingHistory";
import { analysisLevel, ModelPerformanceMatrix } from "@/components/models/ModelPerformanceMatrix";

type ModelsTab = "catalogue" | "configuration" | "feedback" | "policy" | "history";

export default function ModelsPage() {
  const [models, setModels] = useState<AiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [level, setLevel] = useState("all");
  const [objective, setObjective] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ModelsTab>("catalogue");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const catalog = await getAiModels();
        if (!active) return;
        setModels(catalog);
        setError(null);
        setLoading(false);
        setMetricsLoading(true);
        getAiModelMetricsMap()
          .then((metricsByModel) => {
            if (!active) return;
            setModels((current) => current.map((model) => mergeModelMetrics(model, metricsByModel[model.id])));
          })
          .catch((err) => {
            if (!active) return;
            console.warn("[ModelsPage] background metrics unavailable", err);
          })
          .finally(() => {
            if (active) setMetricsLoading(false);
          });
        warmBackgroundData(catalog);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erreur de chargement");
        setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const objectiveNeedle = objective.trim().toLowerCase();
    return models.filter((model) => {
      const matchesStatus = status === "all" || model.status === status;
      const matchesType = type === "all" || model.type === type;
      const matchesLevel = level === "all" || analysisLevel(model) === level;
      const matchesObjective = !objectiveNeedle || model.objective.toLowerCase().includes(objectiveNeedle);
      const matchesQuery = !needle || model.name.toLowerCase().includes(needle);
      return matchesStatus && matchesType && matchesLevel && matchesObjective && matchesQuery;
    });
  }, [level, models, objective, query, status, type]);
  const levelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    models.forEach((model) => {
      const currentLevel = analysisLevel(model);
      counts.set(currentLevel, (counts.get(currentLevel) || 0) + 1);
    });
    return counts;
  }, [models]);
  const levelOptions = [
    { value: "all", label: "All Levels", count: models.length },
    { value: "event", label: "Event-Level", count: levelCounts.get("event") || 0 },
    { value: "temporal", label: "Temporal-Level", count: levelCounts.get("temporal") || 0 },
    { value: "flow", label: "Flow-Level", count: levelCounts.get("flow") || 0 },
    { value: "graph", label: "Graph-Level", count: levelCounts.get("graph") || 0 },
    { value: "actor", label: "Actor-Level", count: levelCounts.get("actor") || 0 },
    { value: "platform", label: "Platform-Level", count: levelCounts.get("platform") || 0 },
    { value: "global", label: "Global", count: levelCounts.get("global") || 0 },
  ];

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>Modeles IA</h1>
          <p>Catalogue, activation des modèles de production et historique MLOps par niveau d&apos;analyse.</p>
        </div>
        <span className="statusPill">
          {tab === "catalogue"
            ? `${level === "all" ? "Tous niveaux" : `${level} level`} / ${filtered.length} modeles`
            : tab === "configuration"
              ? "Production policy"
              : tab === "feedback"
                ? "Validated dataset"
                : tab === "policy"
                  ? "Decision policy"
                : "Lifecycle"}
        </span>
      </div>
      {metricsLoading && tab === "catalogue" && (
        <div className="modelsBackgroundLoad">Catalogue pret. Hydratation des metriques en arriere-plan...</div>
      )}

      {error && <div className="errorBox">API indisponible, fallback mock utilise: {error}</div>}

      <nav className="modelsPageTabs" aria-label="Navigation Modèles IA">
        {([
          ["catalogue", "Catalogue"],
          ["configuration", "Configuration"],
          ["feedback", "Human Feedback Learning"],
          ["policy", "Decision Policy"],
          ["history", "Training History"],
        ] as Array<[ModelsTab, string]>).map(([value, label]) => (
          <button
            className={tab === value ? "active" : ""}
            key={value}
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "catalogue" && (
        <>
          <section className="modelLevelSwitcher">
            {levelOptions.map((item) => (
              <button
                className={level === item.value ? "active" : ""}
                key={item.value}
                type="button"
                onClick={() => setLevel(item.value)}
              >
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </button>
            ))}
          </section>

          <section className="alertToolbar">
            <input className="input" placeholder="Rechercher par nom" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Tous statuts</option>
              <option value="active">Active</option>
              <option value="training">Training</option>
              <option value="experimental">Experimental</option>
              <option value="inactive">Inactive</option>
            </select>
            <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">Tous types</option>
              <option value="supervised">Supervised</option>
              <option value="unsupervised">Unsupervised</option>
              <option value="deep learning">Deep learning</option>
              <option value="statistical">Statistical / Rules</option>
              <option value="transformer">Transformer</option>
              <option value="graph_ai">Graph AI</option>
              <option value="experimental">Experimental</option>
            </select>
            <select className="select" value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="event">Event-Level</option>
              <option value="temporal">Temporal-Level</option>
              <option value="flow">Flow-Level</option>
              <option value="graph">Graph-Level</option>
              <option value="actor">Actor-Level</option>
              <option value="platform">Platform-Level</option>
              <option value="global">Global</option>
              <option value="all">Tous niveaux</option>
            </select>
            <input className="input" placeholder="Filtrer par objectif" value={objective} onChange={(event) => setObjective(event.target.value)} />
          </section>

          {loading && <ModelsCatalogueSkeleton />}
          {!loading && filtered.length === 0 && <div className="card cardBody">Aucun modele ne correspond aux filtres.</div>}
          {!loading && filtered.length > 0 && <ModelsDashboardCharts models={filtered} />}
          {!loading && filtered.length > 0 && <ModelPerformanceMatrix models={filtered} />}

          <section className="modelCardsGrid">
            {filtered.map((model) => (
              <ModelCard model={model} key={model.id} />
            ))}
          </section>
        </>
      )}

      {tab === "configuration" && <ModelActivationConfiguration />}
      {tab === "feedback" && <HumanFeedbackLearning models={models} />}
      {tab === "policy" && <RLDecisionPolicy />}
      {tab === "history" && <ModelsTrainingHistory models={models} />}
    </>
  );
}

function warmBackgroundData(models: AiModel[]) {
  void getFeedbackDatasetSummary().catch((err) => console.warn("[ModelsPage] feedback prefetch unavailable", err));
  void Promise.allSettled(models.map((model) => getTrainingHistory(model.id))).catch((err) =>
    console.warn("[ModelsPage] training history prefetch unavailable", err),
  );
}

function mergeModelMetrics(model: AiModel, metrics?: AiModelMetrics): AiModel {
  if (!metrics) return model;
  const rawMetrics = metrics as Record<string, unknown>;
  const avgConfidence = nullableNumber(metrics.avg_confidence) ?? model.avg_confidence;
  const avgInferenceMs = nullableNumber(metrics.avg_inference_ms) ?? model.avg_inference_ms;
  const anomalies = Number(metrics.total_anomalies ?? rawMetrics.detected_anomalies ?? model.anomalies_detected ?? 0);
  const sampleCount = Number(metrics.sample_count ?? model.sample_count ?? 0);
  return {
    ...model,
    anomalies_detected: anomalies,
    sample_count: sampleCount,
    analyzed_events: sampleCount || model.analyzed_events,
    avg_confidence: avgConfidence,
    avg_inference_ms: avgInferenceMs,
    metrics: {
      ...model.metrics,
      ...metrics,
      avg_confidence: avgConfidence,
      avg_inference_ms: avgInferenceMs,
    },
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function ModelsCatalogueSkeleton() {
  return (
    <>
      <section className="modelsChartSkeleton">
        <span />
        <span />
      </section>
      <section className="modelCardsGrid">
        {Array.from({ length: 9 }).map((_, index) => (
          <article className="modelCard modelCardSkeleton" key={index}>
            <i className="skeletonLine wide" />
            <i className="skeletonLine short" />
            <i className="skeletonBlock" />
            <i className="skeletonLine" />
            <i className="skeletonLine" />
          </article>
        ))}
      </section>
    </>
  );
}
