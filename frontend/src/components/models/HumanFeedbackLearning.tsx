"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getFeedbackDatasetSummary,
  prepareFeedbackTraining,
} from "@/lib/api/ai-models";
import type {
  AiModel,
  FeedbackDatasetSummary,
  FeedbackTrainingReadiness,
} from "@/types/ai-models";

const EMPTY_SUMMARY: FeedbackDatasetSummary = {
  total_validated: 0,
  usable_for_training: 0,
  confirmed_anomalies: 0,
  false_positives: 0,
  excluded_pending: 0,
  label_distribution: { anomaly: 0, normal: 0 },
  by_model: [],
  by_anomaly_type: [],
};

export function HumanFeedbackLearning({ models }: { models: AiModel[] }) {
  const [summary, setSummary] = useState<FeedbackDatasetSummary>(EMPTY_SUMMARY);
  const [reports, setReports] = useState<Record<string, FeedbackTrainingReadiness>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modelNames = useMemo(
    () => new Map(models.map((model) => [model.id, model.name])),
    [models],
  );

  const load = useCallback(async () => {
    try {
      setSummary(await getFeedbackDatasetSummary());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Human feedback dataset unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function prepare(modelId: string) {
    setBusy(modelId);
    setError(null);
    try {
      const report = await prepareFeedbackTraining(modelId);
      setReports((current) => ({ ...current, [modelId]: report }));
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "Readiness report unavailable");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="card cardBody">Chargement du feedback humain...</div>;
  }

  return (
    <section className="feedbackLearningConsole">
      <header className="feedbackLearningIntro">
        <div>
          <span>Supervised feedback dataset</span>
          <h2>Learning from Human Validation</h2>
          <p>
            Human validations are used to build a labeled dataset for future supervised
            retraining. Models are not retrained automatically.
          </p>
        </div>
        <strong>{summary.usable_for_training} usable samples</strong>
      </header>

      {error && <div className="errorBox">Feedback dataset unavailable: {error}</div>}

      <div className="feedbackSummaryGrid">
        <Metric label="Total validations" value={summary.total_validated} />
        <Metric label="Usable for training" value={summary.usable_for_training} />
        <Metric label="Confirmed anomalies" value={summary.confirmed_anomalies} />
        <Metric label="False positives / normal" value={summary.false_positives} />
        <Metric label="Excluded pending" value={summary.excluded_pending} />
      </div>

      <article className="card feedbackModelDataset">
        <div className="cardHeader">
          <div>
            <span className="sectionEyebrow">Dataset readiness</span>
            <h2>Validated samples by model</h2>
          </div>
          <span className="statusPill">{summary.by_model.length} models represented</span>
        </div>
        <div className="cardBody tableWrap">
          {summary.by_model.length === 0 ? (
            <p className="feedbackEmpty">
              No usable human validation is available yet. Pending and unverified results are excluded.
            </p>
          ) : (
            <table className="table feedbackModelTable">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Level</th>
                  <th>Usable</th>
                  <th>Anomaly</th>
                  <th>Normal</th>
                  <th>Acceptance</th>
                </tr>
              </thead>
              <tbody>
                {summary.by_model.map((item) => (
                  <tr key={`${item.analysis_level}:${item.model_id}`}>
                    <td>
                      <strong>{modelNames.get(item.model_id) || item.model_id}</strong>
                      <small>{item.model_id}</small>
                    </td>
                    <td>{item.analysis_level}</td>
                    <td>{item.usable_samples}</td>
                    <td>{item.anomaly_labels}</td>
                    <td>{item.normal_labels}</td>
                    <td>{formatPercent(item.validation_acceptance_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>

      <article className="card feedbackModelDataset">
        <div className="cardHeader">
          <div>
            <span className="sectionEyebrow">Manual preparation only</span>
            <h2>Training readiness</h2>
          </div>
          <span className="statusPill">{models.length} registered models</span>
        </div>
        <div className="cardBody tableWrap">
          <table className="table feedbackReadinessTable">
            <thead>
              <tr>
                <th>Model</th>
                <th>Type</th>
                <th>Usable / minimum</th>
                <th>Label distribution</th>
                <th>Readiness</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const report = reports[model.id];
                return (
                  <tr key={model.id}>
                    <td><strong>{model.name}</strong><small>{model.id}</small></td>
                    <td>{model.type}</td>
                    <td>{report ? `${report.usable_samples} / ${report.min_required_samples}` : "Not checked"}</td>
                    <td>
                      {report
                        ? `${report.label_distribution.anomaly} anomaly / ${report.label_distribution.normal} normal`
                        : "Not available"}
                    </td>
                    <td>
                      {!report ? (
                        <span className="feedbackReadiness unchecked">Not checked</span>
                      ) : (
                        <div>
                          <span className={`feedbackReadiness ${report.ready ? "ready" : "waiting"}`}>
                            {report.ready ? "Ready" : report.trainable ? "Not ready" : "Calibration only"}
                          </span>
                          <small>{report.message}</small>
                          {report.warnings.map((warning) => <small key={warning}>{warning}</small>)}
                        </div>
                      )}
                    </td>
                    <td>
                      <button
                        className="feedbackPrepareButton"
                        disabled={busy !== null}
                        type="button"
                        onClick={() => prepare(model.id)}
                      >
                        {busy === model.id ? "Preparing..." : "Prepare feedback training"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card feedbackAnomalySummary">
        <div className="cardHeader">
          <div>
            <span className="sectionEyebrow">Validated labels</span>
            <h2>Feedback by anomaly type</h2>
          </div>
        </div>
        <div className="cardBody feedbackAnomalyGrid">
          {summary.by_anomaly_type.length ? summary.by_anomaly_type.slice(0, 12).map((item) => (
            <div key={item.anomaly_type}>
              <span>{item.anomaly_type}</span>
              <strong>{item.count}</strong>
            </div>
          )) : <p className="feedbackEmpty">No validated anomaly label available.</p>}
        </div>
      </article>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
