"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AiResult } from "@/lib/api";
import { getAiModelMetricsMap } from "@/lib/api/ai-models";
import type { AiModelMetrics } from "@/types/ai-models";
import type { AnalysisLevelTrace, AnalysisTrace, RiskFusionMetadata } from "@/types/workflow";
import {
  buildWorkflowStages,
  type WorkflowStage,
} from "./HorizontalAIWorkflow";

import styles from "./RealtimeKafkaWorkflow.module.css";

type WorkflowStatus = "success" | "warning" | "failed" | "skipped" | "unavailable" | "pending" | "warming";
type NodeId = "kafka" | "consumer" | "event" | "flow" | "temporal" | "graph" | "fusion" | "stored" | "recommendation" | "review";
type LevelKey = "event" | "flow" | "temporal" | "graph";
type BranchId = "eventContinue" | "eventEnd" | "flowContinue" | "flowEnd" | "temporalContinue" | "temporalEnd" | "graphEnd";

type WorkflowNodeModel = {
  id: NodeId;
  index: string;
  title: string;
  icon: ReactNode;
  status: WorkflowStatus;
  decision: string;
  disabled?: boolean;
  raw?: Record<string, unknown>;
  stage?: WorkflowStage;
};

type BranchModel = {
  id: BranchId;
  label: string;
  active: boolean;
  disabled?: boolean;
};

type DetailEntry = {
  label: string;
  value: string;
  accent?: WorkflowStatus;
  progress?: number;
};

type DetailSection = {
  title: string;
  entries: DetailEntry[];
  matrix?: ConfusionMatrixModel;
};

type ConfusionMatrixModel = {
  labels: string[];
  values: number[][];
};

type FinalNodeStatuses = {
  risk: WorkflowStatus;
  stored: WorkflowStatus;
  recommendation: WorkflowStatus;
  review: WorkflowStatus;
  riskSubtitle: string;
  storedSubtitle: string;
  recommendationSubtitle: string;
  reviewSubtitle: string;
};

type WorkflowModel = {
  nodes: WorkflowNodeModel[];
  nodeMap: Record<NodeId, WorkflowNodeModel>;
  branches: BranchModel[];
  defaultSelected: NodeId;
  hasResult: boolean;
};

type RealtimeKafkaWorkflowProps = {
  embedded?: boolean;
  result?: AiResult | null;
  results?: AiResult[];
  eventTimestamp?: string | null;
  streamStatus?: "connecting" | "live" | "error";
};

const LEVELS: Array<{ key: LevelKey; id: NodeId; index: string; title: string; next: AnalysisLevelTrace["decision_next_level"] }> = [
  { key: "event", id: "event", index: "03", title: "Event-Level", next: "flow" },
  { key: "flow", id: "flow", index: "04", title: "Flow-Level", next: "temporal" },
  { key: "temporal", id: "temporal", index: "05", title: "Temporal-Level", next: "graph" },
  { key: "graph", id: "graph", index: "06", title: "Graph-Level", next: "stop" },
];

const inspectorTabs = [
  { icon: "O", label: "Overview" },
  { icon: "D", label: "Detection" },
  { icon: "R", label: "Decision & Routing" },
  { icon: "M", label: "Model" },
  { icon: "L", label: "Metrics" },
  { icon: "E", label: "Explanation" },
  { icon: "{ }", label: "Raw Metadata" },
];

