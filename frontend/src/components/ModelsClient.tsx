"use client";

import { useEffect, useMemo, useState } from "react";
import { AiModelInfo, fetchAiModel, fetchAiModels } from "@/lib/api";
import { BarChart } from "./BarChart";

export function ModelsClient() {
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [selected, setSelected] = useState<AiModelInfo | null>(null);
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [objective, setObjective] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAiModels();
        setModels(data);
        if (!selected && data.length > 0) {
          setSelected(await fetchAiModel(data[0].id));
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de chargement");
      }
    }

    load();
  }, [selected]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const objectiveNeedle = objective.trim().toLowerCase();
    return models.filter((model) => {
      const matchesStatus = status === "all" || model.status === status;
      const matchesType = type === "all" || model.type === type;
      const matchesObjective = !objectiveNeedle || model.objective.toLowerCase().includes(objectiveNeedle);
      const matchesQuery = !needle || model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle);
      return matchesStatus && matchesType && matchesObjective && matchesQuery;
    });
  }, [models, objective, query, status, type]);

  async function openModel(id: string) {
    setSelected(await fetchAiModel(id));
  }

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>Modeles IA</h1>
          <p>Catalogue des modeles ML/DL utilises pour la supervision intelligente GISRE.</p>
        </div>
        <span className="statusPill">{filtered.length} modeles</span>
      </div>

      {error && <div className="errorBox">Impossible de charger les modeles: {error}</div>}

      <section className="alertToolbar">
        <input className="input" placeholder="Rechercher par nom" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">Tous statuts</option>
          <option value="entraine">Entraine</option>
          <option value="actif">Actif</option>
          <option value="experimental">Experimental</option>
          <option value="desactive">Desactive</option>
        </select>
        <select className="select" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="all">Tous types</option>
          <option value="supervise">Supervise</option>
          <option value="non supervise">Non supervise</option>
          <option value="deep learning">Deep learning</option>
          <option value="statistique">Statistique</option>
        </select>
        <input className="input" placeholder="Filtrer par objectif" value={objective} onChange={(event) => setObjective(event.target.value)} />
      </section>

      <section className="modelsLayout">
        <div className="modelCards">
          {filtered.map((model) => (
            <button className={`modelCard ${selected?.id === model.id ? "selected" : ""}`} key={model.id} onClick={() => openModel(model.id)}>
              <div className="modelCardTop">
                <strong>{model.name}</strong>
                <span className={`modelStatus ${statusClass(model.status)}`}>{model.status}</span>
              </div>
              <p>{model.objective}</p>
              <div className="modelMeta">
                <span>{model.type}</span>
                <span>v{model.version}</span>
                <span>{model.sample_count || "-"} samples</span>
              </div>
              <div className="modelLabels">
                {model.detectable_labels.slice(0, 4).map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <div className="card modelDetail">
          <div className="cardHeader">
            <h2>{selected?.name || "Detail modele"}</h2>
            {selected && <span className={`modelStatus ${statusClass(selected.status)}`}>{selected.status}</span>}
          </div>
          <div className="cardBody">{selected ? <ModelDetail model={selected} /> : <p className="muted">Selectionne un modele.</p>}</div>
        </div>
      </section>
    </>
  );
}

function ModelDetail({ model }: { model: AiModelInfo }) {
  const metricItems = metricBars(model);
  const topTypes = arrayMetric(model.metrics.top_anomaly_types).map((item) => ({
    label: String(item.detected_anomaly_type),
    value: Number(item.count),
    tone: "blue" as const,
  }));
  const topFlows = arrayMetric(model.metrics.top_flows).map((item) => ({
    label: String(item.flow_code),
    value: Number(item.count),
    tone: "teal" as const,
  }));

  return (
    <div className="modelDetailBody">
      <section>
        <h3>Informations generales</h3>
        <div className="kv"><span>Version</span><strong>{model.version}</strong></div>
        <div className="kv"><span>Type</span><span>{model.type}</span></div>
        <div className="kv"><span>Developpe le</span><span>{model.developed_at}</span></div>
        <div className="kv"><span>Dernier entrainement</span><span>{model.last_training_at || "Non disponible"}</span></div>
        <div className="kv"><span>Derniere amelioration</span><span>{model.last_improvement_at}</span></div>
        <p className="muted">{model.description}</p>
        <p>{model.use_case}</p>
      </section>

      <section>
        <h3>Donnees utilisees</h3>
        <div className="modelTags">{(model.data_sources || []).map((item) => <span key={item}>{item}</span>)}</div>
        <p className="muted">{model.training_period}</p>
        <div className="modelLabels featureList">{(model.features || []).map((item) => <span key={item}>{item}</span>)}</div>
      </section>

      <section>
        <h3>Metriques de performance</h3>
        <BarChart items={metricItems} />
      </section>

      <section className="modelTwoCols">
        <div>
          <h3>Types detectes</h3>
          <BarChart items={topTypes.length ? topTypes : [{ label: "Aucun resultat recent", value: 0, tone: "blue" }]} />
        </div>
        <div>
          <h3>Flows concernes</h3>
          <BarChart items={topFlows.length ? topFlows : [{ label: "Aucun flow recent", value: 0, tone: "teal" }]} />
        </div>
      </section>

      <section>
        <h3>Historique des ameliorations</h3>
        <div className="timeline">
          {(model.improvements || []).map((item) => (
            <div className="timelineItem" key={`${item.date}-${item.modification}`}>
              <strong>{item.date}</strong>
              <span>{item.modification}</span>
              <small>{item.impact}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="modelActions">
        <button className="button">Voir resultats recents</button>
        <button className="button">Voir metriques detaillees</button>
        <button className="button">Comparer avec autre modele</button>
        <button className="button primary">Exporter rapport modele</button>
      </section>
    </div>
  );
}

function statusClass(status: string) {
  if (status === "entraine" || status === "actif") return "ready";
  if (status === "experimental") return "warning";
  return "disabled";
}

function arrayMetric(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function metricBars(model: AiModelInfo) {
  const metrics = model.metrics || {};
  if (model.type === "supervise") {
    return ["accuracy", "precision", "recall", "f1_score"].map((key) => ({
      label: key,
      value: Math.round(Number(metrics[key] || 0) * 100),
      tone: "blue" as const,
    }));
  }
  if (model.type === "deep learning") {
    return ["loss", "validation_loss", "reconstruction_error", "detection_threshold"].map((key) => ({
      label: key,
      value: Math.round(Number(metrics[key] || 0) * 100),
      tone: "orange" as const,
    }));
  }
  return [
    { label: "anomaly_rate", value: Math.round(Number(metrics.anomaly_rate || 0) * 100), tone: "teal" as const },
    { label: "contamination_rate", value: Math.round(Number(metrics.contamination_rate || 0) * 100), tone: "teal" as const },
    { label: "detected_anomalies", value: Number(metrics.detected_anomalies || metrics.total_anomalies || 0), tone: "teal" as const },
  ];
}
