"use client";

import { useEffect, useState } from "react";
import { getTrainingHistory } from "@/lib/api/ai-models";
import type { AiModel, TrainingJob } from "@/types/ai-models";

export function ModelsTrainingHistory({ models }: { models: AiModel[] }) {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      const histories = await Promise.all(models.map((model) => getTrainingHistory(model.id)));
      if (!active) return;
      setJobs(
        histories
          .flat()
          .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
      );
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [models]);

  if (loading) return <div className="card cardBody">Chargement de l&apos;historique...</div>;
  if (!jobs.length) return <div className="card cardBody">Aucun entrainement enregistre.</div>;

  return (
    <section className="card modelGlobalHistory">
      <div className="cardHeader">
        <div>
          <span className="sectionEyebrow">MLOps lifecycle</span>
          <h2>Training History</h2>
        </div>
        <strong>{jobs.length} jobs</strong>
      </div>
      <div className="cardBody tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Model</th>
              <th>Level</th>
              <th>Version</th>
              <th>Samples</th>
              <th>F1</th>
              <th>Drift</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{formatDate(job.completed_at || job.created_at)}</td>
                <td className="typeCell">{job.model_id}</td>
                <td>{job.analysis_level || "n/a"}</td>
                <td>{job.model_version || "n/a"}</td>
                <td>{job.sample_size ?? "n/a"}</td>
                <td>{formatMetric(job.f1_score)}</td>
                <td>{formatMetric(job.drift_score)}</td>
                <td><span className={`modelStatus ${statusClass(job.status)}`}>{job.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("fr-FR");
}

function formatMetric(value: number | null) {
  return value === null ? "n/a" : value.toFixed(3);
}

function statusClass(status: string) {
  if (status === "completed") return "ready";
  if (status === "failed") return "disabled";
  return "warning";
}
