"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getModelActivationPolicy,
  updateModelActivationPolicy,
} from "@/lib/api/ai-models";
import type {
  ActivationPolicyLevel,
  AnalysisLevel,
  ModelActivationPolicy,
} from "@/types/ai-models";

const LEVELS: Array<{ id: AnalysisLevel; label: string; description: string }> = [
  { id: "event", label: "Event-Level", description: "Decision immediate sur chaque evenement Kafka." },
  { id: "flow", label: "Flow-Level", description: "Analyse agregee du comportement des flows." },
  { id: "temporal", label: "Temporal-Level", description: "Analyse des sequences et tendances temporelles." },
  { id: "graph", label: "Graph-Level", description: "Analyse des dependances et propagations." },
];

export function ModelActivationConfiguration() {
  const [policy, setPolicy] = useState<ModelActivationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPolicy(await getModelActivationPolicy());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Activation policy unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patchLevel(
    level: AnalysisLevel,
    body: { active_model_id?: string | null; enabled_models?: Record<string, boolean> },
    confirmation: string,
  ) {
    setBusy(`${level}:${body.active_model_id ?? Object.keys(body.enabled_models || {})[0] ?? "level"}`);
    setMessage(null);
    setError(null);
    try {
      await updateModelActivationPolicy(level, body);
      await load();
      setMessage(confirmation);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Policy update failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="card cardBody">Chargement de la politique d&apos;activation...</div>;
  }

  return (
    <section className="modelPolicyConsole">
      <div className="modelPolicyIntro">
        <div>
          <span>Production model routing</span>
          <h2>Configuration des modeles actifs</h2>
          <p>Un seul modele prend la decision en production pour chaque niveau. Les changements concernent uniquement les nouvelles analyses.</p>
        </div>
        <strong>Policy persistee dans /app/models</strong>
      </div>

      {message && <div className="successBox">{message}</div>}
      {error && <div className="errorBox">Impossible de mettre a jour la configuration : {error}</div>}

      <div className="modelPolicyLevels">
        {LEVELS.map(({ id, label, description }) => (
          <PolicyLevelCard
            busy={busy}
            description={description}
            key={id}
            label={label}
            level={policy?.[id]}
            onDisableLevel={() => patchLevel(id, { active_model_id: null }, `${label} desactive pour les nouvelles analyses.`)}
            onSetActive={(modelId, modelName) => patchLevel(
              id,
              { active_model_id: modelId },
              `${modelName} est maintenant le modele actif ${label}.`,
            )}
            onToggle={(modelId, enabled, modelName) => patchLevel(
              id,
              { enabled_models: { [modelId]: enabled } },
              `${modelName} est maintenant ${enabled ? "enabled" : "disabled"}.`,
            )}
          />
        ))}
      </div>
    </section>
  );
}

function PolicyLevelCard({
  level,
  label,
  description,
  busy,
  onSetActive,
  onToggle,
  onDisableLevel,
}: {
  level: ActivationPolicyLevel | undefined;
  label: string;
  description: string;
  busy: string | null;
  onSetActive: (modelId: string, modelName: string) => void;
  onToggle: (modelId: string, enabled: boolean, modelName: string) => void;
  onDisableLevel: () => void;
}) {
  const active = level?.models.find((model) => model.active);
  return (
    <article className="modelPolicyLevel">
      <header>
        <div>
          <span>{label}</span>
          <h3>{active?.model_name || "No active model configured"}</h3>
          <p>{description}</p>
        </div>
        <div className="modelPolicyHeaderActions">
          <span className={`modelPolicyAvailability ${active ? "available" : "unavailable"}`}>
            {active ? "ACTIVE" : "UNAVAILABLE"}
          </span>
          {active && (
            <button disabled={busy !== null} type="button" onClick={onDisableLevel}>
              Disable level
            </button>
          )}
        </div>
      </header>

      <div className="modelPolicyModels">
        {(level?.models || []).map((model) => {
          const rowBusy = busy === `${level?.analysis_level}:${model.model_id}`;
          return (
            <div className={`modelPolicyRow ${model.active ? "active" : ""} ${!model.enabled ? "disabled" : ""}`} key={model.model_id}>
              <div className="modelPolicyIdentity">
                <strong>{model.model_name}</strong>
                <span>{model.model_id}</span>
              </div>
              <div><span>Version</span><strong>{model.version || "n/a"}</strong></div>
              <div><span>Training</span><strong>{humanize(model.trained_status)}</strong></div>
              <div><span>Last trained</span><strong>{formatDate(model.last_trained_at)}</strong></div>
              <div className="modelPolicyBadges">
                <span className={`modelPolicyEnabled ${model.enabled ? "enabled" : "disabled"}`}>
                  {model.enabled ? "enabled" : "disabled"}
                </span>
                {model.active && <span className="modelPolicyActive">active</span>}
              </div>
              <div className="modelPolicyActions">
                <button
                  disabled={busy !== null}
                  type="button"
                  onClick={() => onToggle(model.model_id, !model.enabled, model.model_name)}
                >
                  {rowBusy ? "Updating..." : model.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  className="primary"
                  disabled={!model.enabled || model.active || busy !== null}
                  type="button"
                  onClick={() => onSetActive(model.model_id, model.model_name)}
                >
                  {model.active ? "Active" : "Set as active"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("fr-FR");
}
