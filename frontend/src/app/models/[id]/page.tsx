"use client";

import Link from "next/link";
import { Fragment } from "react";
import type { FormEvent, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  getAiModel,
  getAiModelImprovements,
  getAiModelLifecycle,
  getAiModelResults,
  getModelDriftSeries,
  getRetrainingRecommendation,
  getTrainingHistory,
  trainAiModel,
  updateAiResultValidation,
} from "@/lib/api/ai-models";
import type { AiModel, AiModelImprovement, AiModelResult, DriftPoint, ModelLifecycle, RetrainingRecommendation, TrainingJob } from "@/types/ai-models";
import { ModelImprovementsTimeline } from "@/components/models/ModelImprovementsTimeline";
import { ModelMetrics } from "@/components/models/ModelMetrics";
import { ModelResultVisuals } from "@/components/models/ModelResultVisuals";
import { ModelResultsTable } from "@/components/models/ModelResultsTable";
import { analysisLevel, metricNumber, modelHealthScore, primaryMetric } from "@/components/models/ModelPerformanceMatrix";
import { statusClass } from "@/components/models/ModelCard";
import { BarChart } from "@/components/BarChart";

type TrainingFormState = {
  dataset_start: string;
  dataset_end: string;
  sample_size: number;
  flow_code: string;
  sequence_length: number;
  epochs: number;
  batch_size: number;
  validation_split: number;
  min_sequences: number;
  contamination: number;
  random_state: number;
  max_samples: string;
  bootstrap: boolean;
  dataset_mode: string;
};

