"use client";

import { useEffect, useMemo, useState } from "react";
import { getAiModels } from "@/lib/api/ai-models";
import type { AiModel } from "@/types/ai-models";
import { ModelCard } from "@/components/models/ModelCard";

export default function ModelsPage() {
  const [models, setModels] = useState<AiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [objective, setObjective] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setModels(await getAiModels());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de chargement");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const objectiveNeedle = objective.trim().toLowerCase();
    return models.filter((model) => {
      const matchesStatus = status === "all" || model.status === status;
      const matchesType = type === "all" || model.type === type;
      const matchesObjective = !objectiveNeedle || model.objective.toLowerCase().includes(objectiveNeedle);
      const matchesQuery = !needle || model.name.toLowerCase().includes(needle);
      return matchesStatus && matchesType && matchesObjective && matchesQuery;
    });
  }, [models, objective, query, status, type]);

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>Modeles IA</h1>
          <p>Comprendre quels modeles supervisent GISRE, pourquoi ils existent, et ce qu'ils detectent.</p>
        </div>
        <span className="statusPill">{filtered.length} modeles</span>
      </div>

      {error && <div className="errorBox">API indisponible, fallback mock utilise: {error}</div>}

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
          <option value="experimental">Experimental</option>
        </select>
        <input className="input" placeholder="Filtrer par objectif" value={objective} onChange={(event) => setObjective(event.target.value)} />
      </section>

      {loading && <div className="card cardBody">Chargement des modeles...</div>}
      {!loading && filtered.length === 0 && <div className="card cardBody">Aucun modele ne correspond aux filtres.</div>}

      <section className="modelCardsGrid">
        {filtered.map((model) => (
          <ModelCard model={model} key={model.id} />
        ))}
      </section>
    </>
  );
}
