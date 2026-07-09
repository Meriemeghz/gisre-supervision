"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkflowDetailsDrawer } from "@/components/workflow/WorkflowDetailsDrawer";
import { WorkflowLiveFeed } from "@/components/workflow/WorkflowLiveFeed";
import { WorkflowTimeline, type WorkflowViewMode } from "@/components/workflow/WorkflowTimeline";
import { useLiveWorkflow } from "@/hooks/useLiveWorkflow";
import type { WorkflowItem } from "@/types/workflow";

export default function WorkflowPage() {
  const { items, liveItems, connectionStatus, error, lastEventAt, usingFallback } = useLiveWorkflow();
  const [selected, setSelected] = useState<WorkflowItem | null>(null);
  const [drawerItem, setDrawerItem] = useState<WorkflowItem | null>(null);
  const [viewMode, setViewMode] = useState<WorkflowViewMode>("technical");

  useEffect(() => {
    if (!selected && items.length) {
      setSelected(items[0]);
    }
  }, [items, selected]);

  const metrics = useMemo(() => {
    const reviewed = items.filter((item) => !["unverified", "pending_review"].includes(item.validation_status)).length;
    const warning = items.filter((item) => item.status === "warning" || item.severity === "critical").length;
    const aiLinked = items.filter((item) => item.risk_score !== null).length;
    return {
      total: items.length,
      live: liveItems.length,
      warning,
      aiLinked,
      reviewed,
    };
  }, [items, liveItems.length]);

  return (
    <div className="workflowPage">
      <section className="workflowHero">
        <div>
          <span className="sectionEyebrow">Realtime supervision pipeline</span>
          <h1>Real-Time Supervision Workflow</h1>
          <p>Trace interne du traitement d'un événement: Kafka, ingestion backend, persistence PostgreSQL, analyse IA, incident, recommandation et validation humaine.</p>
        </div>
        <div className={`workflowStreamStatus ${connectionStatus}`}>
          <span>{connectionStatus === "live" ? "SSE connected" : connectionStatus}</span>
          <strong>{lastEventAt ? `${Math.max(0, Math.round((Date.now() - lastEventAt) / 1000))}s ago` : "waiting"}</strong>
        </div>
      </section>

      {error && <div className="workflowNotice">{error}</div>}
      {usingFallback && (
        <div className="workflowNotice mutedNotice">
          No AI analysis trace available yet. Generate new Kafka events to see the real AI workflow.
        </div>
      )}

      <section className="workflowKpis">
        <Metric label="Workflow items" value={metrics.total} meta={usingFallback ? "waiting for SSE" : "from SSE"} />
        <Metric label="Live events" value={metrics.live} meta="real events" />
        <Metric label="AI linked" value={metrics.aiLinked} meta="with ai_analysis_results" />
        <Metric label="Warnings" value={metrics.warning} meta="critical or active" />
        <Metric label="Human reviewed" value={metrics.reviewed} meta="validated outcomes" />
      </section>

      <section className="workflowLayout">
        <WorkflowLiveFeed items={items} selectedId={selected?.id || null} onSelect={setSelected} />
        <WorkflowTimeline
          item={selected}
          mode={viewMode}
          onModeChange={setViewMode}
          onSelect={() => selected && setDrawerItem(selected)}
        />
      </section>

      <WorkflowDetailsDrawer item={drawerItem} onClose={() => setDrawerItem(null)} />
    </div>
  );
}

function Metric({ label, value, meta }: { label: string; value: number; meta: string }) {
  return (
    <article className="workflowMetric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}