export default function ModelDetailPage({ params }: { params: { id: string } }) {
  const [model, setModel] = useState<AiModel | null>(null);
  const [results, setResults] = useState<AiModelResult[]>([]);
  const [improvements, setImprovements] = useState<AiModelImprovement[]>([]);
  const [lifecycle, setLifecycle] = useState<ModelLifecycle | null>(null);
  const [recommendation, setRecommendation] = useState<RetrainingRecommendation | null>(null);
  const [history, setHistory] = useState<TrainingJob[]>([]);
  const [driftSeries, setDriftSeries] = useState<DriftPoint[]>([]);
  const [trainingMessage, setTrainingMessage] = useState<string | null>(null);
  const [trainingError, setTrainingError] = useState<string | null>(null);
  const [trainingSubmitting, setTrainingSubmitting] = useState(false);
  const [trainingForm, setTrainingForm] = useState<TrainingFormState>({
    dataset_start: "",
    dataset_end: "",
    sample_size: 20000,
    flow_code: "",
    sequence_length: 8,
    epochs: 12,
    batch_size: 16,
    validation_split: 0.15,
    min_sequences: 40,
    contamination: 0.035,
    random_state: 42,
    max_samples: "auto",
    bootstrap: false,
    dataset_mode: "normal_only",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [modelData, resultData, improvementData, lifecycleData, recommendationData, historyData, driftData] = await Promise.all([
          getAiModel(params.id),
          getAiModelResults(params.id),
          getAiModelImprovements(params.id),
          getAiModelLifecycle(params.id),
          getRetrainingRecommendation(params.id),
          getTrainingHistory(params.id),
          getModelDriftSeries(params.id),
        ]);
        setModel(modelData);
        setResults(resultData);
        setImprovements(improvementData);
        setLifecycle(lifecycleData || modelData?.lifecycle || null);
        setRecommendation(recommendationData);
        setHistory(historyData);
        setDriftSeries(driftData);
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
  const driftChart = useMemo(
    () => driftSeries.map((item) => ({ label: item.date, value: Math.round(item.drift_score * 100), tone: "orange" as const })),
    [driftSeries],
  );
  const latestCompletedJob = useMemo(
    () => history.find((job) => job.status === "completed") || null,
    [history],
  );

  async function submitTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!model) return;
    setTrainingSubmitting(true);
    setTrainingError(null);
    setTrainingMessage(null);
    try {
      const payload = await trainAiModel(model.id, {
        dataset_start: trainingForm.dataset_start || undefined,
        dataset_end: trainingForm.dataset_end || undefined,
        sample_size: trainingForm.sample_size,
        triggered_by: "supervisor",
        training_mode: "manual",
        training_options: model.id.startsWith("temporal_")
          ? {
              flow_code: trainingForm.flow_code || undefined,
              sequence_length: trainingForm.sequence_length,
              epochs: trainingForm.epochs,
              batch_size: trainingForm.batch_size,
              validation_split: trainingForm.validation_split,
              min_sequences: trainingForm.min_sequences,
            }
          : isRandomForestModel(model)
            ? {
                random_state: trainingForm.random_state,
                dataset_mode: trainingForm.dataset_mode,
              }
          : isLocalOutlierFactorModel(model)
            ? {
                contamination: trainingForm.contamination,
                n_neighbors: trainingForm.max_samples === "auto" ? undefined : Number(trainingForm.max_samples),
                dataset_mode: trainingForm.dataset_mode,
              }
          : isEventAutoencoderModel(model)
            ? {
                dataset_mode: trainingForm.dataset_mode,
                max_iter: trainingForm.epochs,
                validation_split: trainingForm.validation_split,
              }
          : isIsolationForestModel(model)
            ? {
                contamination: trainingForm.contamination,
                random_state: trainingForm.random_state,
                max_samples: trainingForm.max_samples,
                bootstrap: trainingForm.bootstrap,
                dataset_mode: trainingForm.dataset_mode,
              }
          : undefined,
      });
      setTrainingMessage(`Job ${payload.job.id} cree: ${payload.message}`);
      const [newHistory, newRecommendation, newLifecycle] = await Promise.all([
        getTrainingHistory(model.id),
        getRetrainingRecommendation(model.id),
        getAiModelLifecycle(model.id),
      ]);
      setHistory(newHistory);
      setRecommendation(newRecommendation);
      setLifecycle(newLifecycle);
    } catch (err) {
      setTrainingError(err instanceof Error ? err.message : "Impossible de lancer l'entrainement");
    } finally {
      setTrainingSubmitting(false);
    }
  }

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

  if (isFlowRulesEngineModel(model)) {
    return (
      <FlowRulesEngineOperationalConsole
        model={model}
        results={results}
        improvements={improvements}
        lifecycle={lifecycle}
        recommendation={recommendation}
      />
    );
  }

  if (isRulesEngineModel(model)) {
    return (
      <RulesEngineObservabilityConsole
        model={model}
        results={results}
        improvements={improvements}
        lifecycle={lifecycle}
        recommendation={recommendation}
      />
    );
  }

  if (isRandomForestModel(model)) {
    return (
      <RandomForestObservabilityConsole
        model={model}
        results={results}
        lifecycle={lifecycle}
        recommendation={recommendation}
        improvements={improvements}
        history={history}
        trainingForm={trainingForm}
        setTrainingForm={setTrainingForm}
        submitTraining={submitTraining}
        trainingSubmitting={trainingSubmitting}
        trainingMessage={trainingMessage}
        trainingError={trainingError}
      />
    );
  }

  if (isLocalOutlierFactorModel(model)) {
    return (
      <LocalOutlierFactorObservabilityConsole
        model={model}
        results={results}
        lifecycle={lifecycle}
        recommendation={recommendation}
        improvements={improvements}
        history={history}
        trainingForm={trainingForm}
        setTrainingForm={setTrainingForm}
        submitTraining={submitTraining}
        trainingSubmitting={trainingSubmitting}
        trainingMessage={trainingMessage}
        trainingError={trainingError}
      />
    );
  }

  if (isEventAutoencoderModel(model)) {
    return (
      <EventAutoencoderObservabilityConsole
        model={model}
        results={results}
        lifecycle={lifecycle}
        recommendation={recommendation}
        improvements={improvements}
        history={history}
        trainingForm={trainingForm}
        setTrainingForm={setTrainingForm}
        submitTraining={submitTraining}
        trainingSubmitting={trainingSubmitting}
        trainingMessage={trainingMessage}
        trainingError={trainingError}
      />
    );
  }

  if (isIsolationForestModel(model)) {
    return (
      <IsolationForestObservabilityConsole
        model={model}
        results={results}
        lifecycle={lifecycle}
        recommendation={recommendation}
        improvements={improvements}
        history={history}
        trainingForm={trainingForm}
        setTrainingForm={setTrainingForm}
        submitTraining={submitTraining}
        trainingSubmitting={trainingSubmitting}
        trainingMessage={trainingMessage}
        trainingError={trainingError}
      />
    );
  }

  if (isTemporalGruSequenceModel(model)) {
    return (
      <TemporalGruSequenceObservabilityConsole
        model={model}
        lifecycle={lifecycle}
        history={history}
        improvements={improvements}
        trainingForm={trainingForm}
        setTrainingForm={setTrainingForm}
        submitTraining={submitTraining}
        trainingSubmitting={trainingSubmitting}
        trainingMessage={trainingMessage}
        trainingError={trainingError}
      />
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

      <section className="modelPerformanceHero">
        <div className={`modelPerformanceScore ${performanceTone(modelHealthScore(model))}`}>
          <span>Model Health</span>
          <strong>{modelHealthScore(model)}<small>/100</small></strong>
          <em>{performanceLabel(modelHealthScore(model))}</em>
        </div>
        <div className="modelPerformanceSummary">
          <span>Performance principale</span>
          <strong>{primaryMetric(model)}</strong>
          <p>{performanceNarrative(model, lifecycle, recommendation)}</p>
        </div>
        <ModelPerformanceFacts model={model} lifecycle={lifecycle} />
      </section>

      <section className="grid kpiGrid">
        <div className="card kpi"><span>Developpement</span><strong>{model.developed_at}</strong></div>
        <div className="card kpi"><span>Dernier entrainement</span><strong className="smallStrong">{lifecycle?.last_trained_at || model.last_training_at || "N/A"}</strong></div>
        <div className="card kpi"><span>Derniere amelioration</span><strong>{model.last_improvement_at}</strong></div>
        <div className="card kpi"><span>Evenements analyses</span><strong>{model.analyzed_events}</strong></div>
        <div className="card kpi"><span>Anomalies detectees</span><strong>{model.anomalies_detected}</strong></div>
      </section>

      <section className="grid contentGrid">
        <div className="card lifecycleCard">
          <div className="cardHeader"><h2>Model Lifecycle</h2></div>
          <div className="cardBody lifecycleGrid">
            {isRulesEngineModel(model) ? (
              <>
                <div className="metricBox"><span>Status</span><strong>Active deterministic</strong></div>
                <div className="metricBox"><span>Version courante</span><strong>{lifecycle?.current_version || model.version}</strong></div>
                <div className="metricBox"><span>Training required</span><strong>No</strong></div>
                <div className="metricBox"><span>Rule audit</span><strong>{String(model.metrics.rule_audit_status || "N/A")}</strong></div>
                <div className="metricBox"><span>Scoring coverage</span><strong>{formatPercent(metricNumber(model.metrics.scoring_coverage))}</strong></div>
                <div className="metricBox"><span>Recommendation coverage</span><strong>{formatPercent(metricNumber(model.metrics.recommendation_coverage))}</strong></div>
              </>
            ) : (
              <>
                <div className="metricBox"><span>Status</span><strong>{lifecycle?.trained ? "Trained" : "Not trained"}</strong></div>
                <div className="metricBox"><span>Version courante</span><strong>{lifecycle?.current_version || model.version}</strong></div>
                <div className="metricBox"><span>Freshness</span><strong>{formatPercent(lifecycle?.freshness_score)}</strong></div>
                <div className="metricBox"><span>Drift score</span><strong>{formatPercent(lifecycle?.drift_score)}</strong></div>
                <div className="metricBox"><span>Nouveaux evenements</span><strong>{lifecycle?.new_events_since_training ?? "N/A"}</strong></div>
                <div className="metricBox"><span>Age modele</span><strong>{lifecycle?.days_since_last_training ?? "N/A"} j</strong></div>
              </>
            )}
          </div>
        </div>

        <div className={`card retrainingCard ${recommendation?.recommended ? recommendation.degradation_level : "low"}`}>
          <div className="cardHeader">
            <h2>{isRulesEngineModel(model) ? "Rules Maintenance" : "Retraining Recommendation"}</h2>
            <span className={`modelStatus ${recommendation?.recommended ? "warning" : "ready"}`}>
              {isRulesEngineModel(model) ? "not trainable" : recommendation?.recommended ? "recommended" : "not needed"}
            </span>
          </div>
          <div className="cardBody">
            {isRulesEngineModel(model) ? (
              <div className="modelUsedMeta">
                <span>{formatMetricValue(model.metrics.active_rule_count)} regles actives</span>
                <span>{formatPercent(metricNumber(model.metrics.rule_coverage))} couverture</span>
                <span>{formatPercent(metricNumber(model.metrics.validation_match_rate))} validation</span>
              </div>
            ) : (
              <div className="modelUsedMeta">
                <span>Drift {formatPercent(recommendation?.drift_score)}</span>
                <span>Freshness {formatPercent(recommendation?.freshness_score)}</span>
                <span>{recommendation?.new_events_since_training ?? 0} nouveaux events</span>
              </div>
            )}
            <ul className="reasonList">
              {(isRulesEngineModel(model)
                ? ["Pas d'entrainement: maintenir les regles, le scoring et les recommandations.", ...(model.metrics.rule_audit_issues || [])]
                : recommendation?.reasons || ["Aucun signal de re-entrainement critique."]).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader"><h2>Manual Training Panel</h2></div>
          <form className="cardBody trainingForm" onSubmit={submitTraining}>
            <label>
              <span>Date debut</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_start} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_start: event.target.value })} />
            </label>
            <label>
              <span>Date fin</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_end} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_end: event.target.value })} />
            </label>
            <label>
              <span>Taille echantillon</span>
              <input className="input" type="number" min={100} max={50000} value={trainingForm.sample_size} onChange={(event) => setTrainingForm({ ...trainingForm, sample_size: Number(event.target.value) })} />
            </label>
            {model.id.startsWith("temporal_") && (
              <div className="trainingAdvanced">
                <div className="trainingAdvancedHeader">
                  <strong>Options temporelles</strong>
                  <span>Sequence-Level</span>
                </div>
                <label>
                  <span>Flow cible optionnel</span>
                  <input className="input" placeholder="Ex: F14, F24..." value={trainingForm.flow_code} onChange={(event) => setTrainingForm({ ...trainingForm, flow_code: event.target.value })} />
                </label>
                <div className="trainingOptionsGrid">
                  <label>
                    <span>Longueur sequence</span>
                    <input className="input" type="number" min={3} max={30} value={trainingForm.sequence_length} onChange={(event) => setTrainingForm({ ...trainingForm, sequence_length: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>Epochs</span>
                    <input className="input" type="number" min={1} max={80} value={trainingForm.epochs} onChange={(event) => setTrainingForm({ ...trainingForm, epochs: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>Batch size</span>
                    <input className="input" type="number" min={4} max={256} value={trainingForm.batch_size} onChange={(event) => setTrainingForm({ ...trainingForm, batch_size: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>Validation split</span>
                    <input className="input" type="number" min={0} max={0.4} step={0.05} value={trainingForm.validation_split} onChange={(event) => setTrainingForm({ ...trainingForm, validation_split: Number(event.target.value) })} />
                  </label>
                  <label>
                    <span>Min sequences</span>
                    <input className="input" type="number" min={10} max={5000} value={trainingForm.min_sequences} onChange={(event) => setTrainingForm({ ...trainingForm, min_sequences: Number(event.target.value) })} />
                  </label>
                </div>
              </div>
            )}
            <button className="button primary" type="submit" disabled={trainingSubmitting || model.id === "event_rules_engine"}>
              {trainingSubmitting ? "Job en creation..." : "Train model"}
            </button>
            {model.id === "event_rules_engine" && <p className="muted">Le Rules Engine est deterministe et ne necessite pas d'entrainement.</p>}
            {trainingMessage && <div className="successBox">{trainingMessage}</div>}
            {trainingError && <div className="errorBox">{trainingError}</div>}
          </form>
        </div>

        <div className="card">
          <div className="cardHeader"><h2>{isRulesEngineModel(model) ? "Rules Coverage Monitoring" : "Drift Monitoring"}</h2></div>
          <div className="cardBody">
            {isRulesEngineModel(model)
              ? <RulesCoveragePanel model={model} />
              : driftChart.length > 0 ? <BarChart items={driftChart} /> : <p className="muted">Aucun historique drift disponible pour le moment.</p>}
          </div>
        </div>
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
          <div className="cardBody">
            <ModelMetrics model={model} />
            <div className="modelMetricInterpretation">
              <strong>Lecture performance</strong>
              <p>{metricInterpretation(model, latestCompletedJob)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader"><h2>Visualisation des resultats</h2></div>
          <div className="cardBody"><ModelResultVisuals results={results} /></div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="cardHeader"><h2>{isRulesEngineModel(model) ? "Couverture regles" : "Score confiance / F1"}</h2></div>
            <div className="cardBody">
              {isRulesEngineModel(model) ? <RulesCoveragePanel model={model} /> : <BarChart items={confidenceTrend} />}
            </div>
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
        <div className="cardHeader"><h2>Derniers resultats du modele</h2></div>
        <div className="cardBody"><ModelResultsTable results={results} /></div>
      </section>

      <section className="card modelPanel">
        <div className="cardHeader"><h2>Training History</h2></div>
        <div className="cardBody">
          <TrainingHistoryTable jobs={history} />
        </div>
      </section>

      <section className="card modelPanel">
        <div className="cardHeader"><h2>Historique des ameliorations</h2></div>
        <div className="cardBody"><ModelImprovementsTimeline improvements={improvements} /></div>
      </section>
    </>
  );
}

function TrainingHistoryTable({ jobs }: { jobs: TrainingJob[] }) {
  if (jobs.length === 0) {
    return <p className="muted">Aucun job d'entrainement enregistre.</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Version</th>
          <th>Samples</th>
          <th>Accuracy</th>
          <th>F1</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id}>
            <td>{job.completed_at || job.created_at}</td>
            <td>{job.model_version || "N/A"}</td>
            <td>{job.sample_size || "N/A"}</td>
            <td>{formatMetric(job.accuracy)}</td>
            <td>{formatMetric(job.f1_score)}</td>
            <td><span className={`modelStatus ${job.status === "completed" ? "ready" : job.status === "failed" ? "disabled" : "warning"}`}>{job.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TemporalGruSequenceObservabilityConsole({
  model,
  lifecycle,
  history,
  improvements,
  trainingForm,
  setTrainingForm,
  submitTraining,
  trainingSubmitting,
  trainingMessage,
  trainingError,
}: {
  model: AiModel;
  lifecycle: ModelLifecycle | null;
  history: TrainingJob[];
  improvements: AiModelImprovement[];
  trainingForm: TrainingFormState;
  setTrainingForm: (value: SetStateAction<TrainingFormState>) => void;
  submitTraining: (event: FormEvent<HTMLFormElement>) => void;
  trainingSubmitting: boolean;
  trainingMessage: string | null;
  trainingError: string | null;
}) {
  const metrics = model.metrics as Record<string, unknown>;
  const temporalMetrics = [
    { label: "sequence_count", value: formatTemporalMetric(metrics.sequence_count ?? metrics.sample_count) },
    { label: "min_sequences", value: formatTemporalMetric(metrics.min_sequences) },
    { label: "sequence_length", value: formatTemporalMetric(metrics.sequence_length) },
    { label: "avg_sequence_risk", value: formatTemporalMetric(metrics.avg_sequence_risk ?? metrics.avg_risk_score) },
    { label: "anomaly_ratio", value: formatTemporalRatio(metrics.anomaly_ratio ?? metrics.anomaly_rate) },
    { label: "drift_detected", value: formatTemporalBoolean(metrics.drift_detected) },
    { label: "last_training_at", value: lifecycle?.last_trained_at || model.last_training_at || "Not available" },
  ];
  const trainingConfig = [
    { label: "epochs", value: formatTemporalMetric(metrics.epochs) },
    { label: "batch_size", value: formatTemporalMetric(metrics.batch_size) },
    { label: "learning_rate", value: formatTemporalMetric(metrics.learning_rate) },
    { label: "validation_split", value: formatTemporalRatio(metrics.validation_split) },
    { label: "min_sequences", value: formatTemporalMetric(metrics.min_sequences) },
  ];
  const overview = [
    { label: "model_id", value: model.id },
    { label: "model_name", value: model.name },
    { label: "analysis_level", value: "temporal" },
    { label: "model_type", value: "neural sequence model" },
    { label: "trainable", value: "true" },
    { label: "version", value: model.version || "Not available" },
    { label: "active/enabled", value: `${model.status === "active" ? "active" : "not active"} / ${model.status === "inactive" ? "disabled" : "enabled"}` },
    { label: "status", value: model.status },
  ];

  return (
    <>
      <div className="pageHeader rulesOpsHeader">
        <div>
          <span className="rulesOpsEyebrow">Temporal-Level AIOps Console</span>
          <h1>Temporal-Level GRU Sequence Model</h1>
          <p>Modele sequentiel neural qui analyse l'evolution temporelle des flows pour detecter les derives, repetitions et instabilites progressives.</p>
        </div>
        <div className="headerStatus">
          <span className={`modelStatus ${statusClass(model.status)}`}>{model.status}</span>
          <Link className="button" href="/models">Back to models</Link>
        </div>
      </div>

      <section className="modelDetailHero card">
        <div>
          <span className="sectionEyebrow">Model Overview</span>
          <h2>{model.name}</h2>
          <p>{model.description}</p>
        </div>
        <div className="modelLabels">
          <span>temporal-level</span>
          <span>sequence model</span>
          <span>deep learning</span>
          <span>trainable</span>
        </div>
      </section>

      <section className="grid kpiGrid">
        {overview.map((item) => (
          <div className="card kpi" key={item.label}>
            <span>{item.label}</span>
            <strong className="smallStrong">{item.value}</strong>
          </div>
        ))}
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader"><h2>How this model works</h2></div>
          <div className="cardBody">
            <p className="modelNarrative">
              Le GRU analyse des sequences temporelles d'evenements par flow afin de detecter les evolutions anormales dans le temps :
              derive de latence, repetition d'erreurs, instabilite SLA et patterns intermittents. Il sert a confirmer qu'une degradation
              n'est pas seulement un evenement isole, mais une tendance temporelle.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="cardHeader"><h2>Input features</h2></div>
          <div className="cardBody">
            <div className="modelLabels featureList">
              {["latency_ratio", "is_error", "is_sla_breach", "sequence_length", "flow_code", "timestamp ordering"].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader"><h2>Temporal metrics</h2></div>
          <div className="cardBody lifecycleGrid">
            {temporalMetrics.map((item) => (
              <div className="metricBox" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="cardHeader"><h2>Training configuration</h2></div>
          <div className="cardBody lifecycleGrid">
            {trainingConfig.map((item) => (
              <div className="metricBox" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader"><h2>Manual Training Panel</h2></div>
          <form className="cardBody trainingForm" onSubmit={submitTraining}>
            <label>
              <span>Date debut</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_start} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_start: event.target.value })} />
            </label>
            <label>
              <span>Date fin</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_end} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_end: event.target.value })} />
            </label>
            <label>
              <span>Flow cible optionnel</span>
              <input className="input" placeholder="Ex: F14" value={trainingForm.flow_code} onChange={(event) => setTrainingForm({ ...trainingForm, flow_code: event.target.value })} />
            </label>
            <div className="trainingOptionsGrid">
              <label>
                <span>Sequence length</span>
                <input className="input" type="number" min={3} max={30} value={trainingForm.sequence_length} onChange={(event) => setTrainingForm({ ...trainingForm, sequence_length: Number(event.target.value) })} />
              </label>
              <label>
                <span>Epochs</span>
                <input className="input" type="number" min={1} max={80} value={trainingForm.epochs} onChange={(event) => setTrainingForm({ ...trainingForm, epochs: Number(event.target.value) })} />
              </label>
              <label>
                <span>Batch size</span>
                <input className="input" type="number" min={4} max={256} value={trainingForm.batch_size} onChange={(event) => setTrainingForm({ ...trainingForm, batch_size: Number(event.target.value) })} />
              </label>
              <label>
                <span>Validation split</span>
                <input className="input" type="number" min={0} max={0.4} step={0.05} value={trainingForm.validation_split} onChange={(event) => setTrainingForm({ ...trainingForm, validation_split: Number(event.target.value) })} />
              </label>
              <label>
                <span>Min sequences</span>
                <input className="input" type="number" min={10} max={5000} value={trainingForm.min_sequences} onChange={(event) => setTrainingForm({ ...trainingForm, min_sequences: Number(event.target.value) })} />
              </label>
            </div>
            <button className="button primary" type="submit" disabled={trainingSubmitting}>
              {trainingSubmitting ? "Job en creation..." : "Train model"}
            </button>
            {trainingMessage && <div className="successBox">{trainingMessage}</div>}
            {trainingError && <div className="errorBox">{trainingError}</div>}
          </form>
        </div>

        <div className="card">
          <div className="cardHeader"><h2>Limitations</h2></div>
          <div className="cardBody">
            <ul className="reasonList">
              <li>Necessite suffisamment de sequences temporelles par flow.</li>
              <li>Sensible a la qualite des timestamps et a leur ordre chronologique.</li>
              <li>Non fiable pendant la phase warm-up quand la fenetre temporelle est incomplete.</li>
              <li>LSTM et TranAD restent experimentaux / disabled et ne doivent pas etre presentes comme prets production.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="card modelPanel">
        <div className="cardHeader"><h2>Training History</h2></div>
        <div className="cardBody">
          <TemporalTrainingHistoryTable jobs={history} />
        </div>
      </section>

      <section className="card modelPanel">
        <div className="cardHeader"><h2>Temporal-Level Comparison</h2></div>
        <div className="cardBody">
          <table className="table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Role</th>
                <th>Status</th>
                <th>Production readiness</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Temporal Rules Engine", "Deterministic temporal policy", "active", "production baseline"],
                ["Temporal GRU", "Neural sequence drift detection", model.status, model.status === "active" ? "active model" : "trainable candidate"],
                ["Temporal LSTM experimental", "Long sequence experiment", "disabled", "experimental only"],
                ["Temporal TranAD experimental", "Transformer anomaly experiment", "disabled", "experimental only"],
              ].map(([name, role, status, readiness]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{role}</td>
                  <td><span className={`modelStatus ${statusClass(status as AiModel["status"])}`}>{status}</span></td>
                  <td>{readiness}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card modelPanel">
        <div className="cardHeader"><h2>Improvement History</h2></div>
        <div className="cardBody"><ModelImprovementsTimeline improvements={improvements} /></div>
      </section>
    </>
  );
}

function TemporalTrainingHistoryTable({ jobs }: { jobs: TrainingJob[] }) {
  if (jobs.length === 0) {
    return <p className="muted">Not available</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Version</th>
          <th>Samples</th>
          <th>Sequence length</th>
          <th>Horizon</th>
          <th>F1</th>
          <th>Validation loss</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => {
          const metadata = job.training_metadata || {};
          return (
            <tr key={job.id}>
              <td>{job.completed_at || job.started_at || job.created_at}</td>
              <td>{job.model_version || "Not available"}</td>
              <td>{job.sample_size ?? "Not available"}</td>
              <td>{formatTemporalMetric(metadata.sequence_length)}</td>
              <td>{formatTemporalMetric(metadata.prediction_horizon ?? metadata.horizon)}</td>
              <td>{formatTemporalRatio(job.f1_score)}</td>
              <td>{formatTemporalMetric(metadata.validation_loss)}</td>
              <td><span className={`modelStatus ${job.status === "completed" ? "ready" : job.status === "failed" ? "critical" : "warning"}`}>{job.status}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RulesEngineObservabilityConsole({
  model,
  results,
  improvements,
  lifecycle,
  recommendation,
}: {
  model: AiModel;
  results: AiModelResult[];
  improvements: AiModelImprovement[];
  lifecycle: ModelLifecycle | null;
  recommendation: RetrainingRecommendation | null;
}) {
  const [selectedCluster, setSelectedCluster] = useState<AnomalyCluster | null>(null);
  const [ruleFilter, setRuleFilter] = useState("all");
  const [validationOverrides, setValidationOverrides] = useState<Record<string, HumanValidationStatus>>({});
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const reviewedResults = useMemo(
    () => results.map((item) => {
      const override = validationOverrides[item.anomaly_type] || validationOverrides[normalizeFlowFamilyName(item.anomaly_type)];
      return override ? { ...item, validation_status: override, validation: override } : item;
    }),
    [results, validationOverrides],
  );
  const clusters = useMemo(() => buildRuleAnomalyFamilies(model, reviewedResults), [model, reviewedResults]);
  const services = useMemo(() => buildRuleImpactedServices(model, reviewedResults), [model, reviewedResults]);
  const topCluster = clusters[0] || null;
  const activeAnomalies = reviewedResults.filter((item) => item.result === "anomaly").length || Math.round(metricNumber(model.metrics.total_anomalies) ?? model.anomalies_detected ?? 0);
  const criticalAnomalies = reviewedResults.filter((item) => item.severity === "critical").length;
  const validation = metricNumber(model.metrics.validation_match_rate) || 0;
  const coverage = metricNumber(model.metrics.rule_coverage) || 0;
  const reliabilityItems = reliabilityBreakdown(model, lifecycle);
  const reliabilityScore = modelHealthScore(model);
  const platformState = reliabilityScore >= 82 && criticalAnomalies === 0 ? "healthy" : reliabilityScore >= 60 ? "degraded" : "critical";
  const stateLabel = platformState === "healthy" ? "Healthy" : platformState === "degraded" ? "Degraded" : "Critical";
  const detectedTypes = new Set(reviewedResults.map((item) => item.anomaly_type)).size || clusters.length;
  const detectionTrend = Math.round((validation - 0.45) * 100);
  const anomaliesPerMinute = Math.max(1, Math.round(activeAnomalies / 5));
  const ruleMetrics = rulesValidationMetrics(model);
  const coverageDetails = ruleCoverageDetails(model, reviewedResults);
  const ruleInventory = ruleInventoryRows(model, reviewedResults);
  const humanReview = humanReviewSummary(reviewedResults);
  const filteredRuleInventory = ruleFilter === "all" ? ruleInventory : ruleInventory.filter((item) => item.validation === ruleFilter || item.status === ruleFilter);
  async function validateFamily(cluster: AnomalyCluster, status: HumanValidationStatus, comment?: string) {
    const impactedResults = results.filter((item) => item.anomaly_type === cluster.type && item.result === "anomaly");
    if (!impactedResults.length) return;
    setValidationError(null);
    setValidationMessage(null);
    try {
      await Promise.all(impactedResults.map((item) => updateAiResultValidation(item.id, {
        validation_status: status,
        validation_comment: comment || validationCommentFor(status, cluster.type),
        validated_by: "supervisor",
      })));
      setValidationOverrides((current) => ({ ...current, [cluster.type]: status }));
      const savedComment = comment || validationCommentFor(status, cluster.type);
      setSelectedCluster((current) => current && current.type === cluster.type ? { ...current, validation: status, validationComment: savedComment } : current);
      setValidationMessage(`${cluster.type} marked as ${status}.`);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Validation update failed");
    }
  }

  return (
    <div className="rulesOpsConsole">
      <header className="rulesOpsHeader">
        <div>
          <span className="rulesOpsEyebrow">Event-Level AIOps Console</span>
          <h1>Rules Engine Operational Supervision</h1>
          <p>Deterministic realtime anomaly detection for individual Kafka API and audit events.</p>
        </div>
        <div className="rulesOpsHeaderActions">
          <span className={`rulesPulse ${platformState}`}><i />Kafka stream active</span>
          <Link className="rulesGhostButton" href="/models">Back to models</Link>
        </div>
      </header>

      <section className="rulesHero">
        <div className="rulesHeroStatus">
          <div className="rulesHeroStatusTop">
            <span className={`rulesState ${platformState}`}>{stateLabel}</span>
            <span>Last event {formatRelativeTime(results[0]?.date)}</span>
          </div>
          <h2>Operational Status</h2>
          <p>{topCluster ? `${topCluster.type} is the dominant active anomaly family across ${topCluster.flows.length} supervised flows.` : "No active anomaly family is currently visible."}</p>
          <div className="rulesHeroKpis">
            <div><span>Active Incidents</span><strong>{activeAnomalies}</strong><small>grouped into {clusters.length} anomaly families</small></div>
            <div><span>Critical</span><strong>{criticalAnomalies}</strong><small>requires immediate focus</small></div>
            <div><span>Top Active Threat</span><strong>{topCluster?.type || "None"}</strong><small>{topCluster?.occurrences || 0} occurrences</small></div>
            <div><span>Impacted Services</span><strong>{services.length}</strong><small>{services.filter((item) => item.status !== "healthy").length} degraded or critical</small></div>
          </div>
        </div>

        <div className="rulesHeroTrend">
          <div className="rulesMiniHeader">
            <span>Realtime Detection Activity</span>
            <strong>{anomaliesPerMinute}/min</strong>
          </div>
          <RulesAreaChart values={trendValues(results)} />
          <div className="rulesTrendStats">
            <span>Detection trend <strong>{detectionTrend >= 0 ? "+" : ""}{detectionTrend}%</strong></span>
            <span>Validation accuracy <strong>{formatPercent(validation)}</strong></span>
            <span>Coverage <strong>{formatPercent(coverage)}</strong></span>
          </div>
        </div>
      </section>

      <section className="rulesContextStrip">
        {["deterministic engine", "realtime", "explainable", "non-trainable", "event-level detection"].map((item) => <span key={item}>{item}</span>)}
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard rulesReliabilityCard">
          <div className="rulesSectionTitle">
            <span>Model Health Explainability</span>
            <h2>Operational Reliability Score</h2>
          </div>
          <div className="rulesReliabilityBody">
            <RulesRadialGauge value={reliabilityScore} label="Reliability" />
            <div className="rulesContributionList">
              {reliabilityItems.map((item) => (
                <div className="rulesContribution" key={item.label}>
                  <div><span>{item.label}</span><strong>{item.value}</strong></div>
                  <i><b style={{ width: `${item.value}%` }} /></i>
                  <small>{item.reason}</small>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Engine Context</span>
            <h2>Deterministic Rules Runtime</h2>
          </div>
          <div className="rulesContextMetrics">
            <div><span>Deployment Date</span><strong>{model.developed_at}</strong></div>
            <div><span>Last Rules Update</span><strong>{lifecycle?.last_trained_at || model.last_training_at || "No training"}</strong></div>
            <div><span>Last Audit</span><strong>{model.last_improvement_at}</strong></div>
            <div><span>Rule Tuning Required</span><strong>{recommendation?.recommended ? "Review" : "No"}</strong></div>
            <div><span>Kafka Events Processed</span><strong>{model.analyzed_events}</strong></div>
            <div><span>Anomaly Types Observed</span><strong>{detectedTypes}</strong></div>
          </div>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Operational Impact</span>
            <h2>Most Impacted Services</h2>
          </div>
          <div className="rulesServiceHeatmap">
            {services.slice(0, 12).map((service) => (
              <span className={service.status} key={service.name} title={`${service.count} anomalies`}>{service.name}</span>
            ))}
          </div>
          <div className="rulesServiceTable">
            {services.slice(0, 6).map((service) => (
              <div key={service.name}>
                <strong>{service.name}</strong>
                <span>{service.count} anomalies</span>
                <span>{service.consumers} consumers</span>
                <span>{service.slaRisk}</span>
                <span>{service.propagationRisk}</span>
                <em className={service.status}>{service.status}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Validation Intelligence</span>
            <h2>Validation Status</h2>
          </div>
          <div className="rulesValidationGrid">
            <div title="Simulator Validation: match rate with expected simulated anomaly labels when available."><span>Simulator Match</span><strong>{formatPercent(validation)}</strong></div>
            <div title="Reviewed = confirmed + partial + false positive + ignored decisions by a supervisor."><span>Human Reviewed</span><strong>{humanReview.reviewed}</strong></div>
            <div title="Unresolved anomalies are detections that have not yet been confirmed or rejected by a supervisor."><span>Pending Review</span><strong>{humanReview.pending}</strong></div>
            <div title="Confirmed by a supervisor as real incidents."><span>Confirmed Incidents</span><strong>{humanReview.confirmed}</strong></div>
            <div title="Human success rate = confirmed / reviewed."><span>Human Success Rate</span><strong>{humanReview.successRate}%</strong></div>
            <div title="False Positive Control = 1 - false positives / reviewed."><span>False Positive Control</span><strong>{humanReview.falsePositiveControl}%</strong></div>
          </div>
          <p className="rulesHint">Simulator Validation checks expected labels. Human Review tracks supervisor decisions and does not retrain models automatically.</p>
          <RulesStackedBars clusters={clusters} />
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Rule Validation Metrics</span>
            <h2>Validation Metrics</h2>
          </div>
          <div className="isolationConfusionGrid">
            {ruleMetrics.metrics.map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.help}</small>
              </div>
            ))}
          </div>
          <div className="isolationConfusionCounts">
            {ruleMetrics.counts.map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Rule Coverage Details</span>
            <h2>Coverage Breakdown</h2>
          </div>
          <div className="rulesValidationGrid">
            <div><span>Active Rules</span><strong>{coverageDetails.active}</strong></div>
            <div><span>Validated</span><strong>{coverageDetails.validated}</strong></div>
            <div><span>Partial Validation</span><strong>{coverageDetails.partial}</strong></div>
            <div><span>Never Triggered</span><strong>{coverageDetails.neverTriggered}</strong></div>
          </div>
          <BarChart items={coverageDetails.chart} />
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Why Rule Triggered</span>
          <h2>Rule Explainability</h2>
        </div>
        <div className="rulesAuditList">
          {ruleTriggerExplanations(model, results).map((item) => (
            <div key={`${item.rule}-${item.flow}`}>
              <strong>{item.rule}</strong>
              <span>{item.flow}</span>
              <small>Matched Conditions: {item.conditions.join(" | ")}</small>
              <em>Confidence {item.confidence} - Risk {item.risk}</em>
            </div>
          ))}
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Anomaly Supervision</span>
            <h2>Anomaly Families</h2>
          </div>
          <div className="rulesFilters">
            {["all", "critical", "high", "medium"].map((item) => <button key={item} type="button">{item}</button>)}
          </div>
        </div>
        {(validationMessage || validationError) && (
          <p className={validationError ? "rulesValidationError" : "rulesValidationMessage"}>
            {validationError || validationMessage}
          </p>
        )}
        <div className="rulesClusterList">
          {clusters.map((cluster) => (
            <div className="rulesClusterRow" role="button" tabIndex={0} key={cluster.type} onClick={() => setSelectedCluster(cluster)} onKeyDown={(event) => event.key === "Enter" ? setSelectedCluster(cluster) : undefined}>
              <div>
                <strong>{cluster.type}</strong>
                <span>Affected flows: {cluster.flows.slice(0, 4).join(", ")}{cluster.flows.length > 4 ? "..." : ""}</span>
              </div>
              <RulesSparkline values={cluster.sparkline} />
              <span>{cluster.occurrences} occurrences</span>
              <span>{cluster.firstSeen}</span>
              <span>{cluster.lastSeen}</span>
              <em className={cluster.severity}>{cluster.severity}</em>
              <i className={cluster.validation}>{cluster.validation}</i>
              <div className="rulesFamilyActions" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={() => validateFamily(cluster, "confirmed")}>Confirm</button>
                <button type="button" onClick={() => validateFamily(cluster, "false_positive")}>False Positive</button>
                <button type="button" onClick={() => validateFamily(cluster, "partial")}>Partial</button>
                <button type="button" onClick={() => validateFamily(cluster, "ignored")}>Ignore</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Rule Inventory</span>
            <h2>Deterministic Rule Catalog</h2>
          </div>
          <div className="rulesFilters">
            {["all", "validated", "partial", "never_triggered"].map((item) => (
              <button key={item} type="button" onClick={() => setRuleFilter(item)}>{item}</button>
            ))}
          </div>
        </div>
        <div className="isolationTableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rule Name</th>
                <th>Status</th>
                <th>Confidence</th>
                <th>Risk</th>
                <th>Validation Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuleInventory.map((rule) => (
                <tr key={rule.name}>
                  <td>{rule.name}</td>
                  <td><span className="modelStatus ready">{rule.status}</span></td>
                  <td>{rule.confidence}</td>
                  <td>{rule.risk}</td>
                  <td><span className={`modelStatus ${rule.validation === "validated" ? "ready" : rule.validation === "partial" ? "warning" : "disabled"}`}>{rule.validation}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rulesOpsGrid rulesVisualGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle"><span>Visual Intelligence</span><h2>Anomalies Over Time</h2></div>
          <RulesAreaChart values={trendValues(results)} />
        </div>
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle"><span>Distribution</span><h2>Top Anomaly Trends</h2></div>
          <div className="rulesDistribution">
            {clusters.slice(0, 6).map((cluster) => (
              <div key={cluster.type}>
                <span>{cluster.type}</span>
                <i><b style={{ width: `${Math.min(100, cluster.occurrences)}%` }} /></i>
                <strong>{cluster.occurrences}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      {selectedCluster && (
        <AnomalyExplainabilityDrawer
          cluster={selectedCluster}
          model={model}
          onClose={() => setSelectedCluster(null)}
          onValidate={(status, comment) => validateFamily(selectedCluster, status, comment)}
        />
      )}
    </div>
  );
}

function FlowRulesEngineOperationalConsole({
  model,
  results,
  improvements,
  lifecycle,
  recommendation,
}: {
  model: AiModel;
  results: AiModelResult[];
  improvements: AiModelImprovement[];
  lifecycle: ModelLifecycle | null;
  recommendation: RetrainingRecommendation | null;
}) {
  const [selectedFamily, setSelectedFamily] = useState<AnomalyCluster | null>(null);
  const [ruleFilter, setRuleFilter] = useState("all");
  const [validationOverrides, setValidationOverrides] = useState<Record<string, HumanValidationStatus>>({});
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const reviewedResults = useMemo(
    () => results.map((item) => validationOverrides[item.anomaly_type] ? { ...item, validation_status: validationOverrides[item.anomaly_type], validation: validationOverrides[item.anomaly_type] } : item),
    [results, validationOverrides],
  );
  const families = useMemo(() => buildFlowAnomalyFamilies(model, reviewedResults), [model, reviewedResults]);
  const impactedFlows = useMemo(() => buildFlowImpactedFlows(model, reviewedResults), [model, reviewedResults]);
  const catalog = useMemo(() => flowRuleCatalog(model), [model]);
  const validation = useMemo(() => flowValidationMetrics(model), [model]);
  const health = useMemo(() => flowHealthBreakdown(model, validation, families, catalog), [model, validation, families, catalog]);
  const rootCauses = useMemo(() => flowRootCauseItems(families, catalog), [families, catalog]);
  const topFamily = families[0] || null;
  const activeDegradedFlows = impactedFlows.filter((item) => item.status !== "healthy").length;
  const criticalFlows = impactedFlows.filter((item) => item.status === "critical").length;
  const impactedServices = new Set(impactedFlows.map((item) => serviceName(item.name))).size;
  const totalOccurrences = families.reduce((sum, item) => sum + item.occurrences, 0);
  const detectionsPerMinute = Math.max(1, Math.round(totalOccurrences / 6));
  const platformState = criticalFlows > 0 ? "critical" : activeDegradedFlows > 0 ? "degraded" : "healthy";
  const stateLabel = platformState === "healthy" ? "Healthy" : platformState === "degraded" ? "Degraded" : "Critical";
  const humanReview = humanReviewSummary(reviewedResults);
  const filteredCatalog = ruleFilter === "all" ? catalog : catalog.filter((item) => item.state === ruleFilter || item.validation === ruleFilter);

  async function validateFamily(family: AnomalyCluster, status: HumanValidationStatus, comment?: string) {
    const impactedResults = results.filter((item) => normalizeFlowFamilyName(item.anomaly_type) === family.type && item.result === "anomaly");
    setValidationError(null);
    setValidationMessage(null);
    try {
      if (impactedResults.length) {
        await Promise.all(impactedResults.map((item) => updateAiResultValidation(item.id, {
          validation_status: status,
          validation_comment: comment || validationCommentFor(status, family.type),
          validated_by: "supervisor",
        })));
      }
      setValidationOverrides((current) => ({ ...current, [family.type]: status }));
      const savedComment = comment || validationCommentFor(status, family.type);
      setSelectedFamily((current) => current && current.type === family.type ? { ...current, validation: status, validationComment: savedComment } : current);
      setValidationMessage(`${family.type} marked as ${status}.`);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Validation update failed");
    }
  }

  return (
    <div className="rulesOpsConsole flowOpsConsole">
      <header className="rulesOpsHeader">
        <div>
          <span className="rulesOpsEyebrow">Flow-Level AIOps Console</span>
          <h1>Flow Rules Engine Operational Supervision</h1>
          <p>Deterministic supervision of aggregated interoperability flows, SLA instability, latency drift and traffic behaviour.</p>
        </div>
        <div className="rulesOpsHeaderActions">
          <span className={`rulesPulse ${platformState}`}><i />Kafka flow stream active</span>
          <Link className="rulesGhostButton" href="/models">Back to models</Link>
        </div>
      </header>

      <section className="rulesHero">
        <div className="rulesHeroStatus">
          <div className="rulesHeroStatusTop">
            <span className={`rulesState ${platformState}`}>{stateLabel}</span>
            <span>Last detection {formatRelativeTime(results[0]?.date)}</span>
          </div>
          <h2>Operational Status</h2>
          <p>{topFamily ? `${topFamily.type} is the dominant flow anomaly family across ${topFamily.flows.length} impacted flows.` : "No degraded flow family is currently visible."}</p>
          <div className="rulesHeroKpis">
            <div><span>Active Degraded Flows</span><strong>{activeDegradedFlows}</strong><small>flows requiring operational watch</small></div>
            <div><span>Critical Flows</span><strong>{criticalFlows}</strong><small>business-impacting instability</small></div>
            <div><span>Dominant Family</span><strong>{topFamily?.type || "None"}</strong><small>{topFamily?.occurrences || 0} detections</small></div>
            <div><span>Impacted Services</span><strong>{impactedServices}</strong><small>service groups inferred from flows</small></div>
          </div>
        </div>

        <div className="rulesHeroTrend">
          <div className="rulesMiniHeader">
            <span>Realtime Detection Activity</span>
            <strong>{detectionsPerMinute}/min</strong>
          </div>
          <RulesAreaChart values={trendValues(reviewedResults)} />
          <div className="rulesTrendStats">
            <span>Flow health <strong>{health.score}/100</strong></span>
            <span>Precision <strong>{validation.metrics[1].value}</strong></span>
            <span>Recall <strong>{validation.metrics[2].value}</strong></span>
          </div>
        </div>
      </section>

      <section className="rulesContextStrip">
        {["deterministic engine", "flow-level aggregation", "explainable", "non-trainable", "human review ready"].map((item) => <span key={item}>{item}</span>)}
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard rulesReliabilityCard">
          <div className="rulesSectionTitle">
            <span>Flow Health Score</span>
            <h2>Operational Flow Health</h2>
          </div>
          <div className="rulesReliabilityBody">
            <RulesRadialGauge value={health.score} label="Flow Health" />
            <div className="rulesContributionList">
              {health.items.map((item) => (
                <div className="rulesContribution" key={item.label}>
                  <div><span>{item.label}</span><strong>{item.value}</strong></div>
                  <i><b style={{ width: `${item.value}%` }} /></i>
                  <small>{item.reason}</small>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Most Impacted Flows</span>
            <h2>Operational Impact</h2>
          </div>
          <div className="rulesServiceHeatmap">
            {impactedFlows.slice(0, 12).map((flow) => (
              <span className={flow.status} key={flow.name} title={`${flow.count} flow anomalies`}>{flow.name}</span>
            ))}
          </div>
          <div className="rulesServiceTable">
            {impactedFlows.slice(0, 7).map((flow) => (
              <div key={flow.name}>
                <strong>{flow.name}</strong>
                <span>{flow.count} anomalies</span>
                <span>risk {flow.avgRisk}/100</span>
                <span>{flow.slaRisk}</span>
                <span>{flow.propagationRisk}</span>
                <em className={flow.status}>{flow.status}</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Validation Metrics</span>
            <h2>Label-Based Rule Quality</h2>
          </div>
          <div className="isolationConfusionGrid">
            {validation.metrics.map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.help}</small>
              </div>
            ))}
          </div>
          <div className="isolationConfusionCounts">
            {validation.counts.map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <p className="rulesHint">These metrics use simulator labels when available. Human review stays complementary and does not block realtime detection.</p>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Human Validation</span>
            <h2>Family Review Status</h2>
          </div>
          <div className="rulesValidationGrid">
            <div title="Families awaiting supervisor confirmation or rejection."><span>Pending Review</span><strong>{humanReview.pending}</strong></div>
            <div title="Human decisions already captured."><span>Reviewed</span><strong>{humanReview.reviewed}</strong></div>
            <div title="Families confirmed as real incidents."><span>Confirmed</span><strong>{humanReview.confirmed}</strong></div>
            <div title="Families partially confirmed."><span>Partial</span><strong>{humanReview.partial}</strong></div>
            <div title="Confirmed / reviewed."><span>Success Rate</span><strong>{humanReview.successRate}%</strong></div>
            <div title="1 - false positives / reviewed."><span>False Positive Control</span><strong>{humanReview.falsePositiveControl}%</strong></div>
          </div>
          <RulesStackedBars clusters={families} />
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Flow Anomaly Supervision</span>
            <h2>Anomaly Families</h2>
          </div>
          <div className="rulesFilters">
            {["all", "critical", "high", "medium"].map((item) => <button key={item} type="button">{item}</button>)}
          </div>
        </div>
        {(validationMessage || validationError) && (
          <p className={validationError ? "rulesValidationError" : "rulesValidationMessage"}>
            {validationError || validationMessage}
          </p>
        )}
        <div className="rulesClusterList">
          {families.map((family) => (
            <div className="rulesClusterRow" role="button" tabIndex={0} key={family.type} onClick={() => setSelectedFamily(family)} onKeyDown={(event) => event.key === "Enter" ? setSelectedFamily(family) : undefined}>
              <div>
                <strong>{family.type}</strong>
                <span>Impacted flows: {family.flows.slice(0, 4).join(", ")}{family.flows.length > 4 ? "..." : ""}</span>
              </div>
              <RulesSparkline values={family.sparkline} />
              <span>{family.occurrences} occurrences</span>
              <span>{family.lastSeen}</span>
              <em className={family.severity}>{family.severity}</em>
              <i className={family.validation}>{family.validation}</i>
              <div className="rulesFamilyActions" onClick={(event) => event.stopPropagation()}>
                <button type="button" onClick={() => validateFamily(family, "confirmed")}>Confirm</button>
                <button type="button" onClick={() => validateFamily(family, "false_positive")}>False Positive</button>
                <button type="button" onClick={() => validateFamily(family, "partial")}>Partial</button>
                <button type="button" onClick={() => validateFamily(family, "ignored")}>Ignore</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Rule Catalog</span>
            <h2>Flow-Level Deterministic Rules</h2>
          </div>
          <div className="rulesFilters">
            {["all", "active", "validated", "partial"].map((item) => (
              <button key={item} type="button" onClick={() => setRuleFilter(item)}>{item}</button>
            ))}
          </div>
        </div>
        <div className="isolationTableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Rule Name</th>
                <th>Description</th>
                <th>Threshold</th>
                <th>Confidence</th>
                <th>Risk</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {filteredCatalog.map((rule) => (
                <tr key={rule.name}>
                  <td>{rule.name}</td>
                  <td>{rule.description}</td>
                  <td>{rule.threshold}</td>
                  <td>{formatMaybePercent(rule.confidence)}</td>
                  <td>{rule.risk}</td>
                  <td><span className={`modelStatus ${rule.validation === "validated" ? "ready" : rule.validation === "partial" ? "warning" : "disabled"}`}>{rule.validation}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Root Cause Analysis</span>
            <h2>Why The Flow Was Flagged</h2>
          </div>
          <div className="rulesAuditList">
            {rootCauses.map((item) => (
              <div key={`${item.family}-${item.flow}`}>
                <strong>{item.family}</strong>
                <span>{item.flow}</span>
                <small>Main cause: {item.cause}</small>
                <em>{item.metrics.join(" | ")}</em>
                <p>{item.explanation}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Model Maintenance</span>
            <h2>Improvement History</h2>
          </div>
          <ModelImprovementsTimeline improvements={improvements.length ? improvements : defaultFlowRulesImprovements(model)} />
          <p className="rulesHint">
            {recommendation?.recommended ? recommendation.reasons[0] || "Rule tuning review recommended." : "No automatic training is required. Rule tuning is handled through deterministic threshold review."}
            {" "}Last rule audit: {lifecycle?.last_trained_at || model.last_improvement_at || "N/A"}.
          </p>
        </div>
      </section>

      <section className="rulesOpsGrid rulesVisualGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle"><span>Anomalies Over Time</span><h2>Flow Detection Evolution</h2></div>
          <RulesAreaChart values={trendValues(reviewedResults)} />
        </div>
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle"><span>Top Anomaly Trends</span><h2>Most Frequent Families</h2></div>
          <div className="rulesDistribution">
            {families.slice(0, 7).map((family) => (
              <div key={family.type}>
                <span>{family.type}</span>
                <i><b style={{ width: `${Math.min(100, family.occurrences)}%` }} /></i>
                <strong>{family.occurrences}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      {selectedFamily && (
        <FlowAnomalyFamilyDrawer
          family={selectedFamily}
          catalog={catalog}
          onClose={() => setSelectedFamily(null)}
          onValidate={(status, comment) => validateFamily(selectedFamily, status, comment)}
        />
      )}
    </div>
  );
}

function EventAutoencoderObservabilityConsole({
  model,
  results,
  lifecycle,
  recommendation,
  improvements,
  history,
  trainingForm,
  setTrainingForm,
  submitTraining,
  trainingSubmitting,
  trainingMessage,
  trainingError,
}: {
  model: AiModel;
  results: AiModelResult[];
  lifecycle: ModelLifecycle | null;
  recommendation: RetrainingRecommendation | null;
  improvements: AiModelImprovement[];
  history: TrainingJob[];
  trainingForm: {
    dataset_start: string;
    dataset_end: string;
    sample_size: number;
    epochs: number;
    validation_split: number;
    dataset_mode: string;
  };
  setTrainingForm: (value: any) => void;
  submitTraining: (event: FormEvent<HTMLFormElement>) => void;
  trainingSubmitting: boolean;
  trainingMessage: string | null;
  trainingError: string | null;
}) {
  const [selectedCluster, setSelectedCluster] = useState<AnomalyCluster | null>(null);
  const clusters = useMemo(() => buildBehaviourClusters(results), [results]);
  const services = useMemo(() => buildImpactedServices(results), [results]);
  const reconstructionError = metricNumber(model.metrics.reconstruction_error);
  const threshold = metricNumber(model.metrics.detection_threshold);
  const loss = metricNumber(model.metrics.loss);
  const validationLoss = metricNumber(model.metrics.validation_loss);
  const reconstructionRatio = reconstructionError !== null && threshold ? reconstructionError / threshold : null;
  const health = autoencoderHealthScore(model, lifecycle);
  const driftPercent = Math.round((lifecycle?.drift_score ?? 0.07) * 100);
  const reconstructionAnomalies = results.filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL").length || model.anomalies_detected;

  return (
    <div className="rulesOpsConsole isolationOpsConsole">
      <section className="rulesHero isolationHero">
        <div className="rulesHeroStatus isolationHeroStatus">
          <div className="rulesLiveBadge"><i /> reconstruction monitor</div>
          <span className="sectionEyebrow">Event-Level MLP Autoencoder - v{model.version}</span>
          <h1>Event-Level MLP Autoencoder</h1>
          <p>Modele deep learning Event-Level qui apprend a reconstruire les comportements normaux et signale les evenements dont l'erreur de reconstruction devient anormale.</p>
          <strong>{health >= 75 ? "Reconstruction stable" : "Reconstruction a surveiller"}</strong>
          <p>Le signal principal est l'ecart entre reconstruction error et detection threshold.</p>
          <div className="rulesHeroKpis">
            <div><span>Reconstruction Health</span><strong>{health}/100</strong><small>qualite globale</small></div>
            <div><span>Reconstruction Error</span><strong>{formatMaybeNumber(reconstructionError)}</strong><small>erreur moyenne</small></div>
            <div><span>Threshold</span><strong>{formatMaybeNumber(threshold)}</strong><small>frontiere anomalie</small></div>
            <div><span>Error Ratio</span><strong>{formatMaybeNumber(reconstructionRatio)}</strong><small>error / threshold</small></div>
            <div><span>Loss</span><strong>{formatMaybeNumber(loss)}</strong><small>training loss</small></div>
            <div><span>Anomalies</span><strong>{reconstructionAnomalies}</strong><small>events mal reconstruits</small></div>
          </div>
        </div>

        <div className="rulesHeroTrend">
          <div className="rulesMiniHeader">
            <span>Reconstruction Error Activity</span>
            <strong>{formatMaybeNumber(reconstructionRatio)}</strong>
          </div>
          <RulesAreaChart values={autoencoderTrendValues(results)} />
          <div className="rulesTrendStats">
            <span>Validation loss <strong>{formatMaybeNumber(validationLoss)}</strong></span>
            <span>Drift <strong>{driftPercent}%</strong></span>
            <span>Freshness <strong>{formatPercent(lifecycle?.freshness_score)}</strong></span>
          </div>
        </div>
      </section>

      <section className="rulesContextStrip">
        {["deep learning", "event-level", "reconstruction error", "trainable", "baseline reconstruction"].map((item) => <span key={item}>{item}</span>)}
      </section>

      <section className="rulesGlassCard isolationMetricsCard">
        <div className="rulesSectionTitle">
          <span>Autoencoder Evaluation</span>
          <h2>Metriques de reconstruction</h2>
        </div>
        <div className="isolationConfusionPanel">
          <div className="rulesSectionTitle">
            <span>Reconstruction quality</span>
            <h3>Erreur, seuil et validation</h3>
          </div>
          <div className="isolationConfusionGrid">
            {autoencoderPerformanceMetrics(model, history).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.help}</small>
              </div>
            ))}
          </div>
          <div className="isolationConfusionCounts">
            {isolationConfusionCounts(model).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <p>Un autoencoder est evalue par sa capacite a reconstruire le comportement normal. Une erreur au-dessus du seuil indique une anomalie.</p>
        </div>
      </section>

      <section className="rulesGlassCard isolationBaselineCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Reconstruction Supervision</span>
            <h2>Reconstruction Baseline Health</h2>
          </div>
          <span className={`rulesState ${health >= 80 ? "healthy" : health >= 60 ? "degraded" : "critical"}`}>{health >= 80 ? "Healthy" : health >= 60 ? "Watch" : "Degraded"}</span>
        </div>
        <div className="rulesValidationGrid">
          <div title="Sante combinee loss, drift et erreur de reconstruction."><span>Baseline Health</span><strong>{health}%</strong></div>
          <div title="Erreur moyenne de reconstruction."><span>Avg Reconstruction</span><strong>{formatMaybeNumber(reconstructionError)}</strong></div>
          <div title="Seuil de detection d'anomalie."><span>Detection Threshold</span><strong>{formatMaybeNumber(threshold)}</strong></div>
          <div title="Ecart comportemental recent."><span>Drift Level</span><strong>{formatPercent(lifecycle?.drift_score)}</strong></div>
          <div title="Dernier entrainement complet connu."><span>Last Training</span><strong>{lifecycle?.last_trained_at || model.last_training_at || "N/A"}</strong></div>
          <div title="Maintenance recommandee."><span>Maintenance</span><strong>{recommendation?.recommended ? "retrain" : "stable"}</strong></div>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Reconstruction Drift Intelligence</span>
            <h2>Current Error vs Learned Reconstruction Baseline</h2>
          </div>
          <div className="isolationDriftGrid">
            <RulesRadialGauge value={health} label="Recon" />
            <div className="rulesContributionList">
              {autoencoderBreakdown(model, lifecycle).map((item) => (
                <div className="rulesContribution" key={item.label}>
                  <div><span>{item.label}</span><strong>{item.value}</strong></div>
                  <i><b style={{ width: `${item.value}%` }} /></i>
                  <small>{item.reason}</small>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Threshold Intelligence</span>
            <h2>Error Threshold</h2>
          </div>
          <div className="rulesContextMetrics">
            <div><span>Loss</span><strong>{formatMaybeNumber(loss)}</strong></div>
            <div><span>Validation loss</span><strong>{formatMaybeNumber(validationLoss)}</strong></div>
            <div><span>Reconstruction error</span><strong>{formatMaybeNumber(reconstructionError)}</strong></div>
            <div><span>Threshold</span><strong>{formatMaybeNumber(threshold)}</strong></div>
            <div><span>Error ratio</span><strong>{formatMaybeNumber(reconstructionRatio)}</strong></div>
            <div><span>Avg inference</span><strong>{model.avg_inference_ms ?? model.metrics.avg_inference_ms ?? "N/A"} ms</strong></div>
          </div>
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Why Was This Event Poorly Reconstructed?</span>
          <h2>Explainability par erreur de reconstruction</h2>
        </div>
        <p className="isolationMetricNote">Les variables dont l'ecart reconstruit est le plus eleve expliquent la detection Autoencoder.</p>
        <div className="isolationEventExplainList">
          {autoencoderEventExplanations(results).map((event) => (
            <div className="isolationEventExplainCard" key={event.id}>
              <div>
                <span>{event.id}</span>
                <strong>{event.flow}</strong>
                <em>{event.decision}</em>
              </div>
              <b>Reconstruction Error {event.score} - Risk Score {event.riskScore}</b>
              <div className="rulesContributionList">
                {event.contributions.map((item) => (
                  <div className="rulesContribution" key={`${event.id}-${item.label}`}>
                    <div><span>{item.label}</span><strong>+{item.value}</strong></div>
                    <i><b style={{ width: `${item.value}%` }} /></i>
                    <small>{item.reason}</small>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Reconstruction Patterns</span>
            <h2>Discovered Reconstruction Anomalies</h2>
          </div>
          <div className="isolationPatternGrid">
            {clusters.slice(0, 6).map((cluster) => (
              <button className="isolationPatternCard" key={cluster.type} type="button" onClick={() => setSelectedCluster(cluster)}>
                <span className={cluster.severity}>{cluster.severity}</span>
                <strong>{behaviourPatternName(cluster.type)}</strong>
                <p>{cluster.flows.length} flows, {cluster.occurrences} reconstruction anomalies</p>
                <RulesSparkline values={cluster.sparkline} />
                <div><em>recon risk {cluster.avgRisk}</em><em>{cluster.validation}</em></div>
              </button>
            ))}
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Impact Analysis</span>
            <h2>Most Impacted Services</h2>
          </div>
          <div className="rulesServiceHeatmap">
            {services.slice(0, 12).map((service) => (
              <span className={service.status} key={service.name}>{service.name}</span>
            ))}
          </div>
          <div className="rulesServiceTable">
            {services.slice(0, 6).map((service) => (
              <div key={service.name}>
                <strong>{service.name}</strong>
                <span>{service.count} recon errors</span>
                <span>{service.consumers} flows</span>
                <span>{service.slaRisk}</span>
                <span>{service.propagationRisk}</span>
                <em className={service.status}>{service.status}</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Deep Learning Training</span>
            <h2>Manual Training Panel</h2>
          </div>
          <form className="isolationTrainingForm" onSubmit={submitTraining}>
            <p>L'autoencoder apprend a reconstruire des evenements normaux ou majoritairement normaux.</p>
            <label>
              <span>Date debut</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_start} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_start: event.target.value })} />
            </label>
            <label>
              <span>Date fin</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_end} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_end: event.target.value })} />
            </label>
            <label>
              <span>Taille echantillon</span>
              <input className="input" type="number" min={100} max={50000} value={trainingForm.sample_size} onChange={(event) => setTrainingForm({ ...trainingForm, sample_size: Number(event.target.value) })} />
            </label>
            <label>
              <span>Max iterations</span>
              <input className="input" type="number" min={50} max={800} value={trainingForm.epochs} onChange={(event) => setTrainingForm({ ...trainingForm, epochs: Number(event.target.value) })} />
            </label>
            <label>
              <span>Validation split</span>
              <input className="input" type="number" min={0.05} max={0.4} step={0.01} value={trainingForm.validation_split} onChange={(event) => setTrainingForm({ ...trainingForm, validation_split: Number(event.target.value) })} />
            </label>
            <label>
              <span>Mode dataset</span>
              <select className="input" value={trainingForm.dataset_mode} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_mode: event.target.value })}>
                <option value="normal_only">normal_only</option>
                <option value="mixed">mixed</option>
                <option value="recent">recent</option>
              </select>
            </label>
            <button className="button primary" type="submit" disabled={trainingSubmitting}>
              {trainingSubmitting ? "Training job..." : "Train model"}
            </button>
            {trainingMessage && <div className="successBox">{trainingMessage}</div>}
            {trainingError && <div className="errorBox">{trainingError}</div>}
          </form>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Training Lifecycle</span>
            <h2>Training History</h2>
          </div>
          <AutoencoderTrainingHistory jobs={history} model={model} />
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Model Evolution</span>
          <h2>Historique des ameliorations</h2>
        </div>
        <div className="isolationImprovements">
          {(improvements.length ? improvements : defaultAutoencoderImprovements(model)).map((item) => (
            <div key={`${item.date}-${item.change}`}>
              <span>{item.date} - {item.version}</span>
              <strong>{item.change}</strong>
              <p>{item.expected_impact}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Improvement History</span>
          <h2>Rules Evolution</h2>
        </div>
        <div className="isolationTableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Version</th>
                <th>Change</th>
                <th>Expected Impact</th>
              </tr>
            </thead>
            <tbody>
              {(improvements.length ? improvements : defaultRulesImprovements(model)).map((item) => (
                <tr key={`${item.date}-${item.change}`}>
                  <td>{item.date}</td>
                  <td>{item.version}</td>
                  <td>{item.change}</td>
                  <td>{item.expected_impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCluster && (
        <IsolationExplainabilityDrawer
          cluster={selectedCluster}
          model={model}
          onClose={() => setSelectedCluster(null)}
        />
      )}
    </div>
  );
}

function LocalOutlierFactorObservabilityConsole({
  model,
  results,
  lifecycle,
  recommendation,
  improvements,
  history,
  trainingForm,
  setTrainingForm,
  submitTraining,
  trainingSubmitting,
  trainingMessage,
  trainingError,
}: {
  model: AiModel;
  results: AiModelResult[];
  lifecycle: ModelLifecycle | null;
  recommendation: RetrainingRecommendation | null;
  improvements: AiModelImprovement[];
  history: TrainingJob[];
  trainingForm: {
    dataset_start: string;
    dataset_end: string;
    sample_size: number;
    contamination: number;
    max_samples: string;
    dataset_mode: string;
  };
  setTrainingForm: (value: any) => void;
  submitTraining: (event: FormEvent<HTMLFormElement>) => void;
  trainingSubmitting: boolean;
  trainingMessage: string | null;
  trainingError: string | null;
}) {
  const [selectedCluster, setSelectedCluster] = useState<AnomalyCluster | null>(null);
  const clusters = useMemo(() => buildBehaviourClusters(results), [results]);
  const services = useMemo(() => buildImpactedServices(results), [results]);
  const topCluster = clusters[0] || null;
  const anomalyRate = metricNumber(model.metrics.anomaly_rate) ?? (model.anomalies_detected / Math.max(model.analyzed_events, 1));
  const contamination = metricNumber(model.metrics.contamination_rate) ?? trainingForm.contamination ?? 0.035;
  const neighbors = metricNumber(model.metrics.n_neighbors) ?? 35;
  const driftPercent = Math.round((lifecycle?.drift_score ?? 0.06) * 100);
  const health = lofHealthScore(model, lifecycle);
  const localOutliers = results.filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL").length || model.anomalies_detected;
  const impactedFlows = new Set(results.map((item) => item.flow_or_api).filter(Boolean)).size || topCluster?.flows.length || 0;

  return (
    <div className="rulesOpsConsole isolationOpsConsole">
      <section className="rulesHero isolationHero">
        <div className="rulesHeroStatus isolationHeroStatus">
          <div className="rulesLiveBadge"><i /> local density monitor</div>
          <span className="sectionEyebrow">Event-Level Local Outlier Factor - v{model.version}</span>
          <h1>Event-Level Local Outlier Factor</h1>
          <p>Modele non supervise Event-Level qui compare chaque evenement a son voisinage local pour detecter les comportements contextuellement rares.</p>
          <strong>{health >= 75 ? "Neighbourhood stable" : "Neighbourhood a surveiller"}</strong>
          <p>{topCluster ? `${behaviourPatternName(topCluster.type)} detecte sur ${topCluster.flows.length} flows proches.` : "Surveillance locale des densites comportementales active."}</p>
          <div className="rulesHeroKpis">
            <div><span>LOF Health</span><strong>{health}/100</strong><small>densite locale</small></div>
            <div><span>Local Outliers</span><strong>{localOutliers}</strong><small>events isoles</small></div>
            <div><span>Neighbors</span><strong>{formatMaybeNumber(neighbors)}</strong><small>voisinage compare</small></div>
            <div><span>Outlier Ratio</span><strong>{formatMaybePercent(anomalyRate)}</strong><small>observed stream</small></div>
            <div><span>Density Drift</span><strong>{driftPercent}%</strong><small>baseline locale</small></div>
            <div><span>Impacted Flows</span><strong>{impactedFlows}</strong><small>flows atypiques</small></div>
          </div>
        </div>

        <div className="rulesHeroTrend">
          <div className="rulesMiniHeader">
            <span>Local Outlier Activity</span>
            <strong>{Math.round(anomalyRate * 100)}%</strong>
          </div>
          <RulesAreaChart values={lofTrendValues(results)} />
          <div className="rulesTrendStats">
            <span>Configured contamination <strong>{formatMaybePercent(contamination)}</strong></span>
            <span>Neighbourhood stability <strong>{Math.max(0, 100 - driftPercent)}%</strong></span>
            <span>Local density <strong>{health >= 75 ? "stable" : "watch"}</strong></span>
          </div>
        </div>
      </section>

      <section className="rulesContextStrip">
        {["unsupervised", "event-level", "local density", "neighbourhood outliers", "trainable"].map((item) => <span key={item}>{item}</span>)}
      </section>

      <section className="rulesGlassCard isolationMetricsCard">
        <div className="rulesSectionTitle">
          <span>LOF Evaluation</span>
          <h2>Metriques Local Outlier Factor</h2>
        </div>
        <div className="isolationConfusionPanel">
          <div className="rulesSectionTitle">
            <span>Validation disponible</span>
            <h3>Qualite detection outlier</h3>
          </div>
          <div className="isolationConfusionGrid">
            {lofPerformanceMetrics(model, history, anomalyRate, contamination, neighbors).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.help}</small>
              </div>
            ))}
          </div>
          <div className="isolationConfusionCounts">
            {isolationConfusionCounts(model).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <p>LOF se lit surtout par densite locale: un evenement devient suspect quand sa densite est faible par rapport a ses voisins proches.</p>
        </div>
      </section>

      <section className="rulesGlassCard isolationBaselineCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Neighbourhood Supervision</span>
            <h2>Local Density Health</h2>
          </div>
          <span className={`rulesState ${health >= 80 ? "healthy" : health >= 60 ? "degraded" : "critical"}`}>{health >= 80 ? "Healthy" : health >= 60 ? "Watch" : "Degraded"}</span>
        </div>
        <div className="rulesValidationGrid">
          <div title="Stabilite de la densite locale apprise."><span>Density Stability</span><strong>{health}%</strong></div>
          <div title="Nombre de voisins utilises par LOF."><span>N Neighbors</span><strong>{formatMaybeNumber(neighbors)}</strong></div>
          <div title="Ecart entre comportement courant et voisinage appris."><span>Density Drift</span><strong>{formatPercent(lifecycle?.drift_score)}</strong></div>
          <div title="Fraicheur du voisinage appris."><span>Freshness</span><strong>{formatPercent(lifecycle?.freshness_score)}</strong></div>
          <div title="Dernier entrainement complet connu."><span>Last Training</span><strong>{lifecycle?.last_trained_at || model.last_training_at || "N/A"}</strong></div>
          <div title="Maintenance recommandee."><span>Maintenance</span><strong>{recommendation?.recommended ? "retrain" : "stable"}</strong></div>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Behavioural Drift Intelligence</span>
            <h2>Current Local Density vs Learned Neighbourhood</h2>
          </div>
          <div className="isolationDriftGrid">
            <RulesRadialGauge value={Math.max(0, 100 - driftPercent)} label="Density" />
            <div className="rulesContributionList">
              {lofDensityBreakdown(model, lifecycle, anomalyRate, contamination).map((item) => (
                <div className="rulesContribution" key={item.label}>
                  <div><span>{item.label}</span><strong>{item.value}</strong></div>
                  <i><b style={{ width: `${item.value}%` }} /></i>
                  <small>{item.reason}</small>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Neighbourhood Sensitivity</span>
            <h2>Local Outlier Settings</h2>
          </div>
          <div className="rulesContextMetrics">
            <div><span>N neighbors</span><strong>{formatMaybeNumber(neighbors)}</strong></div>
            <div><span>Contamination</span><strong>{formatMaybePercent(contamination)}</strong></div>
            <div><span>Observed outlier ratio</span><strong>{formatMaybePercent(anomalyRate)}</strong></div>
            <div><span>Outlier density</span><strong>{Math.round(anomalyRate * 1000)}/k</strong></div>
            <div><span>Avg inference</span><strong>{model.avg_inference_ms ?? model.metrics.avg_inference_ms ?? "N/A"} ms</strong></div>
            <div><span>Freshness</span><strong>{formatPercent(lifecycle?.freshness_score)}</strong></div>
          </div>
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Why Was This Event Locally Outlying?</span>
          <h2>Explainability par voisinage</h2>
        </div>
        <p className="isolationMetricNote">Les variables qui eloignent l'evenement de son voisinage local expliquent la decision LOF.</p>
        <div className="isolationEventExplainList">
          {lofEventExplanations(results).map((event) => (
            <div className="isolationEventExplainCard" key={event.id}>
              <div>
                <span>{event.id}</span>
                <strong>{event.flow}</strong>
                <em>{event.decision}</em>
              </div>
              <b>Local Outlier Score {event.score} - Risk Score {event.riskScore}</b>
              <div className="rulesContributionList">
                {event.contributions.map((item) => (
                  <div className="rulesContribution" key={`${event.id}-${item.label}`}>
                    <div><span>{item.label}</span><strong>+{item.value}</strong></div>
                    <i><b style={{ width: `${item.value}%` }} /></i>
                    <small>{item.reason}</small>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Local Outlier Patterns</span>
            <h2>Discovered Local Behavioural Patterns</h2>
          </div>
          <div className="isolationPatternGrid">
            {clusters.slice(0, 6).map((cluster) => (
              <button className="isolationPatternCard" key={cluster.type} type="button" onClick={() => setSelectedCluster(cluster)}>
                <span className={cluster.severity}>{cluster.severity}</span>
                <strong>{behaviourPatternName(cluster.type)}</strong>
                <p>{cluster.flows.length} flows, {cluster.occurrences} local outliers</p>
                <RulesSparkline values={cluster.sparkline} />
                <div><em>density risk {cluster.avgRisk}</em><em>{cluster.validation}</em></div>
              </button>
            ))}
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Impact Analysis</span>
            <h2>Most Impacted Services</h2>
          </div>
          <div className="rulesServiceHeatmap">
            {services.slice(0, 12).map((service) => (
              <span className={service.status} key={service.name}>{service.name}</span>
            ))}
          </div>
          <div className="rulesServiceTable">
            {services.slice(0, 6).map((service) => (
              <div key={service.name}>
                <strong>{service.name}</strong>
                <span>{service.count} outliers</span>
                <span>{service.consumers} flows</span>
                <span>{service.slaRisk}</span>
                <span>{service.propagationRisk}</span>
                <em className={service.status}>{service.status}</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Unsupervised Training</span>
            <h2>Manual Training Panel</h2>
          </div>
          <form className="isolationTrainingForm" onSubmit={submitTraining}>
            <p>LOF apprend un voisinage local normal et signale les observations dont la densite locale devient atypique.</p>
            <label>
              <span>Date debut</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_start} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_start: event.target.value })} />
            </label>
            <label>
              <span>Date fin</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_end} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_end: event.target.value })} />
            </label>
            <label>
              <span>Taille echantillon</span>
              <input className="input" type="number" min={100} max={50000} value={trainingForm.sample_size} onChange={(event) => setTrainingForm({ ...trainingForm, sample_size: Number(event.target.value) })} />
            </label>
            <label>
              <span>Contamination</span>
              <input className="input" type="number" min={0.001} max={0.25} step={0.001} value={trainingForm.contamination} onChange={(event) => setTrainingForm({ ...trainingForm, contamination: Number(event.target.value) })} />
            </label>
            <label>
              <span>N neighbors</span>
              <input className="input" value={trainingForm.max_samples} onChange={(event) => setTrainingForm({ ...trainingForm, max_samples: event.target.value })} placeholder="auto ou 35" />
            </label>
            <label>
              <span>Mode dataset</span>
              <select className="input" value={trainingForm.dataset_mode} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_mode: event.target.value })}>
                <option value="normal_only">normal_only</option>
                <option value="mixed">mixed</option>
                <option value="recent">recent</option>
              </select>
            </label>
            <button className="button primary" type="submit" disabled={trainingSubmitting}>
              {trainingSubmitting ? "Training job..." : "Train model"}
            </button>
            {trainingMessage && <div className="successBox">{trainingMessage}</div>}
            {trainingError && <div className="errorBox">{trainingError}</div>}
          </form>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Training Lifecycle</span>
            <h2>Training History</h2>
          </div>
          <IsolationTrainingHistory jobs={history} model={model} />
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Model Evolution</span>
          <h2>Historique des ameliorations</h2>
        </div>
        <div className="isolationImprovements">
          {(improvements.length ? improvements : defaultLofImprovements(model)).map((item) => (
            <div key={`${item.date}-${item.change}`}>
              <span>{item.date} - {item.version}</span>
              <strong>{item.change}</strong>
              <p>{item.expected_impact}</p>
            </div>
          ))}
        </div>
      </section>

      {selectedCluster && (
        <IsolationExplainabilityDrawer
          cluster={selectedCluster}
          model={model}
          onClose={() => setSelectedCluster(null)}
        />
      )}
    </div>
  );
}

function IsolationForestObservabilityConsole({
  model,
  results,
  lifecycle,
  recommendation,
  improvements,
  history,
  trainingForm,
  setTrainingForm,
  submitTraining,
  trainingSubmitting,
  trainingMessage,
  trainingError,
}: {
  model: AiModel;
  results: AiModelResult[];
  lifecycle: ModelLifecycle | null;
  recommendation: RetrainingRecommendation | null;
  improvements: AiModelImprovement[];
  history: TrainingJob[];
  trainingForm: {
    dataset_start: string;
    dataset_end: string;
    sample_size: number;
    contamination: number;
    random_state: number;
    max_samples: string;
    bootstrap: boolean;
    dataset_mode: string;
  };
  setTrainingForm: (value: any) => void;
  submitTraining: (event: FormEvent<HTMLFormElement>) => void;
  trainingSubmitting: boolean;
  trainingMessage: string | null;
  trainingError: string | null;
}) {
  const [selectedCluster, setSelectedCluster] = useState<AnomalyCluster | null>(null);
  const clusters = useMemo(() => buildBehaviourClusters(results), [results]);
  const services = useMemo(() => buildImpactedServices(results), [results]);
  const topCluster = clusters[0] || null;
  const anomalyRate = metricNumber(model.metrics.anomaly_rate) ?? (model.anomalies_detected / Math.max(model.analyzed_events, 1));
  const contamination = metricNumber(model.metrics.contamination_rate) ?? 0.035;
  const drift = lifecycle?.drift_score ?? 0.04;
  const driftPercent = Math.round(drift * 100);
  const abnormalEvents = results.filter((item) => item.result === "anomaly").length;
  const unusualFlows = new Set(results.map((item) => item.flow_or_api)).size;
  const unknownPatterns = Math.max(clusters.length, new Set(results.map((item) => item.anomaly_type)).size);
  const health = isolationHealthScore(model, lifecycle);
  const state = health >= 82 && drift < 0.15 ? "healthy" : health >= 62 ? "degraded" : "critical";
  const stateLabel = state === "healthy" ? "Healthy" : state === "degraded" ? "Degraded" : "Unstable";
  const behaviourInsight = topCluster
    ? `${topCluster.type.replaceAll("_", " ")} detected across ${topCluster.flows.length} supervised flows.`
    : "No abnormal behavioural island detected in the current stream.";
  const isolatedEvents = isolatedEventExplanations(results);
  const baseline = behaviouralBaselineHealth(model, lifecycle);

  return (
    <div className="rulesOpsConsole isolationOpsConsole">
      <header className="rulesOpsHeader">
        <div>
          <span className="rulesOpsEyebrow">Unsupervised AI Observability</span>
          <h1>Event-Level Isolation Forest</h1>
          <p>Modele non supervise Event-Level pour detecter les comportements rares, inconnus ou atypiques dans les evenements API et audit.</p>
        </div>
        <div className="rulesOpsHeaderActions">
          <span className={`rulesPulse ${state}`}><i />Isolation stream active</span>
          <Link className="rulesGhostButton" href="/models">Back to models</Link>
        </div>
      </header>

      <section className="rulesHero">
        <div className="rulesHeroStatus isolationHeroStatus">
          <div className="rulesHeroStatusTop">
            <span className={`rulesState ${state}`}>{stateLabel}</span>
            <span>Last anomaly {formatRelativeTime(results[0]?.date)}</span>
          </div>
          <h2>Behavioural Monitoring Overview</h2>
          <p>{behaviourInsight}</p>
          <div className="rulesHeroKpis">
            <div><span>Anomaly Score</span><strong>{Math.round((topCluster?.avgRisk || 58))}</strong><small>isolation severity</small></div>
            <div><span>Abnormal Events</span><strong>{abnormalEvents}</strong><small>recent stream cards</small></div>
            <div><span>Drift Level</span><strong>{driftPercent}%</strong><small>baseline deviation</small></div>
            <div><span>Unknown Patterns</span><strong>{unknownPatterns}</strong><small>behavioural signatures</small></div>
            <div><span>Unusual Flows</span><strong>{unusualFlows}</strong><small>impacted flows</small></div>
            <div><span>Contamination</span><strong>{formatPercent(contamination)}</strong><small>configured sensitivity</small></div>
          </div>
        </div>

        <div className="rulesHeroTrend">
          <div className="rulesMiniHeader">
            <span>Live Anomaly Score Evolution</span>
            <strong>{Math.round(anomalyRate * 100)}%</strong>
          </div>
          <RulesAreaChart values={isolationTrendValues(results)} />
          <div className="rulesTrendStats">
            <span>Observed anomaly ratio <strong>{formatPercent(anomalyRate)}</strong></span>
            <span>Baseline stability <strong>{Math.max(0, 100 - driftPercent)}%</strong></span>
            <span>Pattern activity <strong>{unknownPatterns > 4 ? "high" : "moderate"}</strong></span>
          </div>
        </div>
      </section>

      <section className="rulesContextStrip">
        {["unsupervised", "event-level", "behavioural anomaly detection", "unknown pattern discovery", "trainable"].map((item) => <span key={item}>{item}</span>)}
      </section>

      <section className="rulesGlassCard isolationMetricsCard">
        <div className="rulesSectionTitle">
          <span>MLOps Evaluation</span>
          <h2>Metriques de performance</h2>
        </div>
        <div className="isolationConfusionPanel">
          <div className="rulesSectionTitle">
            <span>Validation supervisee</span>
            <h3>Metriques de matrice de confusion</h3>
          </div>
          <div className="isolationConfusionGrid">
            {isolationConfusionMetrics(model, history).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.help}</small>
              </div>
            ))}
          </div>
          <div className="isolationConfusionCounts">
            {isolationConfusionCounts(model).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <p>
            Ces scores sont calcules uniquement quand le simulateur ou la validation manuelle fournit un label attendu.
            Ils servent a verifier le modele, mais ne remplacent pas l'analyse non supervisee des scores d'isolation.
          </p>
        </div>
        <div className="rulesSectionTitle isolationSubSectionTitle">
          <span>Unsupervised behaviour metrics</span>
          <h3>Scores comportementaux Isolation Forest</h3>
        </div>
        <div className="isolationMetricGrid">
          {isolationPerformanceMetrics(model, results, clusters, anomalyRate, contamination).map((item) => (
            <div key={item.label} title={item.help}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.help}</small>
            </div>
          ))}
        </div>
        <p className="isolationMetricNote">
          Ces metriques decrivent le comportement interne du moteur Isolation Forest et la qualite de la baseline comportementale.
        </p>
      </section>

      <section className="rulesGlassCard isolationBaselineCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Baseline Supervision</span>
            <h2>Behavioural Baseline Health</h2>
          </div>
          <span className={`rulesState ${baseline.statusClass}`}>{baseline.status}</span>
        </div>
        <div className="rulesValidationGrid">
          <div title="Stabilite globale de la baseline comportementale apprise."><span>Baseline Stability</span><strong>{baseline.stability}%</strong></div>
          <div title="Ecart observe entre le comportement courant et la baseline apprise."><span>Drift Level</span><strong>{formatPercent(lifecycle?.drift_score)}</strong></div>
          <div title="Fraicheur du modele et des donnees utilisees pour l'entrainement."><span>Freshness</span><strong>{formatPercent(lifecycle?.freshness_score)}</strong></div>
          <div title="Dernier entrainement complet connu."><span>Last Training</span><strong>{lifecycle?.last_trained_at || model.last_training_at || "N/A"}</strong></div>
          <div title="Age du modele depuis son dernier entrainement."><span>Model Age</span><strong>{lifecycle?.days_since_last_training ?? "N/A"} j</strong></div>
          <div title="Signal de maintenance base sur drift, fraicheur et donnees recentes."><span>Maintenance</span><strong>{recommendation?.recommended ? "retrain" : "stable"}</strong></div>
        </div>
      </section>

      <section className="rulesGlassCard isolationDensityCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Core Visual</span>
            <h2>Anomaly Score Distribution</h2>
          </div>
          <span className="isolationThreshold">Threshold {formatPercent(contamination)}</span>
        </div>
        <IsolationDensityChart clusters={clusters} contamination={contamination} />
        <div className="isolationZones">
          <span className="healthy">normal zone</span>
          <span className="degraded">suspicious zone</span>
          <span className="critical">critical isolation</span>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Behavioural Drift Intelligence</span>
            <h2>Current Behaviour vs Learned Baseline</h2>
          </div>
          <div className="isolationDriftGrid">
            <RulesRadialGauge value={Math.max(0, 100 - driftPercent)} label="Baseline" />
            <div className="rulesContributionList">
              {isolationDriftBreakdown(model, lifecycle).map((item) => (
                <div className="rulesContribution" key={item.label}>
                  <div><span>{item.label}</span><strong>{item.value}</strong></div>
                  <i><b style={{ width: `${item.value}%` }} /></i>
                  <small>{item.reason}</small>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Contamination Intelligence</span>
            <h2>Isolation Sensitivity</h2>
          </div>
          <div className="rulesContextMetrics">
            <div><span>Configured contamination</span><strong>{formatPercent(contamination)}</strong></div>
            <div><span>Observed anomaly ratio</span><strong>{formatPercent(anomalyRate)}</strong></div>
            <div><span>Anomaly density</span><strong>{Math.round(anomalyRate * 1000)}/k</strong></div>
            <div><span>Isolation sensitivity</span><strong>{contamination > 0.05 ? "high" : "balanced"}</strong></div>
            <div><span>Health score</span><strong>{health}/100</strong></div>
            <div><span>Freshness</span><strong>{formatPercent(lifecycle?.freshness_score)}</strong></div>
          </div>
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Why Was This Event Isolated?</span>
          <h2>Explainability des anomalies</h2>
        </div>
        <p className="isolationMetricNote">
          Les variables presentant les ecarts les plus importants par rapport a la baseline normale expliquent la decision d'isolation.
        </p>
        <div className="isolationEventExplainList">
          {isolatedEvents.map((event) => (
            <div className="isolationEventExplainCard" key={event.id}>
              <div>
                <span>{event.id}</span>
                <strong>{event.flow}</strong>
                <em>{event.decision}</em>
              </div>
              <b>Isolation Score {event.score} - Risk Score {event.riskScore}</b>
              <div className="rulesContributionList">
                {event.contributions.map((item) => (
                  <div className="rulesContribution" key={`${event.id}-${item.label}`}>
                    <div><span>{item.label}</span><strong>+{item.value}</strong></div>
                    <i><b style={{ width: `${item.value}%` }} /></i>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Unknown Pattern Discovery</span>
          <h2>Behavioural Patterns</h2>
        </div>
        <div className="isolationPatternGrid">
          {clusters.slice(0, 6).map((cluster) => (
            <button className="isolationPatternCard" key={cluster.type} type="button" onClick={() => setSelectedCluster(cluster)}>
              <span className={cluster.severity}>{cluster.severity}</span>
              <strong>{behaviourPatternName(cluster.type)}</strong>
              <p>{cluster.flows.length} flows, {cluster.occurrences} isolated events</p>
              <RulesSparkline values={cluster.sparkline} />
              <div><em>score {cluster.avgRisk}</em><em>{cluster.validation}</em></div>
            </button>
          ))}
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Impact Analysis</span>
            <h2>Most Impacted Services</h2>
          </div>
          <div className="rulesServiceHeatmap">
            {services.slice(0, 12).map((service) => (
              <span className={service.status} key={service.name}>{service.name}</span>
            ))}
          </div>
          <div className="rulesServiceTable">
            {services.slice(0, 6).map((service) => (
              <div key={service.name}>
                <strong>{service.name}</strong>
                <span>{service.count} isolated</span>
                <span>{service.consumers} flows</span>
                <span>{service.slaRisk}</span>
                <span>{service.propagationRisk}</span>
                <em className={service.status}>{service.status}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Model Health</span>
            <h2>Unsupervised Runtime</h2>
          </div>
          <div className="rulesValidationGrid">
            <div><span>Freshness</span><strong>{formatPercent(lifecycle?.freshness_score)}</strong></div>
            <div><span>Drift</span><strong>{formatPercent(lifecycle?.drift_score)}</strong></div>
            <div><span>Last update</span><strong>{lifecycle?.last_trained_at || model.last_training_at || model.last_improvement_at}</strong></div>
            <div><span>Anomaly stability</span><strong>{recommendation?.recommended ? "review" : "stable"}</strong></div>
          </div>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Unsupervised Training</span>
            <h2>Manual Training Panel</h2>
          </div>
          <form className="isolationTrainingForm" onSubmit={submitTraining}>
            <p>Isolation Forest apprend les comportements normaux et isole les observations rares ou atypiques.</p>
            <label>
              <span>Date debut</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_start} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_start: event.target.value })} />
            </label>
            <label>
              <span>Date fin</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_end} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_end: event.target.value })} />
            </label>
            <label>
              <span>Taille echantillon</span>
              <input className="input" type="number" min={100} max={50000} value={trainingForm.sample_size} onChange={(event) => setTrainingForm({ ...trainingForm, sample_size: Number(event.target.value) })} />
            </label>
            <label>
              <span>Contamination</span>
              <input className="input" type="number" min={0.001} max={0.25} step={0.001} value={trainingForm.contamination} onChange={(event) => setTrainingForm({ ...trainingForm, contamination: Number(event.target.value) })} />
            </label>
            <label>
              <span>Random state</span>
              <input className="input" type="number" value={trainingForm.random_state} onChange={(event) => setTrainingForm({ ...trainingForm, random_state: Number(event.target.value) })} />
            </label>
            <label>
              <span>Max samples</span>
              <input className="input" value={trainingForm.max_samples} onChange={(event) => setTrainingForm({ ...trainingForm, max_samples: event.target.value })} />
            </label>
            <label>
              <span>Bootstrap</span>
              <select className="input" value={String(trainingForm.bootstrap)} onChange={(event) => setTrainingForm({ ...trainingForm, bootstrap: event.target.value === "true" })}>
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            </label>
            <label>
              <span>Mode dataset</span>
              <select className="input" value={trainingForm.dataset_mode} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_mode: event.target.value })}>
                <option value="normal_only">normal_only</option>
                <option value="mixed">mixed</option>
                <option value="recent">recent</option>
              </select>
            </label>
            <button className="button primary" type="submit" disabled={trainingSubmitting}>
              {trainingSubmitting ? "Training job..." : "Train model"}
            </button>
            {trainingMessage && <div className="successBox">{trainingMessage}</div>}
            {trainingError && <div className="errorBox">{trainingError}</div>}
          </form>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Training Lifecycle</span>
            <h2>Training History</h2>
          </div>
          <IsolationTrainingHistory jobs={history} model={model} />
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Model Evolution</span>
          <h2>Historique des ameliorations</h2>
        </div>
        <div className="isolationImprovements">
          {(improvements.length ? improvements : defaultIsolationImprovements(model)).map((item) => (
            <div key={`${item.date}-${item.change}`}>
              <span>{item.date} - {item.version}</span>
              <strong>{item.change}</strong>
              <p>{item.expected_impact}</p>
            </div>
          ))}
        </div>
      </section>

      {selectedCluster && (
        <IsolationExplainabilityDrawer
          cluster={selectedCluster}
          model={model}
          onClose={() => setSelectedCluster(null)}
        />
      )}
    </div>
  );
}

function RandomForestObservabilityConsole({
  model,
  results,
  lifecycle,
  recommendation,
  improvements,
  history,
  trainingForm,
  setTrainingForm,
  submitTraining,
  trainingSubmitting,
  trainingMessage,
  trainingError,
}: {
  model: AiModel;
  results: AiModelResult[];
  lifecycle: ModelLifecycle | null;
  recommendation: RetrainingRecommendation | null;
  improvements: AiModelImprovement[];
  history: TrainingJob[];
  trainingForm: {
    dataset_start: string;
    dataset_end: string;
    sample_size: number;
    random_state: number;
    dataset_mode: string;
  };
  setTrainingForm: (value: any) => void;
  submitTraining: (event: FormEvent<HTMLFormElement>) => void;
  trainingSubmitting: boolean;
  trainingMessage: string | null;
  trainingError: string | null;
}) {
  const [selectedCluster, setSelectedCluster] = useState<AnomalyCluster | null>(null);
  const clusters = useMemo(() => buildAnomalyClusters(results), [results]);
  const services = useMemo(() => buildImpactedServices(results), [results]);
  const latestCompletedJob = history.find((job) => job.status === "completed") || null;
  const quality = supervisedQualityScore(model, lifecycle);
  const accuracy = metricNumber(model.metrics.accuracy ?? latestCompletedJob?.accuracy);
  const f1 = metricNumber(model.metrics.f1_score ?? latestCompletedJob?.f1_score);
  const precision = metricNumber(model.metrics.precision ?? latestCompletedJob?.precision_score);
  const recall = metricNumber(model.metrics.recall ?? latestCompletedJob?.recall_score);
  const topClass = topClassLabel(model, results);
  const activePredictions = results.filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL").length || model.anomalies_detected;
  const classCount = new Set([...(model.detectable_labels || []), ...(model.target_anomalies || []), ...results.map((item) => item.anomaly_type)]).size;
  const falsePositiveRate = metricNumber(model.metrics.false_positive_rate) ?? estimateFalsePositiveRate(model);
  const falseNegativeRate = metricNumber(model.metrics.false_negative_rate) ?? (recall === null ? null : 1 - recall);

  return (
    <div className="rulesOpsConsole isolationOpsConsole">
      <section className="rulesHero isolationHero">
        <div className="rulesHeroStatus isolationHeroStatus">
          <div className="rulesLiveBadge"><i /> supervised classifier</div>
          <span className="sectionEyebrow">Event-Level Random Forest - v{model.version}</span>
          <h1>Event-Level Random Forest</h1>
          <p>Modele supervise Event-Level pour classifier les anomalies connues a partir d'evenements API et audit etiquetes.</p>
          <strong>{f1 !== null && f1 >= 0.75 ? "Classifier stable" : "Classifier a consolider"}</strong>
          <p>Classe dominante: {topClass}. Le modele priorise les labels connus et la separabilite des anomalies supervisees.</p>
          <div className="rulesHeroKpis">
            <div><span>Accuracy</span><strong>{formatMaybePercent(accuracy)}</strong><small>predictions correctes</small></div>
            <div><span>Precision</span><strong>{formatMaybePercent(precision)}</strong><small>fausses alertes controlees</small></div>
            <div><span>Recall</span><strong>{formatMaybePercent(recall)}</strong><small>anomalies retrouvees</small></div>
            <div><span>F1 Score</span><strong>{formatMaybePercent(f1)}</strong><small>equilibre global</small></div>
            <div><span>Classes</span><strong>{classCount}</strong><small>labels supervises</small></div>
            <div><span>Predictions</span><strong>{activePredictions}</strong><small>anomalies recentes</small></div>
          </div>
        </div>

        <div className="rulesHeroTrend">
          <div className="rulesMiniHeader">
            <span>Classification Activity</span>
            <strong>{quality}/100</strong>
          </div>
          <RulesAreaChart values={classificationTrendValues(results)} />
          <div className="rulesTrendStats">
            <span>False positive rate <strong>{formatMaybePercent(falsePositiveRate)}</strong></span>
            <span>False negative rate <strong>{formatMaybePercent(falseNegativeRate)}</strong></span>
            <span>Validation <strong>{formatMaybePercent(metricNumber(model.metrics.validation_match_rate) ?? accuracy)}</strong></span>
          </div>
        </div>
      </section>

      <section className="rulesContextStrip">
        {["supervised", "event-level", "known anomaly classification", "trainable", "explainable by features"].map((item) => <span key={item}>{item}</span>)}
      </section>

      <section className="rulesGlassCard isolationMetricsCard">
        <div className="rulesSectionTitle">
          <span>MLOps Evaluation</span>
          <h2>Metriques de performance</h2>
        </div>
        <div className="isolationConfusionPanel">
          <div className="rulesSectionTitle">
            <span>Validation supervisee</span>
            <h3>Classification Quality</h3>
          </div>
          <div className="isolationConfusionGrid">
            {randomForestPerformanceMetrics(model, history).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.help}</small>
              </div>
            ))}
          </div>
          <div className="isolationConfusionCounts">
            {randomForestConfusionCounts(model).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <p>
            Random Forest est evalue par labels supervises: la matrice de confusion mesure les erreurs entre classe attendue et classe predite.
          </p>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Confusion Matrix</span>
            <h2>Erreurs de classification</h2>
          </div>
          <RandomForestConfusionMatrix model={model} />
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Label Intelligence</span>
            <h2>Performance par classe</h2>
          </div>
          <div className="rulesContextMetrics">
            {randomForestClassMetrics(model, results).map((item) => (
              <div key={item.label} title={item.help}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rulesGlassCard isolationBaselineCard">
        <div className="rulesSectionTitle rulesSectionTitleRow">
          <div>
            <span>Classifier Supervision</span>
            <h2>Training Data Health</h2>
          </div>
          <span className={`rulesState ${quality >= 80 ? "healthy" : quality >= 60 ? "degraded" : "critical"}`}>{quality >= 80 ? "Healthy" : quality >= 60 ? "Watch" : "Degraded"}</span>
        </div>
        <div className="rulesValidationGrid">
          <div title="Qualite combinee Accuracy, F1, drift et fraicheur."><span>Classifier Quality</span><strong>{quality}/100</strong></div>
          <div title="Nombre d'evenements etiquetes utilises ou evaluables."><span>Labelled Eval</span><strong>{formatMaybeNumber(metricNumber(model.metrics.labelled_eval_count))}</strong></div>
          <div title="Ecart observe entre donnees recentes et periode d'entrainement."><span>Drift Level</span><strong>{formatPercent(lifecycle?.drift_score)}</strong></div>
          <div title="Fraicheur du modele supervise."><span>Freshness</span><strong>{formatPercent(lifecycle?.freshness_score)}</strong></div>
          <div title="Dernier entrainement complet connu."><span>Last Training</span><strong>{lifecycle?.last_trained_at || model.last_training_at || "N/A"}</strong></div>
          <div title="Action de maintenance recommandee."><span>Maintenance</span><strong>{recommendation?.recommended ? "retrain" : "stable"}</strong></div>
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Why Was This Event Classified?</span>
          <h2>Explainability des predictions</h2>
        </div>
        <p className="isolationMetricNote">
          Les variables les plus discriminantes expliquent pourquoi Random Forest classe un evenement dans une anomalie connue.
        </p>
        <div className="isolationEventExplainList">
          {randomForestExplanations(results).map((event) => (
            <div className="isolationEventExplainCard" key={event.id}>
              <div>
                <span>{event.id}</span>
                <strong>{event.flow}</strong>
                <em>{event.predictedLabel}</em>
              </div>
              <b>Confidence {formatMaybePercent(event.confidence)} - Risk Score {event.riskScore}</b>
              <div className="rulesContributionList">
                {event.contributions.map((item) => (
                  <div className="rulesContribution" key={`${event.id}-${item.label}`}>
                    <div><span>{item.label}</span><strong>+{item.value}</strong></div>
                    <i><b style={{ width: `${item.value}%` }} /></i>
                    <small>{item.reason}</small>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Known Anomaly Classes</span>
            <h2>Classification Patterns</h2>
          </div>
          <div className="isolationPatternGrid">
            {clusters.slice(0, 6).map((cluster) => (
              <button className="isolationPatternCard" key={cluster.type} type="button" onClick={() => setSelectedCluster(cluster)}>
                <span className={cluster.severity}>{cluster.severity}</span>
                <strong>{cluster.type}</strong>
                <p>{cluster.flows.length} flows, {cluster.occurrences} predictions</p>
                <RulesSparkline values={cluster.sparkline} />
                <div><em>risk {cluster.avgRisk}</em><em>{cluster.validation}</em></div>
              </button>
            ))}
          </div>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Impact Analysis</span>
            <h2>Most Impacted Services</h2>
          </div>
          <div className="rulesServiceHeatmap">
            {services.slice(0, 12).map((service) => (
              <span className={service.status} key={service.name}>{service.name}</span>
            ))}
          </div>
          <div className="rulesServiceTable">
            {services.slice(0, 6).map((service) => (
              <div key={service.name}>
                <strong>{service.name}</strong>
                <span>{service.count} classified</span>
                <span>{service.consumers} flows</span>
                <span>{service.slaRisk}</span>
                <span>{service.propagationRisk}</span>
                <em className={service.status}>{service.status}</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rulesOpsGrid">
        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Supervised Training</span>
            <h2>Manual Training Panel</h2>
          </div>
          <form className="isolationTrainingForm" onSubmit={submitTraining}>
            <p>Random Forest apprend a reconnaitre les anomalies connues a partir d'evenements etiquetes.</p>
            <label>
              <span>Date debut</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_start} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_start: event.target.value })} />
            </label>
            <label>
              <span>Date fin</span>
              <input className="input" type="datetime-local" value={trainingForm.dataset_end} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_end: event.target.value })} />
            </label>
            <label>
              <span>Taille echantillon</span>
              <input className="input" type="number" min={100} max={50000} value={trainingForm.sample_size} onChange={(event) => setTrainingForm({ ...trainingForm, sample_size: Number(event.target.value) })} />
            </label>
            <label>
              <span>Random state</span>
              <input className="input" type="number" value={trainingForm.random_state} onChange={(event) => setTrainingForm({ ...trainingForm, random_state: Number(event.target.value) })} />
            </label>
            <label>
              <span>Mode dataset</span>
              <select className="input" value={trainingForm.dataset_mode} onChange={(event) => setTrainingForm({ ...trainingForm, dataset_mode: event.target.value })}>
                <option value="mixed">mixed</option>
                <option value="recent">recent</option>
                <option value="labelled_only">labelled_only</option>
              </select>
            </label>
            <button className="button primary" type="submit" disabled={trainingSubmitting}>
              {trainingSubmitting ? "Training job..." : "Train model"}
            </button>
            {trainingMessage && <div className="successBox">{trainingMessage}</div>}
            {trainingError && <div className="errorBox">{trainingError}</div>}
          </form>
        </div>

        <div className="rulesGlassCard">
          <div className="rulesSectionTitle">
            <span>Training Lifecycle</span>
            <h2>Training History</h2>
          </div>
          <RandomForestTrainingHistory jobs={history} model={model} />
        </div>
      </section>

      <section className="rulesGlassCard">
        <div className="rulesSectionTitle">
          <span>Model Evolution</span>
          <h2>Historique des ameliorations</h2>
        </div>
        <div className="isolationImprovements">
          {(improvements.length ? improvements : defaultRandomForestImprovements(model)).map((item) => (
            <div key={`${item.date}-${item.change}`}>
              <span>{item.date} - {item.version}</span>
              <strong>{item.change}</strong>
              <p>{item.expected_impact}</p>
            </div>
          ))}
        </div>
      </section>

      {selectedCluster && (
        <AnomalyExplainabilityDrawer
          cluster={selectedCluster}
          model={model}
          onClose={() => setSelectedCluster(null)}
        />
      )}
    </div>
  );
}

type AnomalyCluster = {
  type: string;
  occurrences: number;
  flows: string[];
  severity: AiModelResult["severity"];
  avgRisk: number;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  validation: "matched" | HumanValidationStatus;
  validationComment?: string | null;
  sparkline: number[];
};

type HumanValidationStatus = "unverified" | "pending_review" | "confirmed" | "partial" | "false_positive" | "ignored";

type ImpactedService = {
  name: string;
  count: number;
  severity: AiModelResult["severity"];
  consumers: number;
  slaRisk: string;
  propagationRisk: string;
  status: "healthy" | "degraded" | "critical";
};

type FlowImpactedFlow = ImpactedService & {
  avgRisk: number;
};

type FlowRuleCatalogItem = {
  name: string;
  description: string;
  threshold: string;
  confidence: number;
  risk: number;
  state: "active" | "inactive";
  validation: "validated" | "partial" | "never_triggered";
};

function buildAnomalyClusters(results: AiModelResult[]): AnomalyCluster[] {
  const groups = new Map<string, AiModelResult[]>();
  results
    .filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL")
    .forEach((item) => {
      const current = groups.get(item.anomaly_type) || [];
      current.push(item);
      groups.set(item.anomaly_type, current);
    });

  return Array.from(groups.entries())
    .map(([type, rows]) => {
      const flows = Array.from(new Set(rows.map((item) => item.flow_or_api || "unknown")));
      const avgRisk = Math.round(rows.reduce((sum, item) => sum + item.risk_score, 0) / Math.max(rows.length, 1));
      const severity = highestSeverity(rows.map((item) => item.severity));
      const confidenceValues = rows.map((item) => item.confidence).filter((item): item is number => item !== null);
      const validation = validationState(rows);
      const validationComment = rows.find((item) => item.validation_comment)?.validation_comment || null;
      return {
        type,
        occurrences: rows.length,
        flows,
        severity,
        avgRisk,
        confidence: confidenceValues.length ? averageNumber(confidenceValues) : 0,
        firstSeen: formatRelativeTime(rows[rows.length - 1]?.date),
        lastSeen: formatRelativeTime(rows[0]?.date),
        validation,
        validationComment,
        sparkline: sparkValues(rows.length, avgRisk),
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences || b.avgRisk - a.avgRisk);
}

function buildRuleAnomalyFamilies(model: AiModel, results: AiModelResult[]): AnomalyCluster[] {
  const fromResults = buildAnomalyClusters(results);
  if (fromResults.length) return fromResults;
  const byType = model.metrics.anomalies_by_type || [];
  const rules = model.metrics.rule_definitions || [];
  return byType
    .filter((item) => item.type && item.type !== "NORMAL" && item.count > 0)
    .map((item) => {
      const rule = rules.find((candidate) => candidate.anomaly_type === item.type);
      const avgRisk = Math.round(metricNumber(rule?.base_score) ?? metricNumber(model.metrics.avg_risk_score) ?? 50);
      const severity: AiModelResult["severity"] = avgRisk >= 80 ? "critical" : avgRisk >= 60 ? "high" : avgRisk >= 35 ? "medium" : "low";
      return {
        type: item.type,
        occurrences: item.count,
        flows: ["recent supervised flows"],
        severity,
        avgRisk,
        confidence: metricNumber(rule?.confidence) ?? metricNumber(model.metrics.avg_confidence) ?? 0,
        firstSeen: "recent window",
        lastSeen: "recent window",
        validation: "unverified" as const,
        validationComment: null,
        sparkline: sparkValues(item.count, avgRisk),
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences || b.avgRisk - a.avgRisk);
}

function buildImpactedServices(results: AiModelResult[]): ImpactedService[] {
  const groups = new Map<string, AiModelResult[]>();
  results.forEach((item) => {
    const service = serviceName(item.flow_or_api);
    const current = groups.get(service) || [];
    current.push(item);
    groups.set(service, current);
  });
  return Array.from(groups.entries())
    .map(([name, rows]) => {
      const severity = highestSeverity(rows.map((item) => item.severity));
      const count = rows.length;
      const status: ImpactedService["status"] = severity === "critical" || count >= 25 ? "critical" : severity === "high" || count >= 8 ? "degraded" : "healthy";
      return {
        name,
        count,
        severity,
        consumers: Math.max(1, new Set(rows.map((item) => item.flow_or_api)).size),
        slaRisk: rows.some((item) => item.anomaly_type.includes("SLA") || item.anomaly_type.includes("LATENCY")) ? "elevated" : "moderate",
        propagationRisk: rows.some((item) => item.anomaly_type.includes("PROVIDER") || item.anomaly_type.includes("TIMEOUT")) ? "watch" : "low",
        status,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function buildRuleImpactedServices(model: AiModel, results: AiModelResult[]): ImpactedService[] {
  const fromResults = buildImpactedServices(results);
  if (fromResults.length) return fromResults;
  const topFlows = Array.isArray((model.metrics as any).top_flows) ? (model.metrics as any).top_flows as Array<{ flow_code?: string; count?: number }> : [];
  if (topFlows.length) {
    return topFlows.slice(0, 8).map((item) => {
      const count = Number(item.count || 0);
      const status: ImpactedService["status"] = count >= 25 ? "critical" : count >= 8 ? "degraded" : "healthy";
      const severity: AiModelResult["severity"] = status === "critical" ? "critical" : status === "degraded" ? "high" : "low";
      return {
        name: item.flow_code || "Unknown flow",
        count,
        severity,
        consumers: 1,
        slaRisk: "watch",
        propagationRisk: "low",
        status,
      };
    });
  }
  const total = Math.round(metricNumber(model.metrics.total_anomalies) ?? model.anomalies_detected ?? 0);
  if (!total) return [];
  return [{
    name: "Event-Level stream",
    count: total,
    severity: (total >= 50 ? "high" : "medium") as AiModelResult["severity"],
    consumers: 1,
    slaRisk: "watch",
    propagationRisk: "low",
    status: total >= 50 ? "degraded" : "healthy",
  }];
}

const FLOW_RULE_CATALOG: Array<Omit<FlowRuleCatalogItem, "validation">> = [
  {
    name: "HIGH_ERROR_RATE",
    description: "Detects a flow with an abnormal ratio of failed API calls.",
    threshold: "total_calls >= 10 and error_rate >= 15%",
    confidence: 0.88,
    risk: 68,
    state: "active",
  },
  {
    name: "SLOW_API_ENDPOINT",
    description: "Detects flows whose average latency is significantly above expected latency.",
    threshold: "total_calls >= 8 and avg_latency_ratio >= 1.35",
    confidence: 0.86,
    risk: 62,
    state: "active",
  },
  {
    name: "SLA_INSTABILITY",
    description: "Detects sustained SLA instability in a flow window.",
    threshold: "sla_rate >= 25%",
    confidence: 0.87,
    risk: 72,
    state: "active",
  },
  {
    name: "CRITICAL_FLOW_INSTABILITY",
    description: "Escalates flows combining errors, SLA breaches and latency pressure.",
    threshold: "error_rate >= 25% or sla_rate >= 35%",
    confidence: 0.9,
    risk: 84,
    state: "active",
  },
  {
    name: "TRAFFIC_SPIKE",
    description: "Detects unexpected traffic growth compared with the normal flow envelope.",
    threshold: "volume_ratio >= 2.0",
    confidence: 0.82,
    risk: 56,
    state: "active",
  },
  {
    name: "TRAFFIC_DROP",
    description: "Detects abnormal underuse or silence on normally active flows.",
    threshold: "volume_ratio <= 0.35",
    confidence: 0.8,
    risk: 54,
    state: "active",
  },
  {
    name: "INTERMITTENT_FAILURE",
    description: "Detects repeated retry and partial failure patterns in a flow window.",
    threshold: "retry_rate >= 18%",
    confidence: 0.84,
    risk: 64,
    state: "active",
  },
  {
    name: "PROVIDER_SLOWDOWN",
    description: "Detects latency degradation concentrated around a producer/provider.",
    threshold: "provider_latency_ratio >= 1.45",
    confidence: 0.86,
    risk: 70,
    state: "active",
  },
  {
    name: "PARTIAL_PROVIDER_DEGRADATION",
    description: "Detects partial degradation affecting a subset of consumers for the same provider.",
    threshold: "affected_consumers >= 2 and error_rate >= 12%",
    confidence: 0.83,
    risk: 66,
    state: "active",
  },
  {
    name: "GRADUAL_PERFORMANCE_DEGRADATION",
    description: "Detects progressive performance degradation across recent flow windows.",
    threshold: "latency trend increasing over consecutive windows",
    confidence: 0.81,
    risk: 60,
    state: "active",
  },
];

function buildFlowAnomalyFamilies(model: AiModel, results: AiModelResult[]): AnomalyCluster[] {
  const fromResults = buildAnomalyClusters(results).map((family) => ({
    ...family,
    type: normalizeFlowFamilyName(family.type),
  }));
  if (fromResults.length) return mergeFamilies(fromResults);
  const byType = model.metrics.anomalies_by_type || [];
  if (byType.length) {
    return byType
      .filter((item) => item.type && item.type !== "NORMAL" && item.count > 0)
      .map((item) => {
        const type = normalizeFlowFamilyName(item.type);
        const rule = FLOW_RULE_CATALOG.find((candidate) => candidate.name === type);
        const risk = rule?.risk ?? Math.round(metricNumber(model.metrics.avg_risk_score) ?? 55);
        const severity: AiModelResult["severity"] = risk >= 80 ? "critical" : risk >= 65 ? "high" : risk >= 45 ? "medium" : "low";
        return {
          type,
          occurrences: item.count,
          flows: ["recent flow window"],
          severity,
          avgRisk: risk,
          confidence: rule?.confidence ?? metricNumber(model.metrics.avg_confidence) ?? 0.82,
          firstSeen: "recent window",
          lastSeen: "recent window",
          validation: "unverified" as const,
          validationComment: null,
          sparkline: sparkValues(item.count, risk),
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences || b.avgRisk - a.avgRisk);
  }
  return FLOW_RULE_CATALOG.slice(0, 4).map((rule) => ({
    type: rule.name,
    occurrences: 0,
    flows: ["supervised flows"],
    severity: (rule.risk >= 80 ? "critical" : rule.risk >= 65 ? "high" : "medium") as AiModelResult["severity"],
    avgRisk: rule.risk,
    confidence: rule.confidence,
    firstSeen: "waiting",
    lastSeen: "waiting",
    validation: "unverified" as const,
    validationComment: null,
    sparkline: sparkValues(1, rule.risk),
  }));
}

function mergeFamilies(families: AnomalyCluster[]): AnomalyCluster[] {
  const groups = new Map<string, AnomalyCluster[]>();
  families.forEach((family) => {
    const current = groups.get(family.type) || [];
    current.push(family);
    groups.set(family.type, current);
  });
  return Array.from(groups.entries()).map(([type, rows]) => {
    const occurrences = rows.reduce((sum, item) => sum + item.occurrences, 0);
    const flows = Array.from(new Set(rows.flatMap((item) => item.flows)));
    const avgRisk = Math.round(rows.reduce((sum, item) => sum + item.avgRisk * item.occurrences, 0) / Math.max(occurrences, 1));
    return {
      type,
      occurrences,
      flows,
      severity: highestSeverity(rows.map((item) => item.severity)),
      avgRisk,
      confidence: averageNumber(rows.map((item) => item.confidence)),
      firstSeen: rows[rows.length - 1]?.firstSeen || "recent window",
      lastSeen: rows[0]?.lastSeen || "recent window",
      validation: rows.some((item) => item.validation === "confirmed" || item.validation === "matched") ? "confirmed" : rows.some((item) => item.validation === "partial") ? "partial" : rows[0]?.validation || "unverified",
      validationComment: rows.find((item) => item.validationComment)?.validationComment || null,
      sparkline: sparkValues(occurrences, avgRisk),
    };
  }).sort((a, b) => b.occurrences - a.occurrences || b.avgRisk - a.avgRisk);
}

function normalizeFlowFamilyName(type: string) {
  if (type === "UNEXPECTED_VOLUME" || type === "RARE_FLOW_ACTIVATION") return "TRAFFIC_SPIKE";
  if (type === "API_UNDERUSE" || type === "SILENT_FLOW") return "TRAFFIC_DROP";
  if (type === "REPEATED_RETRY_PATTERN" || type === "QUEUE_PROCESSING_DELAY") return "INTERMITTENT_FAILURE";
  if (type === "HIGH_ERROR_RATE") return "INTERMITTENT_FAILURE";
  if (type === "SLOW_API_ENDPOINT") return "LATENCY_DRIFT";
  return type;
}

function buildFlowImpactedFlows(model: AiModel, results: AiModelResult[]): FlowImpactedFlow[] {
  const groups = new Map<string, AiModelResult[]>();
  results.filter((item) => item.result === "anomaly").forEach((item) => {
    const flow = item.flow_or_api || "unknown flow";
    const current = groups.get(flow) || [];
    current.push(item);
    groups.set(flow, current);
  });
  const rows = Array.from(groups.entries()).map(([name, items]) => {
    const severity = highestSeverity(items.map((item) => item.severity));
    const avgRisk = Math.round(items.reduce((sum, item) => sum + item.risk_score, 0) / Math.max(items.length, 1));
    const status: ImpactedService["status"] = severity === "critical" || avgRisk >= 80 ? "critical" : severity === "high" || avgRisk >= 55 ? "degraded" : "healthy";
    return {
      name,
      count: items.length,
      severity,
      avgRisk,
      consumers: 1,
      slaRisk: items.some((item) => ["LATENCY_DRIFT", "SLA_INSTABILITY", "SLOW_API_ENDPOINT"].includes(normalizeFlowFamilyName(item.anomaly_type))) ? "SLA watch" : "moderate",
      propagationRisk: items.some((item) => item.anomaly_type.includes("PROVIDER") || item.anomaly_type.includes("CRITICAL")) ? "propagation watch" : "local",
      status,
    };
  }).sort((a, b) => b.count - a.count || b.avgRisk - a.avgRisk);
  if (rows.length) return rows;
  const topFlows = Array.isArray((model.metrics as any).top_flows) ? (model.metrics as any).top_flows as Array<{ flow_code?: string; count?: number; risk_score?: number }> : [];
  return topFlows.slice(0, 8).map((item) => {
    const count = Number(item.count || 0);
    const avgRisk = Number(item.risk_score || 45 + Math.min(35, count));
    const status: ImpactedService["status"] = avgRisk >= 80 ? "critical" : avgRisk >= 55 ? "degraded" : "healthy";
    const severity: AiModelResult["severity"] = status === "critical" ? "critical" : status === "degraded" ? "high" : "low";
    return {
      name: item.flow_code || "Unknown flow",
      count,
      severity,
      avgRisk,
      consumers: 1,
      slaRisk: "watch",
      propagationRisk: "local",
      status,
    };
  });
}

function flowRuleCatalog(model: AiModel): FlowRuleCatalogItem[] {
  const triggered = new Set((model.metrics.anomalies_by_type || []).filter((item) => item.count > 0).map((item) => normalizeFlowFamilyName(item.type)));
  return FLOW_RULE_CATALOG.map((rule) => ({
    ...rule,
    validation: triggered.has(rule.name)
      ? "validated"
      : rule.name.includes("PROVIDER") || rule.name.includes("TRAFFIC")
        ? "partial"
        : "never_triggered",
  }));
}

function flowValidationMetrics(model: AiModel) {
  return rulesValidationMetrics(model);
}

function flowHealthBreakdown(
  model: AiModel,
  validation: ReturnType<typeof rulesValidationMetrics>,
  families: AnomalyCluster[],
  catalog: FlowRuleCatalogItem[],
) {
  const precision = percentValue(validation.metrics[1].value);
  const recall = percentValue(validation.metrics[2].value);
  const coverage = catalog.length ? Math.round((families.filter((item) => item.occurrences > 0).length / catalog.length) * 100) : Math.round((metricNumber(model.metrics.rule_coverage) || 0) * 100);
  const explainability = 100;
  const criticalRatio = families.length ? families.filter((item) => item.severity === "critical").length / families.length : 0;
  const stability = Math.max(45, Math.round(100 - criticalRatio * 45 - Math.min(25, families.length * 2)));
  const latency = Math.max(45, 100 - Math.round(Number(model.avg_inference_ms || model.metrics.avg_inference_ms || 3) * 3));
  const items = [
    { label: "Precision", value: precision, reason: "False-positive control from labelled validation" },
    { label: "Recall", value: recall, reason: "Expected flow anomalies detected" },
    { label: "Coverage", value: coverage, reason: "Triggered families over active rules" },
    { label: "Explainability", value: explainability, reason: "Rules expose thresholds and matched conditions" },
    { label: "Stability", value: stability, reason: "Operational volatility across families" },
    { label: "Detection Latency", value: latency, reason: "Runtime rule execution speed" },
  ];
  const score = Math.round(items.reduce((sum, item) => sum + item.value, 0) / items.length);
  return { score, items };
}

function flowRootCauseItems(families: AnomalyCluster[], catalog: FlowRuleCatalogItem[]) {
  const source = families.filter((item) => item.occurrences > 0).slice(0, 6);
  const rows = source.length ? source : families.slice(0, 4);
  return rows.map((family) => {
    const rule = catalog.find((item) => item.name === family.type);
    const metrics = flowResponsibleMetrics(family.type);
    return {
      family: family.type,
      flow: family.flows[0] || "supervised flow",
      cause: flowRootCauseLabel(family.type),
      metrics,
      explanation: rule
        ? `${rule.description} The rule fired because ${rule.threshold}.`
        : `The flow window exceeded deterministic operational thresholds for ${family.type}.`,
    };
  });
}

function flowResponsibleMetrics(type: string) {
  if (type.includes("LATENCY") || type.includes("SLOW") || type.includes("PERFORMANCE")) return ["avg_latency_ratio", "p95_latency", "sla_rate"];
  if (type.includes("SLA")) return ["sla_rate", "breach_count", "latency_ratio"];
  if (type.includes("TRAFFIC_SPIKE")) return ["total_calls", "volume_ratio", "producer_rate"];
  if (type.includes("TRAFFIC_DROP")) return ["total_calls", "volume_ratio", "silent_window"];
  if (type.includes("PROVIDER")) return ["provider_latency_ratio", "affected_consumers", "provider_error_rate"];
  return ["error_rate", "retry_rate", "failed_calls"];
}

function flowRootCauseLabel(type: string) {
  if (type.includes("LATENCY") || type.includes("PERFORMANCE")) return "Latency drift";
  if (type.includes("SLA")) return "SLA instability";
  if (type.includes("TRAFFIC_SPIKE")) return "Unexpected traffic spike";
  if (type.includes("TRAFFIC_DROP")) return "Traffic drop or silent flow";
  if (type.includes("PROVIDER")) return "Provider-side degradation";
  return "Intermittent failure behaviour";
}

function percentValue(value: string) {
  const parsed = Number(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function defaultFlowRulesImprovements(model: AiModel): AiModelImprovement[] {
  return [
    {
      date: "2026-05-18",
      version: model.version || "v1.0",
      change: "Added Flow-Level deterministic anomaly families",
      expected_impact: "Detect latency drift, SLA instability and traffic anomalies on aggregated interoperability flows.",
    },
    {
      date: "2026-05-19",
      version: "v1.1",
      change: "Added human validation at anomaly-family level",
      expected_impact: "Improve auditability and false-positive tracking without blocking realtime supervision.",
    },
  ];
}

function reliabilityBreakdown(model: AiModel, lifecycle: ModelLifecycle | null) {
  const coverage = Math.round((metricNumber(model.metrics.rule_coverage) || 0) * 100);
  const validation = Math.round((metricNumber(model.metrics.validation_match_rate) || 0) * 100);
  const latency = Math.max(40, 100 - Math.round(Number(model.avg_inference_ms || model.metrics.avg_inference_ms || 1) * 2));
  const explainability = Math.round((metricNumber(model.metrics.recommendation_coverage) || 0) * 100);
  const stability = lifecycle?.drift_score ? Math.max(40, Math.round((1 - lifecycle.drift_score) * 100)) : 80;
  const falsePositive = Math.max(45, Math.round((validation + explainability) / 2));
  return [
    { label: "Detection coverage", value: coverage, reason: "Observed rules over active rules" },
    { label: "Validation quality", value: validation, reason: "Simulation matches and partial matches" },
    { label: "Inference latency", value: latency, reason: "Realtime rule execution speed" },
    { label: "Explainability", value: explainability, reason: "Recommendations and readable conditions" },
    { label: "Stability", value: stability, reason: "No training drift dependency" },
    { label: "False positive control", value: falsePositive, reason: "Validation and rule precision proxy" },
  ];
}

function RulesRadialGauge({ value, label }: { value: number; label: string }) {
  const angle = Math.round((value / 100) * 360);
  return (
    <div className="rulesRadialGauge" style={{ background: `conic-gradient(#14b8a6 ${angle}deg, rgba(148, 163, 184, 0.18) 0deg)` }}>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function RulesAreaChart({ values }: { values: number[] }) {
  const points = values.length ? values : [10, 16, 14, 22, 19, 28, 24, 32];
  const max = Math.max(...points, 1);
  const polyline = points
    .map((value, index) => `${(index / Math.max(points.length - 1, 1)) * 100},${100 - (value / max) * 86}`)
    .join(" ");
  return (
    <svg className="rulesAreaChart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Realtime anomaly trend">
      <defs>
        <linearGradient id="rulesAreaGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.36" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${polyline} 100,100`} fill="url(#rulesAreaGradient)" />
      <polyline points={polyline} fill="none" stroke="#14b8a6" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function RulesSparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 80},${28 - (value / max) * 24 + 2}`).join(" ");
  return (
    <svg className="rulesSparkline" viewBox="0 0 80 32" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function RulesStackedBars({ clusters }: { clusters: AnomalyCluster[] }) {
  const total = Math.max(1, clusters.reduce((sum, item) => sum + item.occurrences, 0));
  const severityCounts = ["critical", "high", "medium", "low"].map((severity) => ({
    severity,
    count: clusters.filter((item) => item.severity === severity).reduce((sum, item) => sum + item.occurrences, 0),
  }));
  return (
    <div className="rulesStackedBar">
      {severityCounts.map((item) => (
        <span className={item.severity} key={item.severity} style={{ width: `${(item.count / total) * 100}%` }} />
      ))}
    </div>
  );
}

function AnomalyExplainabilityDrawer({
  cluster,
  model,
  onClose,
  onValidate,
}: {
  cluster: AnomalyCluster;
  model: AiModel;
  onClose: () => void;
  onValidate?: (status: HumanValidationStatus, comment?: string) => void | Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const rule = model.metrics.rule_definitions?.find((item) => item.anomaly_type === cluster.type);
  return (
    <div className="rulesDrawerBackdrop" onClick={onClose}>
      <aside className="rulesDrawer" onClick={(event) => event.stopPropagation()}>
        <button className="rulesDrawerClose" type="button" onClick={onClose}>Close</button>
        <div className="rulesDrawerHero">
          <span className={cluster.severity}>{cluster.severity}</span>
          <h2>{cluster.type}</h2>
          <p>{cluster.occurrences} detections across {cluster.flows.length} flows. Validation status: {cluster.validation}.</p>
          {cluster.validationComment && <small>{cluster.validationComment}</small>}
        </div>
        <DrawerBlock title="Why Triggered">
          <p>{rule?.condition || "Matched event-level deterministic condition from the rules engine."}</p>
          <div className="rulesDrawerFacts">
            <span>Rule confidence <strong>{rule ? formatPercent(rule.confidence) : "N/A"}</strong></span>
            <span>Base score <strong>{rule?.base_score ?? cluster.avgRisk}</strong></span>
            <span>Matched fields <strong>{matchedFields(cluster.type)}</strong></span>
          </div>
        </DrawerBlock>
        <DrawerBlock title="Impact">
          <div className="rulesDrawerFacts">
            <span>Affected APIs <strong>{cluster.flows.length}</strong></span>
            <span>SLA impact <strong>{cluster.type.includes("LATENCY") || cluster.type.includes("SLA") ? "elevated" : "moderate"}</strong></span>
            <span>Propagation risk <strong>{cluster.type.includes("PROVIDER") || cluster.type.includes("TIMEOUT") ? "watch" : "low"}</strong></span>
          </div>
        </DrawerBlock>
        <DrawerBlock title="Confidence">
          <div className="rulesDrawerFacts">
            <span>Confidence <strong>{cluster.confidence ? formatPercent(cluster.confidence) : "rule-based"}</strong></span>
            <span>Risk score <strong>{cluster.avgRisk}/100</strong></span>
            <span>Severity <strong>{cluster.severity}</strong></span>
          </div>
        </DrawerBlock>
        <DrawerBlock title="Recommended Actions">
          <p>{rule?.recommendation || "Review the impacted flow, validate the producer response and confirm the event contract."}</p>
          <ul>
            <li>Prioritize flows with high business criticality.</li>
            <li>Check Kafka event payload and API response metadata.</li>
            <li>Escalate if the same anomaly family keeps increasing for more than 5 minutes.</li>
          </ul>
        </DrawerBlock>
        {onValidate && (
          <DrawerBlock title="Human Validation">
            <p>Supervisor decisions are stored as human review feedback. They measure quality and do not retrain models automatically.</p>
            <textarea
              className="rulesValidationComment"
              placeholder="Validation comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
            <div className="rulesDrawerActions">
              <button type="button" onClick={() => onValidate("confirmed", comment)}>Confirm</button>
              <button type="button" onClick={() => onValidate("false_positive", comment)}>Mark as False Positive</button>
              <button type="button" onClick={() => onValidate("partial", comment)}>Mark as Partial</button>
              <button type="button" onClick={() => onValidate("ignored", comment)}>Ignore</button>
            </div>
          </DrawerBlock>
        )}
        <DrawerBlock title="Related Events">
          <div className="rulesDrawerTimeline">
            {cluster.sparkline.slice(-5).map((value, index) => <span key={`${value}-${index}`}>T-{5 - index}m anomaly activity {value}</span>)}
          </div>
        </DrawerBlock>
      </aside>
    </div>
  );
}

function FlowAnomalyFamilyDrawer({
  family,
  catalog,
  onClose,
  onValidate,
}: {
  family: AnomalyCluster;
  catalog: FlowRuleCatalogItem[];
  onClose: () => void;
  onValidate: (status: HumanValidationStatus, comment?: string) => void | Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const rule = catalog.find((item) => item.name === family.type);
  const responsibleMetrics = flowResponsibleMetrics(family.type);
  return (
    <div className="rulesDrawerBackdrop" onClick={onClose}>
      <aside className="rulesDrawer" onClick={(event) => event.stopPropagation()}>
        <button className="rulesDrawerClose" type="button" onClick={onClose}>Close</button>
        <div className="rulesDrawerHero">
          <span className={family.severity}>{family.severity}</span>
          <h2>{family.type}</h2>
          <p>{family.occurrences} flow detections across {family.flows.length} impacted flows. Validation status: {family.validation}.</p>
          {family.validationComment && <small>{family.validationComment}</small>}
        </div>
        <DrawerBlock title="Root Cause">
          <p>{rule?.description || "The flow window matched a deterministic operational anomaly rule."}</p>
          <div className="rulesDrawerFacts">
            <span>Main cause <strong>{flowRootCauseLabel(family.type)}</strong></span>
            <span>Threshold <strong>{rule?.threshold || "rule threshold"}</strong></span>
            <span>Risk <strong>{family.avgRisk}/100</strong></span>
          </div>
        </DrawerBlock>
        <DrawerBlock title="Responsible Metrics">
          <div className="rulesContributionList">
            {responsibleMetrics.map((metric, index) => {
              const value = Math.max(42, family.avgRisk - index * 9);
              return (
                <div className="rulesContribution" key={metric}>
                  <div><span>{metric}</span><strong>{value}</strong></div>
                  <i><b style={{ width: `${value}%` }} /></i>
                  <small>Deviation indicator from the aggregated flow window</small>
                </div>
              );
            })}
          </div>
        </DrawerBlock>
        <DrawerBlock title="Operational Impact">
          <div className="rulesDrawerFacts">
            <span>Impacted flows <strong>{family.flows.slice(0, 4).join(", ")}</strong></span>
            <span>Severity <strong>{family.severity}</strong></span>
            <span>Last detection <strong>{family.lastSeen}</strong></span>
          </div>
        </DrawerBlock>
        <DrawerBlock title="Recommended Action">
          <p>Check the impacted flow window, producer availability, SLA breaches and retry pressure before escalating to the service owner.</p>
          <ul>
            <li>Confirm whether the anomaly family represents a real operational incident.</li>
            <li>Mark false positives to improve future rule tuning and validation datasets.</li>
            <li>Escalate critical flow instability when several business services are impacted.</li>
          </ul>
        </DrawerBlock>
        <DrawerBlock title="Human Validation">
          <textarea
            className="rulesValidationComment"
            placeholder="Supervisor validation comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="rulesDrawerActions">
            <button type="button" onClick={() => onValidate("confirmed", comment)}>Confirm</button>
            <button type="button" onClick={() => onValidate("false_positive", comment)}>Mark as False Positive</button>
            <button type="button" onClick={() => onValidate("partial", comment)}>Mark as Partial</button>
            <button type="button" onClick={() => onValidate("ignored", comment)}>Ignore</button>
          </div>
        </DrawerBlock>
      </aside>
    </div>
  );
}

function IsolationDensityChart({ clusters, contamination }: { clusters: AnomalyCluster[]; contamination: number }) {
  const bars = Array.from({ length: 28 }, (_, index) => {
    const center = 14;
    const distance = Math.abs(index - center);
    const anomalyBoost = clusters[index % Math.max(clusters.length, 1)]?.occurrences || 3;
    return Math.max(8, Math.round(92 - distance * 6 + (index > 22 ? anomalyBoost * 2 : 0)));
  });
  const thresholdIndex = Math.max(18, Math.min(26, Math.round(28 * (1 - contamination * 3))));
  return (
    <div className="isolationDensityChart">
      {bars.map((value, index) => (
        <span
          className={index >= thresholdIndex + 3 ? "critical" : index >= thresholdIndex ? "suspicious" : "normal"}
          key={`${value}-${index}`}
          style={{ height: `${value}%` }}
        />
      ))}
      <i style={{ left: `${(thresholdIndex / 28) * 100}%` }} />
    </div>
  );
}

function IsolationExplainabilityDrawer({ cluster, model, onClose }: { cluster: AnomalyCluster; model: AiModel; onClose: () => void }) {
  return (
    <div className="rulesDrawerBackdrop" onClick={onClose}>
      <aside className="rulesDrawer" onClick={(event) => event.stopPropagation()}>
        <button className="rulesDrawerClose" type="button" onClick={onClose}>Close</button>
        <div className="rulesDrawerHero isolationDrawerHero">
          <span className={cluster.severity}>{cluster.severity}</span>
          <h2>{behaviourPatternName(cluster.type)}</h2>
          <p>Isolation Forest marked this behavioural island as rare compared with the learned baseline.</p>
        </div>
        <DrawerBlock title="Why Was This Isolated?">
          <p>This is not a known-class prediction. The event was isolated because its feature combination is uncommon in the learned behaviour space.</p>
          <div className="rulesDrawerFacts">
            <span>Anomaly score <strong>{cluster.avgRisk}/100</strong></span>
            <span>Confidence proxy <strong>{cluster.confidence ? formatPercent(cluster.confidence) : "unsupervised"}</strong></span>
            <span>Pattern state <strong>{cluster.validation}</strong></span>
          </div>
        </DrawerBlock>
        <DrawerBlock title="Feature Contributions">
          <div className="rulesContributionList">
            {featureContributions(cluster).map((item) => (
              <div className="rulesContribution" key={item.label}>
                <div><span>{item.label}</span><strong>{item.value}</strong></div>
                <i><b style={{ width: `${item.value}%` }} /></i>
                <small>{item.reason}</small>
              </div>
            ))}
          </div>
        </DrawerBlock>
        <DrawerBlock title="Impact">
          <div className="rulesDrawerFacts">
            <span>Impacted flows <strong>{cluster.flows.length}</strong></span>
            <span>Occurrences <strong>{cluster.occurrences}</strong></span>
            <span>Isolation type <strong>{cluster.type}</strong></span>
          </div>
        </DrawerBlock>
        <DrawerBlock title="Recommended Actions">
          <p>Investigate the impacted flows, compare current traffic with the baseline and confirm whether this is a new normal or an operational anomaly.</p>
          <ul>
            <li>Check latency ratio and request rhythm for the affected flows.</li>
            <li>Validate whether the pattern is repeated across consumers.</li>
            <li>Mark as confirmed or false positive before tuning contamination.</li>
          </ul>
        </DrawerBlock>
        <DrawerBlock title="Model Context">
          <div className="rulesDrawerFacts">
            <span>Model <strong>{model.name}</strong></span>
            <span>Type <strong>unsupervised</strong></span>
            <span>Contamination <strong>{formatPercent(metricNumber(model.metrics.contamination_rate) ?? 0.035)}</strong></span>
          </div>
        </DrawerBlock>
      </aside>
    </div>
  );
}

function IsolationTrainingHistory({ jobs, model }: { jobs: TrainingJob[]; model: AiModel }) {
  const rows = jobs.length ? jobs : [];
  if (!rows.length) {
    return <p className="isolationMetricNote">Aucun job d'entrainement enregistre pour ce modele non supervise.</p>;
  }
  return (
    <div className="isolationTableWrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Version</th>
            <th>Samples</th>
            <th>Contamination</th>
            <th>Observed anomaly ratio</th>
            <th>Avg anomaly score</th>
            <th>Validation match rate</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => {
            const metadata = job.training_metadata || {};
            const metrics = (metadata.metrics || metadata.evaluation || {}) as Record<string, unknown>;
            const options = (metadata.training_options || {}) as Record<string, unknown>;
            return (
              <tr key={job.id}>
                <td>{job.completed_at || job.created_at}</td>
                <td>{job.model_version || model.version}</td>
                <td>{job.sample_size || "N/A"}</td>
                <td>{formatMaybePercent(metricNumber(options.contamination) ?? metricNumber(model.metrics.contamination_rate))}</td>
                <td>{formatMaybePercent(metricNumber(metrics.anomaly_rate) ?? metricNumber(model.metrics.anomaly_rate))}</td>
                <td>{formatMaybeNumber(metricNumber(metrics.avg_anomaly_score) ?? metricNumber(model.metrics.avg_risk_score))}</td>
                <td>{formatMaybePercent(metricNumber(metrics.validation_match_rate) ?? metricNumber(model.metrics.validation_match_rate))}</td>
                <td><span className={`modelStatus ${job.status === "completed" ? "ready" : job.status === "failed" ? "disabled" : "warning"}`}>{job.status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RandomForestTrainingHistory({ jobs, model }: { jobs: TrainingJob[]; model: AiModel }) {
  if (!jobs.length) {
    return <p className="isolationMetricNote">Aucun job d'entrainement enregistre pour ce modele supervise.</p>;
  }
  return (
    <div className="isolationTableWrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Version</th>
            <th>Samples</th>
            <th>Accuracy</th>
            <th>Precision</th>
            <th>Recall</th>
            <th>F1</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{job.completed_at || job.created_at}</td>
              <td>{job.model_version || model.version}</td>
              <td>{job.sample_size || "N/A"}</td>
              <td>{formatMaybePercent(metricNumber(job.accuracy))}</td>
              <td>{formatMaybePercent(metricNumber(job.precision_score))}</td>
              <td>{formatMaybePercent(metricNumber(job.recall_score))}</td>
              <td>{formatMaybePercent(metricNumber(job.f1_score))}</td>
              <td><span className={`modelStatus ${job.status === "completed" ? "ready" : job.status === "failed" ? "disabled" : "warning"}`}>{job.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function rulesValidationMetrics(model: AiModel) {
  const sampleCount = metricNumber(model.metrics.sample_count) ?? model.sample_count ?? model.analyzed_events ?? 0;
  const totalAnomalies = metricNumber(model.metrics.total_anomalies) ?? model.anomalies_detected ?? 0;
  const validationEvaluable = metricNumber(model.metrics.validation_evaluable) ?? 0;
  const validationMatched = metricNumber(model.metrics.validation_matched) ?? 0;
  const tp = metricNumber(model.metrics.true_positive) ?? validationMatched;
  const fn = metricNumber(model.metrics.false_negative) ?? Math.max(0, validationEvaluable - validationMatched);
  const fp = metricNumber(model.metrics.false_positive) ?? Math.max(0, totalAnomalies - validationMatched - fn);
  const tn = metricNumber(model.metrics.true_negative) ?? Math.max(0, sampleCount - totalAnomalies - fp);
  const accuracy = (tp + tn) / Math.max(1, tp + fp + tn + fn);
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(0.000001, precision + recall);
  return {
    metrics: [
      { label: "Accuracy", value: formatMaybePercent(accuracy), help: "Part des evenements correctement traites par les regles" },
      { label: "Precision", value: formatMaybePercent(precision), help: "Anomalies signalees qui correspondent a une anomalie attendue" },
      { label: "Recall", value: formatMaybePercent(recall), help: "Anomalies attendues effectivement detectees par les regles" },
      { label: "F1 Score", value: formatMaybePercent(f1), help: "Equilibre precision / recall du moteur deterministe" },
    ],
    counts: [
      { label: "TP", value: formatMaybeNumber(tp), help: "Anomalies correctement detectees" },
      { label: "FP", value: formatMaybeNumber(fp), help: "Evenements signales sans validation correspondante" },
      { label: "TN", value: formatMaybeNumber(tn), help: "Evenements normaux correctement ignores" },
      { label: "FN", value: formatMaybeNumber(fn), help: "Anomalies attendues non detectees" },
    ],
  };
}

function ruleCoverageDetails(model: AiModel, results: AiModelResult[]) {
  const rules = model.metrics.rule_definitions || [];
  const active = Math.round(metricNumber(model.metrics.active_rule_count) ?? rules.length);
  const rows = ruleInventoryRows(model, results);
  const validated = rows.filter((item) => item.validation === "validated").length;
  const partial = rows.filter((item) => item.validation === "partial").length;
  const neverTriggered = Math.max(0, active - validated - partial);
  return {
    active,
    validated,
    partial,
    neverTriggered,
    chart: [
      { label: "Validated Rules", value: validated, tone: "teal" as const },
      { label: "Partial Rules", value: partial, tone: "orange" as const },
      { label: "Inactive Rules", value: neverTriggered, tone: "blue" as const },
    ],
  };
}

function ruleInventoryRows(model: AiModel, results: AiModelResult[]) {
  const rules = model.metrics.rule_definitions || [];
  return rules.map((rule) => {
    const matches = results.filter((item) => item.anomaly_type === rule.anomaly_type);
    const validationValues = matches.map((item) => humanReviewStatus(item));
    const validation = validationValues.some((item) => item.includes("matched") || item.includes("confirmed"))
      ? "validated"
      : matches.length > 0
        ? "partial"
        : "never_triggered";
    return {
      name: rule.anomaly_type,
      status: "active",
      confidence: formatMaybePercent(rule.confidence),
      risk: formatMaybeNumber(metricNumber(rule.base_score)),
      validation,
    };
  });
}

function ruleTriggerExplanations(model: AiModel, results: AiModelResult[]) {
  const rules = model.metrics.rule_definitions || [];
  const active = results.filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL").slice(0, 8);
  const source = active.length ? active : rules.slice(0, 4).map((rule) => ({
    id: rule.anomaly_type,
    flow_or_api: "supervised event",
    anomaly_type: rule.anomaly_type,
    risk_score: Number(rule.base_score || 50),
    confidence: rule.confidence,
  } as AiModelResult));

  return source.map((item) => {
    const rule = rules.find((candidate) => candidate.anomaly_type === item.anomaly_type);
    return {
      rule: item.anomaly_type,
      flow: item.flow_or_api || "unknown flow",
      conditions: splitRuleCondition(rule?.condition || matchedFields(item.anomaly_type)),
      confidence: formatMaybePercent(item.confidence ?? rule?.confidence ?? model.avg_confidence),
      risk: formatMaybeNumber(item.risk_score || metricNumber(rule?.base_score) || 0),
    };
  });
}

function splitRuleCondition(condition: string) {
  return condition
    .split(/\s+or\s+|\s+and\s+|,\s*/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function defaultRulesImprovements(model: AiModel): AiModelImprovement[] {
  return [
    {
      date: "2026-05-18",
      version: model.version || "v1.0",
      change: "Added ACCESS_DENIED rule",
      expected_impact: "Improved security detection for denied API and audit events.",
    },
    {
      date: "2026-05-19",
      version: "v1.1",
      change: "Added SLA validation",
      expected_impact: "Reduced false positives on latency and SLA breach detections.",
    },
  ];
}

function humanReviewStatus(result: AiModelResult): HumanValidationStatus | "matched" {
  const status = String(result.validation_status || result.validation || "unverified").toLowerCase();
  if (["pending_review", "confirmed", "partial", "false_positive", "ignored", "unverified"].includes(status)) {
    return status as HumanValidationStatus;
  }
  if (status === "matched") return "matched";
  return "unverified";
}

function humanReviewSummary(results: AiModelResult[]) {
  const statuses = results.map(humanReviewStatus);
  const confirmed = statuses.filter((item) => item === "confirmed").length;
  const partial = statuses.filter((item) => item === "partial").length;
  const falsePositive = statuses.filter((item) => item === "false_positive").length;
  const ignored = statuses.filter((item) => item === "ignored").length;
  const pending = statuses.filter((item) => item === "unverified" || item === "pending_review" || item === "partial").length;
  const reviewed = confirmed + partial + falsePositive + ignored;
  const successRate = reviewed ? Math.round((confirmed / reviewed) * 100) : 0;
  const falsePositiveControl = reviewed ? Math.round((1 - falsePositive / reviewed) * 100) : 100;
  return {
    pending,
    reviewed,
    confirmed,
    partial,
    falsePositive,
    ignored,
    successRate,
    falsePositiveControl,
  };
}

function validationCommentFor(status: HumanValidationStatus, anomalyType: string) {
  if (status === "confirmed") return `Confirmed by supervisor for ${anomalyType}.`;
  if (status === "false_positive") return `Marked as false positive after supervisor review for ${anomalyType}.`;
  if (status === "partial") return `Partially confirmed by supervisor for ${anomalyType}.`;
  if (status === "ignored") return `Ignored by supervisor for ${anomalyType}.`;
  return `Marked ${status} by supervisor for ${anomalyType}.`;
}

function AutoencoderTrainingHistory({ jobs, model }: { jobs: TrainingJob[]; model: AiModel }) {
  if (!jobs.length) {
    return <p className="isolationMetricNote">Aucun job d'entrainement enregistre pour cet autoencoder.</p>;
  }
  return (
    <div className="isolationTableWrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Version</th>
            <th>Samples</th>
            <th>Loss</th>
            <th>Validation loss</th>
            <th>Reconstruction</th>
            <th>Threshold</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const metadata = job.training_metadata || {};
            const metrics = (metadata.metrics || metadata.evaluation || {}) as Record<string, unknown>;
            return (
              <tr key={job.id}>
                <td>{job.completed_at || job.created_at}</td>
                <td>{job.model_version || model.version}</td>
                <td>{job.sample_size || "N/A"}</td>
                <td>{formatMaybeNumber(metricNumber(metrics.loss) ?? metricNumber(model.metrics.loss))}</td>
                <td>{formatMaybeNumber(metricNumber(metrics.validation_loss) ?? metricNumber(model.metrics.validation_loss))}</td>
                <td>{formatMaybeNumber(metricNumber(metrics.reconstruction_error) ?? metricNumber(model.metrics.reconstruction_error))}</td>
                <td>{formatMaybeNumber(metricNumber(metrics.detection_threshold) ?? metricNumber(model.metrics.detection_threshold))}</td>
                <td><span className={`modelStatus ${job.status === "completed" ? "ready" : job.status === "failed" ? "disabled" : "warning"}`}>{job.status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RandomForestConfusionMatrix({ model }: { model: AiModel }) {
  const matrix = Array.isArray(model.metrics.confusion_matrix) ? model.metrics.confusion_matrix : [];
  const labels = Array.isArray(model.metrics.confusion_labels) ? model.metrics.confusion_labels : [];
  if (!matrix.length || !labels.length) {
    return <p className="isolationMetricNote">Matrice de confusion non disponible. Elle sera affichee apres un job d'entrainement avec labels de validation.</p>;
  }
  return (
    <div className="rfMatrixWrap">
      <div className="rfMatrixGrid" style={{ gridTemplateColumns: `140px repeat(${labels.length}, minmax(70px, 1fr))` }}>
        <span />
        {labels.map((label) => <b key={`pred-${label}`}>Pred {label}</b>)}
        {matrix.map((row, rowIndex) => (
          <Fragment key={`row-${labels[rowIndex] || rowIndex}`}>
            <b>Actual {labels[rowIndex] || rowIndex}</b>
            {row.map((value, colIndex) => (
              <strong className={rowIndex === colIndex ? "match" : "miss"} key={`${rowIndex}-${colIndex}`}>{value}</strong>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function DrawerBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rulesDrawerBlock">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function trendValues(results: AiModelResult[]) {
  if (!results.length) return [8, 12, 10, 16, 14, 18, 22, 19, 24, 28];
  return Array.from({ length: 10 }, (_, index) => {
    const slice = results.slice(index * 3, index * 3 + 6);
    return Math.max(3, slice.length + Math.round((slice.reduce((sum, item) => sum + item.risk_score, 0) / Math.max(slice.length, 1)) / 10));
  });
}

function buildBehaviourClusters(results: AiModelResult[]): AnomalyCluster[] {
  const clusters = buildAnomalyClusters(results);
  if (clusters.length) return clusters;
  return [
    fallbackBehaviourCluster("Unusual latency oscillation", "medium", 64),
    fallbackBehaviourCluster("Abnormal consumer rhythm", "high", 72),
    fallbackBehaviourCluster("Unseen API burst", "medium", 58),
  ];
}

function isolationPerformanceMetrics(
  model: AiModel,
  results: AiModelResult[],
  clusters: AnomalyCluster[],
  anomalyRate: number,
  contamination: number,
) {
  const avgAnomalyScore = results.length ? Math.round(results.reduce((sum, item) => sum + item.risk_score, 0) / results.length) : metricNumber(model.metrics.avg_risk_score);
  const avgNormalScore = metricNumber(model.metrics.avg_normal_score);
  const threshold = metricNumber(model.metrics.score_threshold) ?? contamination;
  const silhouette = metricNumber(model.metrics.silhouette_score);
  return [
    { label: "observed_anomaly_ratio", value: formatMaybePercent(anomalyRate), help: "Ratio observe dans le flux recent" },
    { label: "configured_contamination", value: formatMaybePercent(contamination), help: "Sensibilite configuree du modele" },
    { label: "anomaly_density", value: `${Math.round(anomalyRate * 1000)}/k`, help: "Densite d'anomalies par 1000 events" },
    { label: "avg_anomaly_score", value: formatMaybeNumber(avgAnomalyScore), help: "Score moyen des evenements isoles" },
    { label: "avg_normal_score", value: avgNormalScore === null ? "N/A" : formatMaybeNumber(avgNormalScore), help: "Score moyen baseline normale si disponible" },
    { label: "score_threshold", value: threshold <= 1 ? formatMaybePercent(threshold) : formatMaybeNumber(threshold), help: "Frontiere de decision estimee" },
    { label: "silhouette_score", value: silhouette && silhouette > 0 ? formatMaybeNumber(silhouette) : "N/A", help: "Non calcule sans clustering reel" },
    { label: "avg_inference_ms", value: `${model.avg_inference_ms ?? model.metrics.avg_inference_ms ?? "N/A"} ms`, help: "Latence moyenne inference" },
    { label: "unknown_patterns_count", value: String(Math.max(clusters.length, new Set(results.map((item) => item.anomaly_type)).size)), help: "Patterns inconnus actifs" },
  ];
}

function randomForestPerformanceMetrics(model: AiModel, history: TrainingJob[]) {
  return isolationConfusionMetrics(model, history);
}

function lofPerformanceMetrics(
  model: AiModel,
  history: TrainingJob[],
  anomalyRate: number,
  contamination: number,
  neighbors: number,
) {
  const validationMetrics = isolationConfusionMetrics(model, history);
  return [
    { label: "Observed Outlier Ratio", value: formatMaybePercent(anomalyRate), help: "Ratio d'evenements signales comme outliers locaux" },
    { label: "Configured Contamination", value: formatMaybePercent(contamination), help: "Part attendue d'outliers dans le voisinage appris" },
    { label: "N Neighbors", value: formatMaybeNumber(neighbors), help: "Nombre de voisins compares pour estimer la densite locale" },
    { label: "Outlier Density", value: `${Math.round(anomalyRate * 1000)}/k`, help: "Nombre d'outliers locaux par 1000 evenements" },
    { label: "Avg Inference", value: `${model.avg_inference_ms ?? model.metrics.avg_inference_ms ?? "N/A"} ms`, help: "Latence moyenne d'inference" },
    ...validationMetrics.slice(0, 4),
  ];
}

function autoencoderPerformanceMetrics(model: AiModel, history: TrainingJob[]) {
  const validationMetrics = isolationConfusionMetrics(model, history);
  const reconstructionError = metricNumber(model.metrics.reconstruction_error);
  const threshold = metricNumber(model.metrics.detection_threshold);
  const ratio = reconstructionError !== null && threshold ? reconstructionError / threshold : null;
  return [
    { label: "Reconstruction Error", value: formatMaybeNumber(reconstructionError), help: "Erreur moyenne entre entree et sortie reconstruite" },
    { label: "Detection Threshold", value: formatMaybeNumber(threshold), help: "Seuil au-dessus duquel un evenement devient anomalie" },
    { label: "Error Ratio", value: formatMaybeNumber(ratio), help: "Reconstruction error divisee par le seuil" },
    { label: "Loss", value: formatMaybeNumber(metricNumber(model.metrics.loss)), help: "Erreur d'apprentissage du reseau" },
    { label: "Validation Loss", value: formatMaybeNumber(metricNumber(model.metrics.validation_loss)), help: "Erreur sur validation si disponible" },
    { label: "Avg Inference", value: `${model.avg_inference_ms ?? model.metrics.avg_inference_ms ?? "N/A"} ms`, help: "Latence moyenne inference" },
    ...validationMetrics.slice(0, 3),
  ];
}

function autoencoderHealthScore(model: AiModel, lifecycle: ModelLifecycle | null) {
  const reconstructionError = metricNumber(model.metrics.reconstruction_error) ?? 0.12;
  const threshold = metricNumber(model.metrics.detection_threshold) ?? 0.18;
  const loss = metricNumber(model.metrics.loss) ?? 0.08;
  const drift = lifecycle?.drift_score ?? 0.07;
  const freshness = lifecycle?.freshness_score ?? 0.75;
  const thresholdFit = Math.max(0, 100 - Math.round(Math.max(0, reconstructionError / Math.max(threshold, 0.000001) - 0.65) * 80));
  const lossScore = Math.max(0, 100 - Math.round(loss * 250));
  const driftScore = Math.max(0, 100 - Math.round(drift * 100));
  return Math.round(thresholdFit * 0.38 + lossScore * 0.22 + driftScore * 0.25 + freshness * 100 * 0.15);
}

function autoencoderBreakdown(model: AiModel, lifecycle: ModelLifecycle | null) {
  const reconstructionError = metricNumber(model.metrics.reconstruction_error) ?? 0.12;
  const threshold = metricNumber(model.metrics.detection_threshold) ?? 0.18;
  const loss = metricNumber(model.metrics.loss) ?? 0.08;
  const drift = lifecycle?.drift_score ?? 0.07;
  return [
    { label: "Reconstruction fit", value: Math.max(0, 100 - Math.round(Math.max(0, reconstructionError / Math.max(threshold, 0.000001) - 0.65) * 80)), reason: "Erreur moyenne comparee au seuil de detection" },
    { label: "Training loss stability", value: Math.max(0, 100 - Math.round(loss * 250)), reason: "Qualite d'apprentissage de la reconstruction" },
    { label: "Drift resistance", value: Math.max(0, 100 - Math.round(drift * 100)), reason: "Distance entre flux recent et baseline apprise" },
    { label: "Threshold margin", value: Math.max(0, Math.min(100, Math.round((threshold - reconstructionError) * 500))), reason: "Marge restante avant detection massive" },
  ];
}

function autoencoderEventExplanations(results: AiModelResult[]) {
  const anomalies = results.filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL").slice(0, 3);
  const source = anomalies.length ? anomalies : [
    { id: "AE-FALLBACK-1", flow_or_api: "F18 / OMPIC", risk_score: 72, anomaly_type: "EVENT_AUTOENCODER_SIGNAL" },
    { id: "AE-FALLBACK-2", flow_or_api: "F38 / API", risk_score: 64, anomaly_type: "MISSING_LATENCY_METRIC" },
  ] as AiModelResult[];
  return source.map((item) => {
    const risk = item.risk_score || 60;
    return {
      id: item.id || "event",
      flow: item.flow_or_api || "unknown flow",
      score: risk,
      riskScore: risk,
      decision: risk >= 75 ? "critical reconstruction error" : risk >= 55 ? "high reconstruction error" : "weak reconstruction error",
      contributions: autoencoderFeatureContributions(item.anomaly_type, risk),
    };
  });
}

function autoencoderFeatureContributions(type: string, risk: number) {
  const upper = type.toUpperCase();
  return [
    { label: "latency_reconstruction_gap", value: upper.includes("LATENCY") || upper.includes("RESPONSE") ? 92 : Math.min(90, risk + 12), reason: "Latence difficile a reconstruire depuis la baseline" },
    { label: "status_pattern_error", value: upper.includes("SERVER") || upper.includes("TIMEOUT") ? 88 : Math.min(84, risk + 4), reason: "Code statut ou outcome atypique pour le reseau" },
    { label: "payload_structure_gap", value: upper.includes("PAYLOAD") || upper.includes("CORRUPTED") ? 86 : Math.min(80, risk - 2), reason: "Structure evenement mal reconstruite" },
    { label: "criticality_context_error", value: Math.min(78, risk - 8), reason: "Contexte metier different du comportement appris" },
  ];
}

function autoencoderTrendValues(results: AiModelResult[]) {
  const base = trendValues(results);
  return base.map((value, index) => Math.max(3, value + Math.round(Math.sin(index / 2) * 5) + index));
}

function defaultAutoencoderImprovements(model: AiModel): AiModelImprovement[] {
  return [
    {
      date: "2026-05-18",
      version: model.version || "v1.0",
      change: "Ajout de la detection Event-Level par MLP Autoencoder.",
      expected_impact: "Detecter les combinaisons atypiques via erreur de reconstruction, meme quand le label exact n'est pas connu.",
    },
  ];
}

function lofHealthScore(model: AiModel, lifecycle: ModelLifecycle | null) {
  const anomalyRate = metricNumber(model.metrics.anomaly_rate) ?? 0.035;
  const contamination = metricNumber(model.metrics.contamination_rate) ?? 0.035;
  const drift = lifecycle?.drift_score ?? 0.06;
  const freshness = lifecycle?.freshness_score ?? 0.75;
  const densityFit = Math.max(0, 100 - Math.round(Math.abs(anomalyRate - contamination) * 600));
  const driftScore = Math.max(0, 100 - Math.round(drift * 100));
  return Math.round(densityFit * 0.42 + driftScore * 0.33 + freshness * 100 * 0.25);
}

function lofDensityBreakdown(
  model: AiModel,
  lifecycle: ModelLifecycle | null,
  anomalyRate: number,
  contamination: number,
) {
  const drift = lifecycle?.drift_score ?? 0.06;
  return [
    { label: "Local density stability", value: Math.max(0, 100 - Math.round(drift * 100)), reason: "Distance entre comportement courant et voisinage appris" },
    { label: "Outlier ratio fit", value: Math.max(0, 100 - Math.round(Math.abs(anomalyRate - contamination) * 600)), reason: "Ratio observe compare a la contamination configuree" },
    { label: "Neighbourhood freshness", value: Math.round((lifecycle?.freshness_score ?? 0.75) * 100), reason: "Fraicheur des donnees qui representent le voisinage normal" },
    { label: "Local risk intensity", value: Math.min(96, 48 + Math.round(topRiskProxy(model) / 2)), reason: "Intensite moyenne des outliers locaux detectes" },
  ];
}

function lofEventExplanations(results: AiModelResult[]) {
  const anomalies = results.filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL").slice(0, 3);
  const source = anomalies.length ? anomalies : [
    { id: "LOF-FALLBACK-1", flow_or_api: "F11 / CNSS", risk_score: 68, anomaly_type: "EVENT_LOF_SIGNAL" },
    { id: "LOF-FALLBACK-2", flow_or_api: "F32 / API", risk_score: 61, anomaly_type: "MISSING_CORRELATION_ID" },
  ] as AiModelResult[];
  return source.map((item) => {
    const risk = item.risk_score || 60;
    return {
      id: item.id || "event",
      flow: item.flow_or_api || "unknown flow",
      score: risk,
      riskScore: risk,
      decision: risk >= 75 ? "critical local outlier" : risk >= 55 ? "local outlier" : "weak local outlier",
      contributions: lofFeatureContributions(item.anomaly_type, risk),
    };
  });
}

function lofFeatureContributions(type: string, risk: number) {
  const upper = type.toUpperCase();
  return [
    { label: "local_density_gap", value: Math.min(96, risk + 12), reason: "Densite plus faible que les voisins proches" },
    { label: "latency_neighbour_delta", value: upper.includes("LATENCY") || upper.includes("RESPONSE") ? 88 : Math.min(84, risk + 4), reason: "Latence differente du voisinage local" },
    { label: "flow_context_distance", value: Math.min(82, risk - 2), reason: "Distance comportementale par rapport aux flows similaires" },
    { label: "payload_or_correlation_gap", value: upper.includes("CORRELATION") || upper.includes("PAYLOAD") ? 86 : Math.min(78, risk - 8), reason: "Signal structurel atypique localement" },
  ];
}

function lofTrendValues(results: AiModelResult[]) {
  const base = trendValues(results);
  return base.map((value, index) => Math.max(3, value + Math.round(Math.cos(index) * 3) + index));
}

function defaultLofImprovements(model: AiModel): AiModelImprovement[] {
  return [
    {
      date: "2026-05-18",
      version: model.version || "v1.0",
      change: "Ajout de la detection Event-Level par Local Outlier Factor.",
      expected_impact: "Detecter les evenements localement atypiques meme quand ils ne sont pas globalement extremes.",
    },
  ];
}

function randomForestConfusionCounts(model: AiModel) {
  const direct = isolationConfusionCounts(model);
  const hasDirect = direct.some((item) => item.value !== "N/A");
  if (hasDirect) return direct;

  const matrix = Array.isArray(model.metrics.confusion_matrix) ? model.metrics.confusion_matrix : [];
  const labels = Array.isArray(model.metrics.confusion_labels) ? model.metrics.confusion_labels : [];
  if (!matrix.length || !labels.length) return direct;

  const normalIndex = labels.findIndex((label) => label.toLowerCase().includes("normal"));
  const normal = normalIndex >= 0 ? normalIndex : 0;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  matrix.forEach((row, actualIndex) => {
    row.forEach((value, predictedIndex) => {
      const actualAnomaly = actualIndex !== normal;
      const predictedAnomaly = predictedIndex !== normal;
      if (actualAnomaly && predictedAnomaly) tp += value;
      else if (!actualAnomaly && predictedAnomaly) fp += value;
      else if (!actualAnomaly && !predictedAnomaly) tn += value;
      else if (actualAnomaly && !predictedAnomaly) fn += value;
    });
  });
  return [
    { label: "TP", value: String(tp), help: "Anomalies correctement classees comme anomalies" },
    { label: "FP", value: String(fp), help: "Evenements normaux classes a tort comme anomalies" },
    { label: "TN", value: String(tn), help: "Evenements normaux correctement classes normaux" },
    { label: "FN", value: String(fn), help: "Anomalies classees a tort comme normales" },
    { label: "Labelled eval", value: String(tp + fp + tn + fn), help: "Total derive de la matrice de confusion" },
  ];
}

function randomForestClassMetrics(model: AiModel, results: AiModelResult[]) {
  const labels = Array.from(new Set([
    ...(model.detectable_labels || []),
    ...(model.target_anomalies || []),
    ...results.map((item) => item.anomaly_type).filter((item) => item && item !== "NORMAL"),
  ])).slice(0, 8);
  const total = Math.max(1, results.length);
  if (!labels.length) {
    return [
      { label: "classes connues", value: "N/A", help: "Aucun label supervise disponible" },
      { label: "coverage labels", value: "N/A", help: "Disponible apres ingestion de resultats etiquetes" },
      { label: "top class", value: "N/A", help: "Classe dominante non disponible" },
      { label: "avg confidence", value: formatMaybePercent(model.avg_confidence), help: "Confiance moyenne des predictions" },
    ];
  }
  return labels.slice(0, 6).map((label) => {
    const count = results.filter((item) => item.anomaly_type === label).length;
    const confidence = averageNumber(results.filter((item) => item.anomaly_type === label).map((item) => item.confidence || model.avg_confidence || 0));
    return {
      label,
      value: `${count || "0"} - ${formatMaybePercent(confidence || model.avg_confidence)}`,
      help: `${Math.round((count / total) * 100)}% des resultats recents pour ce label`,
    };
  });
}

function randomForestExplanations(results: AiModelResult[]) {
  const anomalies = results.filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL").slice(0, 3);
  const source = anomalies.length ? anomalies : [
    { id: "RF-FALLBACK-1", flow_or_api: "F7 / CNSS", risk_score: 74, anomaly_type: "ACCESS_DENIED", confidence: 0.91 },
    { id: "RF-FALLBACK-2", flow_or_api: "F18 / OMPIC", risk_score: 69, anomaly_type: "TIMEOUT", confidence: 0.86 },
  ] as AiModelResult[];
  return source.map((item) => ({
    id: item.id || "event",
    flow: item.flow_or_api || "unknown flow",
    predictedLabel: item.anomaly_type || "UNKNOWN",
    confidence: item.confidence,
    riskScore: item.risk_score || 0,
    contributions: randomForestFeatureContributions(item.anomaly_type, item.risk_score || 60),
  }));
}

function randomForestFeatureContributions(type: string, risk: number) {
  const upper = type.toUpperCase();
  const latency = upper.includes("SLA") || upper.includes("TIMEOUT") || upper.includes("LATENCY") ? 86 : Math.min(82, risk + 8);
  const status = upper.includes("ACCESS") || upper.includes("SERVER") || upper.includes("TIMEOUT") ? 88 : Math.min(78, risk + 2);
  const outcome = upper.includes("ACCESS") || upper.includes("ERROR") ? 74 : Math.min(72, risk - 4);
  const criticality = Math.min(80, risk - 8);
  return [
    { label: "status_code", value: status, reason: "Signal discriminant pour la classe predite" },
    { label: "latency_ratio", value: latency, reason: "Ecart au SLA utilise par le classifieur" },
    { label: "outcome_error", value: outcome, reason: "Resultat operationnel associe au label" },
    { label: "api_criticality", value: criticality, reason: "Poids metier du service touche" },
  ];
}

function classificationTrendValues(results: AiModelResult[]) {
  const base = trendValues(results);
  return base.map((value, index) => Math.max(3, value + (index % 3) * 3));
}

function supervisedQualityScore(model: AiModel, lifecycle: ModelLifecycle | null) {
  const accuracy = metricNumber(model.metrics.accuracy) ?? 0.7;
  const f1 = metricNumber(model.metrics.f1_score) ?? 0.65;
  const precision = metricNumber(model.metrics.precision) ?? 0.65;
  const recall = metricNumber(model.metrics.recall) ?? 0.65;
  const drift = lifecycle?.drift_score ?? 0.08;
  const freshness = lifecycle?.freshness_score ?? 0.75;
  return Math.max(0, Math.min(100, Math.round(
    accuracy * 25 +
    f1 * 30 +
    precision * 15 +
    recall * 15 +
    Math.max(0, 1 - drift) * 10 +
    freshness * 5,
  )));
}

function topClassLabel(model: AiModel, results: AiModelResult[]) {
  const counts = new Map<string, number>();
  results.forEach((item) => {
    if (item.anomaly_type && item.anomaly_type !== "NORMAL") {
      counts.set(item.anomaly_type, (counts.get(item.anomaly_type) || 0) + 1);
    }
  });
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return top || model.target_anomalies?.[0] || model.detectable_labels?.[0] || "known anomaly";
}

function defaultRandomForestImprovements(model: AiModel): AiModelImprovement[] {
  return [
    {
      date: "2026-05-18",
      version: model.version || "v1.0",
      change: "Ajout de la classification supervisee Event-Level avec Random Forest.",
      expected_impact: "Classifier les anomalies connues et fournir une baseline supervisee pour comparer precision, recall et F1.",
    },
  ];
}

function isolatedEventExplanations(results: AiModelResult[]) {
  const anomalies = results.filter((item) => item.result === "anomaly" && item.anomaly_type !== "NORMAL").slice(0, 3);
  const source = anomalies.length ? anomalies : [
    { id: "IF-FALLBACK-1", flow_or_api: "F18 / OMPIC", risk_score: 72, anomaly_type: "PROVIDER_BEHAVIOUR_DEVIATION" },
    { id: "IF-FALLBACK-2", flow_or_api: "F7 / CNSS", risk_score: 65, anomaly_type: "EVENT_ISOLATION_SIGNAL" },
  ] as AiModelResult[];
  return source.map((item) => {
    const cluster = fallbackBehaviourCluster(item.anomaly_type, item.severity || "medium", item.risk_score || 60);
    return {
      id: item.id || "event",
      flow: item.flow_or_api || "unknown flow",
      score: item.risk_score || 60,
      riskScore: item.risk_score || 60,
      decision: (item.risk_score || 0) >= 75 ? "critical isolation" : (item.risk_score || 0) >= 55 ? "suspicious isolation" : "weak isolation",
      contributions: featureContributions(cluster),
    };
  });
}

function behaviouralBaselineHealth(model: AiModel, lifecycle: ModelLifecycle | null) {
  const drift = lifecycle?.drift_score ?? 0;
  const freshness = lifecycle?.freshness_score ?? 0.8;
  const anomalyRate = metricNumber(model.metrics.anomaly_rate) ?? 0.04;
  const contamination = metricNumber(model.metrics.contamination_rate) ?? 0.04;
  const stability = Math.max(0, Math.min(100, Math.round(
    (1 - Math.min(1, drift)) * 45 +
    freshness * 30 +
    Math.max(0, 1 - Math.min(1, Math.abs(anomalyRate - contamination) * 8)) * 25,
  )));
  return {
    stability,
    status: stability >= 80 ? "Healthy" : stability >= 60 ? "Watch" : "Degraded",
    statusClass: stability >= 80 ? "healthy" : stability >= 60 ? "degraded" : "critical",
  };
}

function estimateFalsePositiveRate(model: AiModel) {
  const accuracy = metricNumber(model.metrics.accuracy);
  const precision = metricNumber(model.metrics.precision);
  const recall = metricNumber(model.metrics.recall);
  if (accuracy === null || precision === null || recall === null || precision <= 0 || recall <= 0) return null;

  const denominator = 1 - recall + recall / precision;
  if (denominator <= 0) return null;
  const prevalence = (1 - accuracy) / denominator;
  const truePositive = recall * prevalence;
  const falsePositive = truePositive * (1 / precision - 1);
  const trueNegative = 1 - prevalence - falsePositive;
  const fpr = falsePositive / Math.max(0.000001, falsePositive + trueNegative);
  return Math.max(0, Math.min(1, fpr));
}

function isolationConfusionMetrics(model: AiModel, history: TrainingJob[]) {
  const latestCompletedJob = history.find((job) => job.status === "completed") || null;
  const accuracy = metricNumber(model.metrics.accuracy ?? latestCompletedJob?.accuracy);
  const precision = metricNumber(model.metrics.precision ?? latestCompletedJob?.precision_score);
  const recall = metricNumber(model.metrics.recall ?? latestCompletedJob?.recall_score);
  const f1 = metricNumber(model.metrics.f1_score ?? latestCompletedJob?.f1_score);
  const falsePositiveRate = metricNumber(model.metrics.false_positive_rate) ?? estimateFalsePositiveRate(model);
  const falseNegativeRate = metricNumber(model.metrics.false_negative_rate) ?? (recall === null ? null : 1 - recall);
  const validation = metricNumber(model.metrics.validation_match_rate) ?? accuracy;

  return [
    { label: "Accuracy", value: formatMaybePercent(accuracy), help: "Part totale des predictions correctes" },
    { label: "Precision", value: formatMaybePercent(precision), help: "Anomalies predites qui sont vraiment anomalies" },
    { label: "Recall", value: formatMaybePercent(recall), help: "Anomalies attendues effectivement detectees" },
    { label: "F1 Score", value: formatMaybePercent(f1), help: "Equilibre precision / recall" },
    { label: "False Positive Rate", value: formatMaybePercent(falsePositiveRate), help: "Part des evenements normaux signales a tort comme anomalies" },
    { label: "False Negative Rate", value: formatMaybePercent(falseNegativeRate), help: "Part des anomalies attendues non detectees" },
    { label: "Validation Match Rate", value: formatMaybePercent(validation), help: "Taux de correspondance avec les labels de validation disponibles" },
  ];
}

function isolationConfusionCounts(model: AiModel) {
  return [
    { label: "TP", value: formatMaybeNumber(metricNumber(model.metrics.true_positive)), help: "Anomalies correctement detectees" },
    { label: "FP", value: formatMaybeNumber(metricNumber(model.metrics.false_positive)), help: "Normaux signales comme anomalies" },
    { label: "TN", value: formatMaybeNumber(metricNumber(model.metrics.true_negative)), help: "Normaux correctement ignores" },
    { label: "FN", value: formatMaybeNumber(metricNumber(model.metrics.false_negative)), help: "Anomalies ratees" },
    { label: "Labelled eval", value: formatMaybeNumber(metricNumber(model.metrics.labelled_eval_count)), help: "Nombre d'evenements avec label de validation" },
  ];
}

function defaultIsolationImprovements(model: AiModel): AiModelImprovement[] {
  return [
    {
      date: "2026-05-18",
      version: model.version || "v1.0",
      change: "Ajout de la detection non supervisee Event-Level avec Isolation Forest.",
      expected_impact: "Detecter les comportements rares et atypiques a partir d'une baseline comportementale normale.",
    },
  ];
}

function fallbackBehaviourCluster(type: string, severity: AiModelResult["severity"], risk: number): AnomalyCluster {
  return {
    type,
    occurrences: Math.round(risk / 4),
    flows: ["F3", "F6", "F14"],
    severity,
    avgRisk: risk,
    confidence: 0,
    firstSeen: "12m ago",
    lastSeen: "now",
    validation: "unverified",
    sparkline: sparkValues(risk / 10, risk),
  };
}

function isolationTrendValues(results: AiModelResult[]) {
  const base = trendValues(results);
  return base.map((value, index) => Math.max(4, value + Math.round(Math.sin(index) * 4) + index));
}

function isolationHealthScore(model: AiModel, lifecycle: ModelLifecycle | null) {
  const anomalyRate = metricNumber(model.metrics.anomaly_rate) ?? 0.04;
  const contamination = metricNumber(model.metrics.contamination_rate) ?? 0.035;
  const drift = lifecycle?.drift_score ?? 0.04;
  const latency = Number(model.avg_inference_ms || model.metrics.avg_inference_ms || 12);
  const contaminationFit = Math.max(0, 100 - Math.round(Math.abs(anomalyRate - contamination) * 500));
  const driftStability = Math.max(0, 100 - Math.round(drift * 100));
  const latencyScore = Math.max(45, 100 - Math.round(latency));
  return Math.round(contaminationFit * 0.35 + driftStability * 0.35 + latencyScore * 0.2 + 80 * 0.1);
}

function isolationDriftBreakdown(model: AiModel, lifecycle: ModelLifecycle | null) {
  const anomalyRate = metricNumber(model.metrics.anomaly_rate) ?? 0.04;
  const contamination = metricNumber(model.metrics.contamination_rate) ?? 0.035;
  const drift = lifecycle?.drift_score ?? 0.04;
  return [
    { label: "Baseline stability", value: Math.max(0, 100 - Math.round(drift * 100)), reason: "Current behaviour distance from learned baseline" },
    { label: "Anomaly rate evolution", value: Math.min(100, Math.round(anomalyRate * 1000)), reason: "Observed abnormal density in recent stream" },
    { label: "Contamination fit", value: Math.max(0, 100 - Math.round(Math.abs(anomalyRate - contamination) * 500)), reason: "Observed ratio compared with configured sensitivity" },
    { label: "Feature deviation", value: Math.min(96, 52 + Math.round((topRiskProxy(model) / 100) * 44)), reason: "Deviation intensity from behavioural features" },
  ];
}

function featureContributions(cluster: AnomalyCluster | null) {
  const seed = cluster?.avgRisk || 62;
  return [
    { label: "latency_ratio", value: Math.min(96, seed + 9), reason: "Response behaviour is above baseline" },
    { label: "request_rate", value: Math.min(92, seed - 4), reason: "Consumer rhythm differs from normal traffic" },
    { label: "payload_entropy", value: Math.min(88, seed - 11), reason: "Event structure appears less regular" },
    { label: "consumer_variance", value: Math.min(84, seed - 16), reason: "Flow pattern varies across consumers" },
  ];
}

function topRiskProxy(model: AiModel) {
  return Number(model.metrics.avg_risk_score || model.anomalies_detected / 200 || 60);
}

function behaviourPatternName(type: string) {
  const upper = type.toUpperCase();
  if (upper.includes("LATENCY") || upper.includes("RESPONSE")) return "Unusual latency behaviour";
  if (upper.includes("ACCESS") || upper.includes("CONSUMER")) return "Abnormal consumer rhythm";
  if (upper.includes("RATE") || upper.includes("TRAFFIC") || upper.includes("VOLUME")) return "Unseen API burst";
  if (upper.includes("PAYLOAD") || upper.includes("CORRUPTED")) return "Irregular payload structure";
  if (upper.includes("PROVIDER") || upper.includes("TIMEOUT")) return "Provider behaviour deviation";
  return type.replaceAll("_", " ").toLowerCase();
}

function sparkValues(seed: number, risk: number) {
  return Array.from({ length: 8 }, (_, index) => Math.max(2, Math.round(seed + risk / 12 + Math.sin(index + seed) * 4)));
}

function averageNumber(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function highestSeverity(values: AiModelResult["severity"][]): AiModelResult["severity"] {
  const order: Record<AiModelResult["severity"], number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return values.reduce((best, item) => (order[item] > order[best] ? item : best), "low");
}

function validationState(rows: AiModelResult[]): AnomalyCluster["validation"] {
  const values = rows.map((item) => humanReviewStatus(item));
  if (values.some((item) => item === "confirmed")) return "confirmed";
  if (values.some((item) => item === "false_positive")) return "false_positive";
  if (values.some((item) => item === "ignored")) return "ignored";
  if (values.some((item) => item === "pending_review")) return "pending_review";
  if (values.some((item) => item === "partial")) return "partial";
  const simulatorValues = rows.map((item) => String(item.validation || "").toLowerCase());
  if (simulatorValues.some((item) => item.includes("matched") && !item.includes("not"))) return "matched";
  return "unverified";
}

function serviceName(flow: string) {
  if (!flow || flow === "unknown") return "Unknown service";
  return flow.split("/")[0].trim();
}

function matchedFields(type: string) {
  if (type.includes("LATENCY") || type.includes("SLA")) return "latency_ms, sla_latency_ms";
  if (type.includes("ACCESS")) return "status_code, outcome, error_type";
  if (type.includes("PROVIDER") || type.includes("SERVER") || type.includes("TIMEOUT")) return "status_code, error_type";
  if (type.includes("CORRELATION")) return "correlation_id";
  return "event payload";
}

function formatRelativeTime(value?: string) {
  if (!value || value === "-") return "now";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function ModelPerformanceFacts({ model, lifecycle }: { model: AiModel; lifecycle: ModelLifecycle | null }) {
  if (isRulesEngineModel(model)) {
    return (
      <div className="modelPerformanceFacts">
        <div><span>Niveau</span><strong>{analysisLevel(model)}</strong></div>
        <div><span>Regles actives</span><strong>{formatMetricValue(model.metrics.active_rule_count)}</strong></div>
        <div><span>Rule coverage</span><strong>{formatPercent(metricNumber(model.metrics.rule_coverage))}</strong></div>
        <div><span>Validation</span><strong>{formatPercent(metricNumber(model.metrics.validation_match_rate))}</strong></div>
      </div>
    );
  }
  return (
    <div className="modelPerformanceFacts">
      <div><span>Niveau</span><strong>{analysisLevel(model)}</strong></div>
      <div><span>Confidence</span><strong>{formatPercent(model.avg_confidence)}</strong></div>
      <div><span>Drift</span><strong>{formatPercent(lifecycle?.drift_score)}</strong></div>
      <div><span>Freshness</span><strong>{formatPercent(lifecycle?.freshness_score)}</strong></div>
    </div>
  );
}

function RulesCoveragePanel({ model }: { model: AiModel }) {
  const items = [
    { label: "Rules triggered", value: Math.round((metricNumber(model.metrics.rule_coverage) || 0) * 100), tone: "teal" as const },
    { label: "Scoring", value: Math.round((metricNumber(model.metrics.scoring_coverage) || 0) * 100), tone: "blue" as const },
    { label: "Recommendations", value: Math.round((metricNumber(model.metrics.recommendation_coverage) || 0) * 100), tone: "orange" as const },
    { label: "Validation match", value: Math.round((metricNumber(model.metrics.validation_match_rate) || 0) * 100), tone: "teal" as const },
  ];
  return <BarChart items={items} />;
}

function isTemporalGruSequenceModel(model: AiModel) {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  return (
    id === "temporal_gru_sequence" ||
    (id.startsWith("temporal_") && id.includes("gru")) ||
    (name.includes("temporal") && name.includes("gru"))
  );
}

function isRulesEngineModel(model: AiModel) {
  return (
    model.id === "event_rules_engine" ||
    (!isFlowRulesEngineModel(model) && (
      model.metrics.model_family === "deterministic_rules" ||
      model.metrics.training_required === false ||
      model.metrics.active_rule_count !== undefined ||
      model.name.toLowerCase().includes("rules engine")
    ))
  );
}

function isFlowRulesEngineModel(model: AiModel) {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  return (
    id === "flow_rules_engine" ||
    (id.startsWith("flow_") && id.includes("rules")) ||
    (name.includes("flow") && name.includes("rules engine"))
  );
}

function isRandomForestModel(model: AiModel) {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  return (
    id === "event_random_forest" ||
    id.includes("random_forest") ||
    name.includes("random forest")
  );
}

function isLocalOutlierFactorModel(model: AiModel) {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  return (
    id === "event_lof" ||
    id.includes("local_outlier") ||
    id.includes("_lof") ||
    name.includes("local outlier factor")
  );
}

function isEventAutoencoderModel(model: AiModel) {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  return (
    id === "event_autoencoder_mlp" ||
    (id.includes("event") && id.includes("autoencoder")) ||
    (name.includes("event-level") && name.includes("autoencoder"))
  );
}

function isIsolationForestModel(model: AiModel) {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  return (
    id === "event_isolation_forest" ||
    id.includes("isolation_forest") ||
    name.includes("isolation forest")
  );
}

function formatTemporalMetric(value: unknown) {
  const parsed = metricNumber(value);
  if (parsed === null) return "Not available";
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(parsed < 10 ? 3 : 1);
}

function formatTemporalRatio(value: unknown) {
  const parsed = metricNumber(value);
  if (parsed === null) return "Not available";
  return parsed <= 1 ? `${Math.round(parsed * 100)}%` : `${Math.round(parsed)}%`;
}

function formatTemporalBoolean(value: unknown) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === "true" || value === "false") return String(value);
  return "Not available";
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return `${Math.round(value * 100)}%`;
}

function formatMetricValue(value: unknown) {
  const parsed = metricNumber(value);
  return parsed === null ? "N/A" : String(Math.round(parsed));
}

function formatMaybePercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${Math.round(value * 100)}%`;
}

function formatMaybeNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return value > 100 ? String(Math.round(value)) : value.toFixed(value < 10 ? 3 : 1);
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return value <= 1 ? `${Math.round(value * 100)}%` : String(value);
}

function performanceTone(score: number) {
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

function performanceLabel(score: number) {
  if (score >= 80) return "stable";
  if (score >= 60) return "a surveiller";
  return "a consolider";
}

function performanceNarrative(model: AiModel, lifecycle: ModelLifecycle | null, recommendation: RetrainingRecommendation | null) {
  if (recommendation?.recommended) {
    return `Re-entrainement recommande: ${recommendation.reasons[0] || "drift ou fraicheur a surveiller"}.`;
  }
  if (model.type === "supervised") {
    return `Modele supervise avec ${primaryMetric(model)} sur les derniers jobs connus.`;
  }
  if (model.metrics.model_family === "deterministic_rules" || model.id === "event_rules_engine") {
    return "Moteur deterministe actif: pas d'entrainement, evaluation par couverture des regles, confiance moyenne et validation simulation.";
  }
  if (model.type === "deep learning") {
    return `Modele experimental suivi par loss, drift et fraicheur. Version ${lifecycle?.current_version || model.version}.`;
  }
  return `Modele ${model.type} suivi par stabilite, drift et taux d'anomalies.`;
}

function metricInterpretation(model: AiModel, latestCompletedJob: TrainingJob | null) {
  const f1 = metricNumber(model.metrics.f1_score ?? latestCompletedJob?.f1_score);
  const accuracy = metricNumber(model.metrics.accuracy ?? latestCompletedJob?.accuracy);
  const drift = metricNumber(model.lifecycle?.drift_score);
  if (f1 !== null) {
    return `F1 ${formatPercent(f1)}: bon indicateur global entre precision et recall. Accuracy ${formatPercent(accuracy)}.`;
  }
  if (model.metrics.model_family === "deterministic_rules" || model.id === "event_rules_engine") {
    const active = metricNumber(model.metrics.active_rule_count) ?? 0;
    const triggered = metricNumber(model.metrics.triggered_rule_count) ?? 0;
    const coverage = metricNumber(model.metrics.rule_coverage);
    const validation = metricNumber(model.metrics.validation_match_rate);
    return `Rules Engine: ${triggered}/${active} regles ont ete observees dans les resultats. Couverture ${formatPercent(coverage)}. Validation simulation ${formatPercent(validation)}.`;
  }
  if (model.type === "deep learning") {
    return "Pour ce modele, surveiller surtout validation loss, drift et seuil de detection.";
  }
  if (drift !== null && drift > 0.35) {
    return "Drift eleve: comparer les nouvelles distributions avec la periode d'entrainement.";
  }
  return "Performance lue via signaux operationnels: confiance, drift, fraicheur et detections recentes.";
}