export function RealtimeKafkaWorkflow({
  embedded = false,
  result = null,
  results = [],
  eventTimestamp = null,
  streamStatus = "live",
}: RealtimeKafkaWorkflowProps) {
  const model = useMemo(
    () => buildWorkflowModel(result, results, eventTimestamp, streamStatus),
    [eventTimestamp, result, results, streamStatus],
  );
  const [selectedId, setSelectedId] = useState<NodeId>("event");
  const [selectedTab, setSelectedTab] = useState("Overview");
  const [modelMetricsById, setModelMetricsById] = useState<Record<string, AiModelMetrics>>({});

  useEffect(() => {
    setSelectedId(model.defaultSelected);
    setSelectedTab("Overview");
  }, [model.defaultSelected, result?.id]);

  useEffect(() => {
    let active = true;
    getAiModelMetricsMap()
      .then((metrics) => {
        if (active) setModelMetricsById(metrics);
      })
      .catch(() => {
        if (active) setModelMetricsById({});
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = model.nodes.find((node) => node.id === selectedId) || model.nodes[0];
  const details = buildInspectionSections(selected, result, modelMetricsById);

  const workflow = (
    <div className={`${styles.workflowCard} ${embedded ? styles.embeddedCard : ""}`}>
      <Link className={styles.expandButton} href="/realtime-kafka-workflow" aria-label="Expand Workflow">
        <span>NE</span>
        Expand Workflow
      </Link>

      <div className={styles.treeDiagram} aria-label="Conditional AI workflow">
        <div className={styles.sourceLane}>
          <WorkflowNode node={model.nodeMap.kafka} selected={selectedId === "kafka"} tone="kafka" onSelect={setSelectedId} />
          <span className={`${styles.directBranch} ${model.hasResult ? styles.activeBranch : ""}`} />
          <WorkflowNode node={model.nodeMap.consumer} selected={selectedId === "consumer"} tone="consumer" onSelect={setSelectedId} />
          <span className={`${styles.directBranch} ${model.hasResult ? styles.activeBranch : ""}`} />
        </div>

        <div className={styles.levelTree}>
          {LEVELS.map((level) => (
            <div className={`${styles.levelRow} ${model.nodeMap[level.id].disabled ? styles.disabledRow : ""}`} key={level.id}>
              <WorkflowNode node={model.nodeMap[level.id]} selected={selectedId === level.id} onSelect={setSelectedId} />
              <DecisionBranches
                branches={model.branches.filter((branch) => branch.id.startsWith(level.key))}
                isGraph={level.key === "graph"}
              />
            </div>
          ))}
        </div>

        <div className={`${styles.fusionJoin} ${model.branches.some((branch) => branch.id.endsWith("End") && branch.active) ? styles.activeJoin : ""}`} aria-hidden="true">
          <span />
        </div>

        <div className={styles.finalLane}>
          <WorkflowNode node={model.nodeMap.fusion} selected={selectedId === "fusion"} onSelect={setSelectedId} />
          <span className={`${styles.finalBranch} ${model.hasResult ? styles.activeBranch : ""}`} />
          <WorkflowNode node={model.nodeMap.stored} selected={selectedId === "stored"} onSelect={setSelectedId} />
          <span className={`${styles.finalBranch} ${model.hasResult ? styles.activeBranch : ""}`} />
          <WorkflowNode node={model.nodeMap.recommendation} selected={selectedId === "recommendation"} onSelect={setSelectedId} />
          <span className={`${styles.finalBranch} ${model.hasResult ? styles.activeBranch : ""}`} />
          <WorkflowNode node={model.nodeMap.review} selected={selectedId === "review"} onSelect={setSelectedId} />
        </div>
      </div>

      <StatusLegend />
      <InspectionPanel
        selected={selected}
        sections={details}
        selectedTab={selectedTab}
        onSelectTab={setSelectedTab}
      />
    </div>
  );

  if (embedded) return workflow;

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        <div>
          <h1>REALTIME KAFKA EVENT STREAM</h1>
          <p>Arrivee des evenements API et audit un par un depuis le simulateur, Kafka, backend et AI layer.</p>
        </div>
        <span className={styles.liveBadge}><i /> {streamStatus}</span>
      </header>
      {workflow}
    </section>
  );
}

function WorkflowNode({
  node,
  selected,
  onSelect,
  tone = "standard",
}: {
  node: WorkflowNodeModel;
  selected: boolean;
  onSelect: (id: NodeId) => void;
  tone?: "standard" | "kafka" | "consumer";
}) {
  const toneClass = tone === "standard" ? "" : styles[tone];
  return (
    <button
      className={`${styles.workflowNode} ${toneClass} ${styles[node.status]} ${node.disabled ? styles.disabledNode : ""} ${selected ? styles.selectedNode : ""}`}
      onClick={() => onSelect(node.id)}
      type="button"
    >
      <span className={styles.nodeId}>{node.index}</span>
      <span className={styles.nodeIcon}>{node.icon}</span>
      <strong>{node.title}</strong>
      <b>{statusLabel(node.status)}</b>
      <small>{node.decision}</small>
    </button>
  );
}

function DecisionBranches({ branches, isGraph }: { branches: BranchModel[]; isGraph?: boolean }) {
  return (
    <div className={`${styles.branchStack} ${isGraph ? styles.singleBranchStack : ""}`}>
      {branches.map((branch) => (
        <span
          className={`${styles.decisionBranch} ${branch.active ? styles.activeBranch : ""} ${branch.disabled ? styles.disabledBranch : ""}`}
          key={branch.id}
        >
          {branch.label}
        </span>
      ))}
    </div>
  );
}

function StatusLegend() {
  const items: Array<{ label: string; status: WorkflowStatus }> = [
    { label: "Success", status: "success" },
    { label: "Warning", status: "warning" },
    { label: "Failed", status: "failed" },
    { label: "Skipped", status: "skipped" },
    { label: "Unavailable", status: "unavailable" },
    { label: "Pending", status: "pending" },
    { label: "Warming up", status: "warming" },
  ];
  return (
    <div className={styles.legend}>
      {items.map((item) => (
        <span key={item.status}>
          <i className={styles[item.status]} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function InspectionPanel({
  selected,
  sections,
  selectedTab,
  onSelectTab,
}: {
  selected: WorkflowNodeModel;
  sections: DetailSection[];
  selectedTab: string;
  onSelectTab: (tab: string) => void;
}) {
  const activeSection = sections.find((section) => section.title === selectedTab);
  return (
    <section className={styles.inspectionPanel}>
      <aside className={styles.inspectionSidebar}>
        <span>INSPECTION PANEL</span>
        <strong>{selected.title}</strong>
        <p>{selected.decision}</p>
        <nav aria-label="Inspection categories">
          {inspectorTabs.map((tab) => (
            <button
              className={selectedTab === tab.label ? styles.activeTab : ""}
              key={tab.label}
              onClick={() => onSelectTab(tab.label)}
              type="button"
            >
              <i>{tab.icon}</i>
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className={styles.detailSections}>
        {selectedTab === "Raw Metadata" ? (
          <div className={styles.rawMetadata}>
            <pre>{JSON.stringify(selected.raw || {}, null, 2)}</pre>
          </div>
        ) : activeSection ? (
          <section className={styles.detailSection}>
            <h3>{activeSection.title}</h3>
            <div className={styles.detailGrid}>
              {activeSection.entries.map((detail) => (
                <DetailCard key={`${activeSection.title}-${detail.label}`} detail={detail} />
              ))}
            </div>
            {activeSection.matrix && <ConfusionMatrix matrix={activeSection.matrix} />}
          </section>
        ) : (
          <p>No details available for this stage.</p>
        )}
      </div>
    </section>
  );
}

function buildWorkflowModel(
  result: AiResult | null,
  results: AiResult[],
  eventTimestamp: string | null,
  streamStatus: RealtimeKafkaWorkflowProps["streamStatus"],
): WorkflowModel {
  const stages = result
    ? buildWorkflowStages(
        result,
        eventTimestamp || result.detected_at || result.created_at,
        results.length ? results : [result],
      )
    : [];
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const eventNext = stageNext(stageMap.get("event"));
  const flowReached = eventNext === "flow";
  const flowNext = flowReached ? stageNext(stageMap.get("flow")) : "stop";
  const temporalReached = flowNext === "temporal";
  const temporalNext = temporalReached ? stageNext(stageMap.get("temporal")) : "stop";
  const graphReached = temporalNext === "graph";
  const hasResult = Boolean(result);

  const nodes: WorkflowNodeModel[] = [
    stageNode("kafka", "01", "Kafka Event", "O", stageMap.get("kafka"), streamStatus),
    stageNode("consumer", "02", "FastAPI Consumer", "F", stageMap.get("consumer"), streamStatus),
    stageNode("event", "03", "Event-Level", "D", stageMap.get("event"), streamStatus),
    stageNode("flow", "04", "Flow-Level", "D", stageMap.get("flow"), streamStatus, !flowReached),
    stageNode("temporal", "05", "Temporal-Level", "D", stageMap.get("temporal"), streamStatus, !temporalReached),
    stageNode("graph", "06", "Graph-Level", "D", stageMap.get("graph"), streamStatus, !graphReached),
    stageNode("fusion", "07", "Risk Fusion", <ShieldIcon />, stageMap.get("fusion"), streamStatus),
    stageNode("stored", "08", "AI Result Stored", <DatabaseIcon />, stageMap.get("stored"), streamStatus),
    stageNode("recommendation", "09", "Recommendation", <BulbIcon />, stageMap.get("recommendation"), streamStatus),
    stageNode(
      "review",
      "10",
      result && noReviewRequired(result) ? "No Review" : "Review Queue",
      <UsersIcon />,
      stageMap.get("validation"),
      streamStatus,
    ),
  ];

  const branches: BranchModel[] = [
    { id: "eventContinue", label: "Continue to Flow", active: eventNext === "flow", disabled: !hasResult },
    { id: "eventEnd", label: "End Analysis", active: hasResult && eventNext !== "flow", disabled: !hasResult },
    { id: "flowContinue", label: "Continue to Temporal", active: flowReached && flowNext === "temporal", disabled: !flowReached },
    { id: "flowEnd", label: "End Analysis", active: flowReached && flowNext !== "temporal", disabled: !flowReached },
    { id: "temporalContinue", label: "Continue to Graph", active: temporalReached && temporalNext === "graph", disabled: !temporalReached },
    { id: "temporalEnd", label: "End Analysis", active: temporalReached && temporalNext !== "graph", disabled: !temporalReached },
    { id: "graphEnd", label: "End Analysis", active: graphReached, disabled: !graphReached },
  ];

  const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<NodeId, WorkflowNodeModel>;
  const defaultSelected: NodeId = nodes.find((node) => ["warning", "failed"].includes(node.status) && !node.disabled)?.id || "event";
  return { nodes, nodeMap, branches, defaultSelected, hasResult };
}

function stageNode(
  id: NodeId,
  index: string,
  title: string,
  icon: ReactNode,
  stage: WorkflowStage | undefined,
  streamStatus: RealtimeKafkaWorkflowProps["streamStatus"],
  disabled = false,
): WorkflowNodeModel {
  const waitingStatus: WorkflowStatus = streamStatus === "error" ? "failed" : "pending";
  return {
    id,
    index,
    title: stage?.label || title,
    icon,
    status: disabled ? "skipped" : stage ? mapStageStatus(stage.status) : waitingStatus,
    decision: disabled ? "Skipped" : stage?.decision || (streamStatus === "error" ? "Unavailable" : "Waiting"),
    disabled,
    raw: stage?.rawMetadata || {},
    stage,
  };
}

function stageNext(stage: WorkflowStage | undefined): AnalysisLevelTrace["decision_next_level"] {
  const next = String(stage?.decisionNextLevel || "").toLowerCase();
  if (next === "flow" || next === "temporal" || next === "graph") return next;
  return "stop";
}

function mapStageStatus(status: WorkflowStage["status"]): WorkflowStatus {
  if (status === "warming_up") return "warming";
  if (status === "failed" || status === "skipped" || status === "unavailable" || status === "pending" || status === "warning" || status === "success") {
    return status;
  }
  if (status === "running") return "pending";
  if (status === "review") return "warning";
  return "unavailable";
}

function buildInspectionSections(
  selected: WorkflowNodeModel,
  result: AiResult | null,
  modelMetricsById: Record<string, AiModelMetrics>,
): DetailSection[] {
  const stage = selected.stage;
  const details = stage?.details || [];
  const metrics = stage?.metrics || {};
  const detail = (label: string) => details.find((entry) => entry.label === label)?.value || "N/A";
  const modelId = cleanString(selected.raw?.selected_model_id) || detail("Selected model");
  const modelMetrics = modelId && modelId !== "N/A" ? modelMetricsById[modelId] : undefined;
  const modelMetricEntries = buildModelMetricEntries(modelMetrics);
  const confusionMatrix = buildConfusionMatrix(modelMetrics);
  const selectedDetails = (labels: string[]) =>
    details
      .filter((entry) => labels.includes(entry.label))
      .map((entry) => ({ label: entry.label, value: entry.value }));

  const sections: DetailSection[] = [
    {
      title: "Overview",
      entries: [
        { label: "Status", value: statusLabel(selected.status), accent: selected.status },
        { label: "Executed", value: detail("Executed") !== "N/A" ? detail("Executed") : String(!selected.disabled && Boolean(result)) },
        { label: "Analysis level", value: stage?.analysisLevel || selected.id },
        { label: "Timestamp", value: stage?.timestamp ? formatTimestamp(stage.timestamp) : result ? formatTimestamp(result.detected_at || result.created_at) : "N/A" },
        ...selectedDetails([
          "Source event",
          "Source type",
          "Result ID",
          "Analysis type",
          "Final risk",
          "Final severity",
          "Validation status",
        ]),
      ],
    },
    {
      title: "Detection",
      entries: [
        { label: "Anomaly type", value: detail("Anomaly type") !== "N/A" ? detail("Anomaly type") : result?.detected_anomaly_type || "N/A" },
        { label: "Severity", value: detail("Severity") !== "N/A" ? detail("Severity") : result?.severity?.toUpperCase() || detail("Final severity") },
        { label: "Confidence", value: detail("Confidence") !== "N/A" ? detail("Confidence") : formatConfidence(result?.confidence ?? null) },
        {
          label: "Risk contribution",
          value: detail("Risk contribution") !== "N/A" ? detail("Risk contribution") : formatRisk(result?.risk_score),
          progress: clampNumber(Number(selected.raw?.risk_contribution ?? result?.risk_score ?? 0), 0, 100),
        },
        ...selectedDetails(["Event contribution", "Flow contribution", "Temporal contribution", "Graph contribution"]),
      ],
    },
    {
      title: "Decision & Routing",
      entries: [
        { label: "Decision", value: detail("Decision") !== "N/A" ? detail("Decision") : selected.decision },
        { label: "Next level", value: stage?.decisionNextLevel ? nextLevelLabel(readNext(stage.decisionNextLevel)) : "N/A" },
        ...selectedDetails([
          "Decision reason",
          "Routing trigger",
          "Triage status",
          "Decision source",
          "Baseline decision",
          "RL action",
          "RL confidence",
          "Expected reward",
          "Policy version",
          "Safety override",
          "Requires human review",
        ]),
      ],
    },
    {
      title: "Model",
      entries: selectedDetails(["Model name", "Selected model", "Model version", "Window"]),
    },
    {
      title: "Metrics",
      entries: [
        ...Object.entries(metrics).map(([key, value]) => ({ label: humanize(key), value: formatValue(value) })),
        ...modelMetricEntries,
        ...(modelMetricEntries.length === 0
          ? [{ label: "Model metrics", value: modelId && modelId !== "N/A" ? "Unavailable for this model" : "No selected model" }]
          : []),
        ...details
          .filter((entry) => /count|average|risk$/i.test(entry.label))
          .map((entry) => ({ label: entry.label, value: entry.value })),
      ],
      matrix: confusionMatrix,
    },
    {
      title: "Explanation",
      entries: [
        { label: "Stage summary", value: stage?.summary || selected.decision },
        { label: "Explanation", value: detail("Explanation") !== "N/A" ? detail("Explanation") : result?.explanation || "N/A" },
        { label: "Recommendation", value: detail("Recommendation") !== "N/A" ? detail("Recommendation") : result?.recommendation || "N/A" },
        { label: "Decision reason", value: detail("Decision reason") },
      ],
    },
  ];

  return sections.map((section) => ({
    ...section,
    entries: section.entries.length ? section.entries : [{ label: section.title, value: "N/A" }],
  }));
}

function buildFinalNodeStatuses(result: AiResult | null, streamStatus: RealtimeKafkaWorkflowProps["streamStatus"]): FinalNodeStatuses {
  if (!result) {
    const waiting: WorkflowStatus = streamStatus === "error" ? "failed" : "pending";
    return {
      risk: waiting,
      stored: waiting,
      recommendation: waiting,
      review: waiting,
      riskSubtitle: streamStatus === "error" ? "Error" : "Waiting",
      storedSubtitle: "Pending",
      recommendationSubtitle: "Pending",
      reviewSubtitle: "Pending",
    };
  }
  const metadata = readRecord(result.metadata);
  const fusion = readRecord(metadata.risk_fusion) as RiskFusionMetadata;
  const riskStatus = mapFusionStatus(fusion, result);
  const triage = readRecord(metadata.triage_decision);
  const reviewStatus: WorkflowStatus = noReviewRequired(result) || isClosedValidation(result.validation_status) ? "success" : "warning";
  return {
    risk: riskStatus,
    stored: "success",
    recommendation: result.recommendation ? "success" : "skipped",
    review: reviewStatus,
    riskSubtitle: riskStatus === "failed" ? "Failed" : "Fused",
    storedSubtitle: "Stored",
    recommendationSubtitle: result.recommendation ? "Generated" : "No action",
    reviewSubtitle: triage.requires_human_review === false ? "No Review" : isClosedValidation(result.validation_status) ? "Reviewed" : "Pending Review",
  };
}

function readAnalysisTrace(result: AiResult): AnalysisTrace {
  const metadata = readRecord(result.metadata);
  return readRecord(metadata.analysis_trace) as AnalysisTrace;
}

function nextDecision(levelTrace: AnalysisLevelTrace | undefined, fallback: AnalysisLevelTrace["decision_next_level"]) {
  if (!levelTrace) return fallback;
  return readNext(levelTrace.decision_next_level);
}

function readNext(value: unknown): AnalysisLevelTrace["decision_next_level"] {
  return value === "flow" || value === "temporal" || value === "graph" ? value : "stop";
}

function mapLevelStatus(levelTrace: AnalysisLevelTrace | undefined): WorkflowStatus {
  if (!levelTrace) return "unavailable";
  if (levelTrace.executed === false || levelTrace.status === "skipped") return "skipped";
  if (levelTrace.status === "failed") return "failed";
  if (levelTrace.status === "success") return "success";
  if (levelTrace.status === "warning") return "warning";
  if (levelTrace.status === "unavailable") return "unavailable";
  if (levelTrace.status === "warming_up") return "warming";
  if (levelTrace.anomaly_detected === true || Number(levelTrace.risk_contribution || 0) > 0) return "warning";
  if (levelTrace.executed === true) return "success";
  return "unavailable";
}

function mapFusionStatus(fusion: RiskFusionMetadata, result: AiResult): WorkflowStatus {
  if (fusion.status === "failed") return "failed";
  if (fusion.status === "skipped") return "skipped";
  if (fusion.status === "success") return Number(result.risk_score || 0) > 0 ? "warning" : "success";
  if (Number(result.risk_score || 0) > 0) return "warning";
  return "success";
}

function nextLevelDecision(next: AnalysisLevelTrace["decision_next_level"]) {
  if (next === "flow") return "Continue to Flow";
  if (next === "temporal") return "Continue to Temporal";
  if (next === "graph") return "Continue to Graph";
  return "End Analysis";
}

function nextLevelLabel(next: AnalysisLevelTrace["decision_next_level"]) {
  if (next === "flow") return "Flow-Level";
  if (next === "temporal") return "Temporal-Level";
  if (next === "graph") return "Graph-Level";
  return "Risk Fusion";
}

function statusLabel(status: WorkflowStatus) {
  if (status === "warming") return "WARMING UP";
  return status.toUpperCase();
}

function noReviewRequired(result: AiResult) {
  const triage = readRecord(readRecord(result.metadata).triage_decision);
  return triage.requires_human_review === false || triage.status === "AUTO_DISMISSED";
}

function isClosedValidation(value: string | null | undefined) {
  return ["CLOSED", "RESOLVED", "VALIDATED", "CONFIRMED", "FALSE_POSITIVE", "AUTO_CONFIRMED", "AUTO_DISMISSED"].includes(String(value || "").toUpperCase());
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "N/A";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

function formatConfidence(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "unavailable";
  const numeric = Number(value);
  return numeric <= 1 ? `${Math.round(numeric * 100)}%` : `${Math.round(numeric)}%`;
}

function formatRisk(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? `${Math.round(numeric)} / 100` : "N/A";
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function buildModelMetricEntries(metrics: AiModelMetrics | undefined): DetailEntry[] {
  if (!metrics) return [];
  const keys = selectModelMetricKeys(metrics);
  return keys
    .filter((key) => metrics[key as keyof AiModelMetrics] !== undefined && metrics[key as keyof AiModelMetrics] !== null)
    .map((key) => ({
      label: humanize(key),
      value: formatModelMetric(key, metrics[key as keyof AiModelMetrics]),
    }));
}

function selectModelMetricKeys(metrics: AiModelMetrics) {
  if (
    Array.isArray(metrics.confusion_matrix)
    || metrics.accuracy !== undefined
    || metrics.precision !== undefined
    || metrics.recall !== undefined
    || metrics.f1_score !== undefined
  ) {
    return [
      "accuracy",
      "precision",
      "recall",
      "f1_score",
      "auc",
      "false_positive_rate",
      "false_negative_rate",
      "labelled_eval_count",
      "sample_count",
    ];
  }
  if (metrics.silhouette_score !== undefined || metrics.anomaly_rate !== undefined || metrics.contamination_rate !== undefined) {
    return [
      "silhouette_score",
      "anomaly_rate",
      "contamination_rate",
      "n_neighbors",
      "sample_count",
      "avg_confidence",
      "avg_inference_ms",
    ];
  }
  if (metrics.loss !== undefined || metrics.reconstruction_error !== undefined) {
    return [
      "loss",
      "validation_loss",
      "reconstruction_error",
      "detection_threshold",
      "avg_confidence",
      "avg_inference_ms",
    ];
  }
  if (metrics.model_family === "deterministic_rules" || metrics.active_rule_count !== undefined) {
    return [
      "active_rule_count",
      "triggered_rule_count",
      "rule_coverage",
      "validation_match_rate",
      "scoring_coverage",
      "recommendation_coverage",
      "avg_risk_score",
      "avg_inference_ms",
    ];
  }
  return ["avg_confidence", "avg_inference_ms", "sample_count", "total_anomalies", "avg_risk_score"];
}

function buildConfusionMatrix(metrics: AiModelMetrics | undefined): ConfusionMatrixModel | undefined {
  const matrix = metrics?.confusion_matrix;
  if (!Array.isArray(matrix) || matrix.length === 0) return undefined;
  const values = matrix.map((row) => Array.isArray(row) ? row.map(Number) : []);
  const size = values.length;
  if (values.some((row) => row.length !== size || row.some((cell) => !Number.isFinite(cell)))) return undefined;
  const labels = values.map((_, index) => metrics?.confusion_labels?.[index] || fallbackMatrixLabel(index, size));
  return { labels, values };
}

function fallbackMatrixLabel(index: number, size: number) {
  if (size === 2) return index === 0 ? "normal" : "anomaly";
  return ["normal", "anomaly", "critical"][index] || `class ${index + 1}`;
}

function formatModelMetric(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "N/A";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (key.includes("ms")) return `${Math.round(numeric)} ms`;
  if (key === "silhouette_score") return numeric.toFixed(3);
  if (
    key.includes("rate")
    || key.includes("coverage")
    || ["accuracy", "precision", "recall", "f1_score", "auc", "avg_confidence"].includes(key)
  ) {
    return `${Math.round(numeric * 100)}%`;
  }
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(3);
}

function ConfusionMatrix({ matrix }: { matrix: ConfusionMatrixModel }) {
  return (
    <div className={styles.confusionMatrix}>
      <div className={styles.confusionMatrixHeader}>
        <strong>Matrice de confusion</strong>
        <span>Reel x Pred</span>
      </div>
      <div
        className={styles.confusionMatrixGrid}
        style={{ gridTemplateColumns: `88px repeat(${matrix.labels.length}, minmax(48px, 1fr))` }}
      >
        <span />
        {matrix.labels.map((label) => <b key={`pred-${label}`}>Pred {label}</b>)}
        {matrix.values.map((row, rowIndex) => (
          <div className={styles.confusionMatrixRow} key={`row-${matrix.labels[rowIndex]}`}>
            <b>Reel {matrix.labels[rowIndex]}</b>
            {row.map((value, columnIndex) => (
              <span
                className={rowIndex === columnIndex ? styles.matrixDiagonal : ""}
                key={`${rowIndex}-${columnIndex}`}
              >
                {value}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailCard({ detail }: { detail: DetailEntry }) {
  return (
    <article className={styles.detailCard}>
      <div>
        <span>{detail.label}</span>
        <strong className={detail.accent ? styles[detail.accent] : ""}>{detail.value}</strong>
        {typeof detail.progress === "number" && (
          <em className={styles.progress}>
            <b style={{ width: `${detail.progress}%` }} />
          </em>
        )}
      </div>
    </article>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5.5 5.7v5.4c0 4.2 2.7 7.9 6.5 9.4 3.8-1.5 6.5-5.2 6.5-9.4V5.7L12 3Z" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="12" cy="5.5" rx="6.5" ry="3" />
      <path d="M5.5 5.5v6c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3v-6" />
      <path d="M5.5 11.5v6c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3v-6" />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M8.2 13.8A6 6 0 1 1 15.8 14c-.9.7-1.3 1.6-1.3 2.5h-5c0-1-.4-1.9-1.3-2.7Z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.8 19c.7-3 2.4-4.7 5.2-4.7s4.5 1.7 5.2 4.7" />
      <path d="M13.8 15.1c2.7.1 4.5 1.4 5.4 3.9" />
    </svg>
  );
}
