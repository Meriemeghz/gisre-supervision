"use client";

import { useEffect, useMemo, useState } from "react";
import type { AiResult } from "@/lib/api";
import { getAnomalyVisualLevel, type AnomalyVisualLevel } from "@/lib/anomaly-visual";
import type { WorkflowStepStatus } from "@/types/workflow";

type DetailEntry = {
  label: string;
  value: string;
};

export type WorkflowStage = {
  id: string;
  label: string;
  icon: string;
  kind: "source" | "decision" | "process" | "review";
  status: WorkflowStepStatus;
  decision: string;
  summary: string;
  timestamp: string | null;
  analysisLevel: string;
  details: DetailEntry[];
  metrics?: Record<string, unknown>;
  rawMetadata?: Record<string, unknown>;
  visualLevel?: AnomalyVisualLevel;
  decisionNextLevel?: string;
};

const AI_LEVELS = ["event", "flow", "temporal", "graph"];

export function HorizontalAIWorkflow({
  result,
  results,
  eventTimestamp,
}: {
  result: AiResult | null;
  results: AiResult[];
  eventTimestamp: string | null;
}) {
  const [selectedId, setSelectedId] = useState("event");
  const traceAvailable = hasEventAnalysisTrace(result);
  const stages = useMemo(
    () => traceAvailable && result
      ? buildWorkflowStages(result, eventTimestamp, results)
      : [],
    [eventTimestamp, result, results, traceAvailable],
  );

  useEffect(() => {
    setSelectedId("event");
  }, [result?.id]);

  if (!traceAvailable || !result) {
    return (
      <section className="aiDecisionConsole empty">
        <div>
          <span className="sectionEyebrow">Real-Time AI Workflow</span>
          <h2>AI Decision Workflow</h2>
        </div>
        <p>No AI analysis trace available yet. Waiting for new Kafka events.</p>
      </section>
    );
  }

  const selected = stages.find((stage) => stage.id === selectedId) || stages[0];

  return (
    <section className="aiDecisionConsole">
      <header className="aiDecisionHeader">
        <div>
          <span className="sectionEyebrow">Real-Time AI Workflow</span>
          <h2>AI Decision Workflow</h2>
          <p>{result.detected_anomaly_type} / risk {result.risk_score}/100</p>
        </div>
        <span className="aiAnalysisTraceBadge available">Trace available</span>
      </header>

      <WorkflowNavigator
        selectedId={selected.id}
        stages={stages}
        onSelect={setSelectedId}
      />

      <InspectionPanel selected={selected} />
    </section>
  );
}

function WorkflowNavigator({
  stages,
  selectedId,
  onSelect,
}: {
  stages: WorkflowStage[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const stageById = toStageMap(stages);
  const source = ["kafka", "consumer"]
    .map((id) => stageById.get(id))
    .filter((stage): stage is WorkflowStage => Boolean(stage));
  const levels = AI_LEVELS
    .map((id) => stageById.get(id))
    .filter((stage): stage is WorkflowStage => Boolean(stage));
  const tail = ["fusion", "stored", "recommendation", "validation"]
    .map((id) => stageById.get(id))
    .filter((stage): stage is WorkflowStage => Boolean(stage));

  return (
    <div className="aiWorkflowNavigator" aria-label="AI decision workflow navigator">
      <div className="aiWorkflowColumn">
        {source.map((stage, index) => (
          <WorkflowNode
            index={index + 1}
            key={stage.id}
            selected={selectedId === stage.id}
            stage={stage}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="aiWorkflowDecisionColumn">
        {levels.map((stage, index) => (
          <WorkflowNode
            index={source.length + index + 1}
            key={stage.id}
            selected={selectedId === stage.id}
            stage={stage}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="aiWorkflowFusionJoin">
        <span>End Analysis branches converge</span>
        <i />
      </div>

      <div className="aiWorkflowColumn">
        {tail.map((stage, index) => (
          <WorkflowNode
            index={source.length + levels.length + index + 1}
            key={stage.id}
            selected={selectedId === stage.id}
            stage={stage}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function WorkflowNode({
  stage,
  index,
  selected,
  onSelect,
}: {
  stage: WorkflowStage;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className={`aiWorkflowNode ${stage.kind} ${stage.status} ${selected ? "selected" : ""}`}
      onClick={() => onSelect(stage.id)}
      type="button"
    >
      <span className="aiWorkflowNodeIndex">{String(index).padStart(2, "0")}</span>
      <span className="aiWorkflowNodeIcon" aria-hidden="true">{stage.icon}</span>
      <span className="aiWorkflowNodeText">
        <strong>{stage.label}</strong>
        <small>{stage.decision}</small>
      </span>
      <span className={`aiWorkflowStatusDot ${stage.status}`} title={stage.status} />
    </button>
  );
}

function InspectionPanel({ selected }: { selected: WorkflowStage }) {
  const overview = [
    { label: "Status", value: selected.status },
    { label: "Executed", value: detailValue(selected, "Executed") },
    { label: "Analysis Level", value: selected.analysisLevel },
    { label: "Timestamp", value: selected.timestamp ? formatTimestamp(selected.timestamp) : "timestamp unavailable" },
  ];
  const detection = [
    { label: "Anomaly Type", value: detailValue(selected, "Anomaly type") },
    { label: "Severity", value: detailValue(selected, "Severity") },
    { label: "Confidence", value: detailValue(selected, "Confidence") },
    { label: "Risk Contribution", value: detailValue(selected, "Risk contribution") },
  ];
  const decision = [
    { label: "Decision", value: detailValue(selected, "Decision") || selected.decision },
    { label: "Next Level", value: selected.decisionNextLevel || "unavailable" },
    { label: "Decision Reason", value: detailValue(selected, "Decision reason") },
    { label: "Routing Trigger", value: detailValue(selected, "Routing trigger") },
  ];
  const model = [
    { label: "Selected Model", value: detailValue(selected, "Model name") || detailValue(selected, "Selected model") },
    { label: "Model ID", value: detailValue(selected, "Selected model") },
    { label: "Model Version", value: detailValue(selected, "Model version") },
    { label: "Window", value: detailValue(selected, "Window") },
  ];
  const recommendation = [
    { label: "Explanation", value: detailValue(selected, "Explanation") },
    { label: "Recommendation", value: detailValue(selected, "Recommendation") },
  ];

  return (
    <div className="aiWorkflowInspector">
      <div className="aiWorkflowInspectorIntro">
        <div>
          <span>Inspection Panel</span>
          <strong>{selected.label}</strong>
          <p>{selected.summary}</p>
        </div>
        <em className={selected.status}>{selected.status}</em>
      </div>

      <InspectorSection entries={overview} title="Overview" />
      <InspectorSection entries={detection} title="Detection" />
      <InspectorSection entries={decision} title="Decision & Routing" />
      <InspectorSection entries={model} title="Model" />

      {selected.metrics && Object.keys(selected.metrics).length > 0 && (
        <div className="aiWorkflowInspectorBlock">
          <h3>Metrics</h3>
          <div className="aiWorkflowInspectorGrid">
            {Object.entries(selected.metrics).map(([key, value]) => (
              <Detail key={key} label={humanize(key)} value={formatValue(value)} />
            ))}
          </div>
        </div>
      )}

      <InspectorSection entries={recommendation} title="Recommendation" />

      <details className="aiWorkflowRaw">
        <summary>Raw Metadata</summary>
        <pre>{JSON.stringify(selected.rawMetadata || {}, null, 2)}</pre>
      </details>
    </div>
  );
}

function InspectorSection({ title, entries }: { title: string; entries: DetailEntry[] }) {
  return (
    <div className="aiWorkflowInspectorBlock">
      <h3>{title}</h3>
      <div className="aiWorkflowInspectorGrid">
        {entries.map((entry) => (
          <Detail key={entry.label} label={entry.label} value={entry.value || "unavailable"} />
        ))}
      </div>
    </div>
  );
}

export function hasEventAnalysisTrace(result: AiResult | null | undefined) {
  const metadata = workflowMetadata(result);
  const analysisTrace = asRecord(metadata.analysis_trace);
  return Object.keys(asRecord(analysisTrace.event)).length > 0;
}

export function buildWorkflowStages(
  result: AiResult,
  eventTimestamp: string | null,
  results: AiResult[] = [result],
) {
  return applyRoutingView(buildStages(result, eventTimestamp, buildWorkflowKpis(results)));
}

function buildStages(
  result: AiResult,
  eventTimestamp: string | null,
  workflowKpis: Record<string, DetailEntry[]>,
): WorkflowStage[] {
  const metadata = workflowMetadata(result);
  const analysisTrace = asRecord(metadata.analysis_trace);
  const eventTrace = asRecord(analysisTrace.event);
  const flowTrace = asRecord(analysisTrace.flow);
  const temporalTrace = asRecord(analysisTrace.temporal);
  const graphTrace = asRecord(analysisTrace.graph);
  const riskFusion = asRecord(metadata.risk_fusion);
  const recommendationDecision = asRecord(metadata.recommendation_decision);
  const triageDecision = {
    ...asRecord(metadata.triage_decision),
    ...asRecord(metadata.rl_decision),
  };
  const anomalyDetected = eventTrace.anomaly_detected === true
    || flowTrace.anomaly_detected === true
    || temporalTrace.anomaly_detected === true
    || graphTrace.anomaly_detected === true;

  return [
    {
      id: "kafka",
      label: "Kafka Event",
      icon: "K",
      kind: "source",
      status: "success",
      decision: "received",
      summary: "Source event received by the AI pipeline.",
      timestamp: eventTimestamp,
      analysisLevel: "source",
      details: [
        { label: "Source event", value: result.source_event_id || "unavailable" },
        { label: "Source type", value: result.source_event_type || "unavailable" },
      ],
      rawMetadata: {
        source_event_id: result.source_event_id,
        source_event_type: result.source_event_type,
        event_timestamp: eventTimestamp,
      },
    },
    {
      id: "consumer",
      label: "FastAPI Consumer",
      icon: "F",
      kind: "source",
      status: "success",
      decision: "consumed",
      summary: "A persisted AI result confirms FastAPI consumed the event.",
      timestamp: null,
      analysisLevel: "ingestion",
      details: [{ label: "Result ID", value: result.id }],
      rawMetadata: { result_id: result.id },
    },
    levelStage("event", "Event-Level", "E", eventTrace, metadata, workflowKpis.event),
    levelStage("flow", "Flow-Level", "F", flowTrace, metadata, workflowKpis.flow),
    levelStage("temporal", "Temporal-Level", "T", temporalTrace, metadata, workflowKpis.temporal),
    levelStage("graph", "Graph-Level", "G", graphTrace, metadata, workflowKpis.graph),
    riskStage(riskFusion, workflowKpis.fusion),
    {
      id: "stored",
      label: "AI Result Stored",
      icon: "S",
      kind: "process",
      status: "success",
      decision: "stored",
      summary: "Result persisted in ai_analysis_results.",
      timestamp: result.created_at || result.detected_at || null,
      analysisLevel: "persistence",
      details: [
        { label: "Result ID", value: result.id },
        { label: "Analysis type", value: result.analysis_type || "unavailable" },
      ],
      rawMetadata: {
        result_id: result.id,
        analysis_type: result.analysis_type,
        created_at: result.created_at,
        detected_at: result.detected_at,
      },
    },
    {
      id: "recommendation",
      label: "Recommendation",
      icon: "R",
      kind: "process",
      status: result.recommendation
        ? "success"
        : recommendationDecision.generated === false
          ? "skipped"
          : "unavailable",
      decision: result.recommendation ? "generated" : "no action",
      summary: stringValue(recommendationDecision.reason)
        || (result.recommendation ? "Operational recommendation generated." : "Recommendation unavailable."),
      timestamp: null,
      analysisLevel: "recommendation",
      details: [
        { label: "Recommendation", value: result.recommendation || "unavailable" },
        ...workflowKpis.recommendation,
      ],
      rawMetadata: recommendationDecision,
    },
    {
      id: "validation",
      label: "Review Queue",
      icon: "Q",
      kind: "review",
      status: validationStatus(result, triageDecision, anomalyDetected),
      decision: validationDecision(result, triageDecision, anomalyDetected),
      summary: reviewSummary(result, triageDecision, anomalyDetected),
      timestamp: result.validated_at || null,
      analysisLevel: "review",
      details: [
        { label: "Triage status", value: stringValue(triageDecision.status) || "unavailable" },
        { label: "Decision source", value: stringValue(triageDecision.source) || "baseline" },
        { label: "Baseline decision", value: stringValue(triageDecision.baseline_status) || stringValue(triageDecision.status) || "unavailable" },
        { label: "RL action", value: stringValue(triageDecision.rl_action) || "RL disabled or not applied" },
        { label: "RL confidence", value: formatConfidence(triageDecision.rl_confidence) },
        { label: "Expected reward", value: formatValue(triageDecision.expected_reward) },
        { label: "Policy version", value: stringValue(triageDecision.policy_version) || stringValue(triageDecision.rl_policy_version) || "unavailable" },
        { label: "Requires human review", value: formatValue(triageDecision.requires_human_review) },
        { label: "Safety override", value: formatValue(triageDecision.safety_override) },
        { label: "Decision reason", value: stringValue(triageDecision.reason) || "unavailable" },
        { label: "Validation status", value: result.validation_status || "pending_review" },
        { label: "Validated by", value: result.validated_by || "unavailable" },
        { label: "Recommendation", value: result.validation_comment || "unavailable" },
        ...workflowKpis.validation,
      ],
      rawMetadata: triageDecision,
    },
  ];
}

function levelStage(
  id: "event" | "flow" | "temporal" | "graph",
  label: string,
  icon: string,
  trace: Record<string, unknown>,
  metadata: Record<string, unknown>,
  kpis?: DetailEntry[],
): WorkflowStage {
  const rawReason = stringValue(trace.skip_reason)
    || stringValue(trace.reason)
    || stringValue(trace.decision_reason);
  const status = id === "flow" && isFlowWarmingUp(trace.status, rawReason)
    ? "warming_up"
    : id === "temporal" && isTemporalWarmingUp(trace.status, rawReason)
      ? "warming_up"
      : id === "graph" && isGraphWarmingUp(trace.status, rawReason)
        ? "warming_up"
        : statusValue(trace.status);
  const executed = trace.executed === true;
  const reason = status === "warming_up" && id === "flow"
    ? "Collecting flow window data"
    : status === "warming_up" && id === "temporal"
      ? "Collecting temporal window data"
      : status === "warming_up" && id === "graph"
        ? "Collecting graph dependency window data"
        : rawReason || "Analysis trace unavailable.";
  const routingTrigger = id === "event"
    ? stringValue(trace.routing_trigger) || legacyRoutingTrigger(trace, metadata)
    : stringValue(trace.routing_trigger);
  const decisionNextLevel = normalizeDecision(trace.decision_next_level);

  return {
    id,
    label,
    icon,
    kind: "decision",
    status,
    decision: decisionLabel(decisionNextLevel),
    summary: reason,
    timestamp: null,
    analysisLevel: id,
    details: [
      { label: "Selected model", value: stringValue(trace.selected_model_id) || "unavailable" },
      { label: "Model name", value: stringValue(trace.selected_model_name) || "unavailable" },
      { label: "Model version", value: stringValue(trace.selected_model_version) || "unavailable" },
      ...(id === "flow" || id === "temporal" || id === "graph" ? [{ label: "Window", value: stringValue(trace.window) || "unavailable" }] : []),
      { label: "Anomaly type", value: stringValue(trace.anomaly_type) || "unavailable" },
      { label: "Severity", value: stringValue(trace.severity) || "unavailable" },
      { label: "Confidence", value: formatConfidence(trace.confidence) },
      { label: "Risk contribution", value: formatValue(trace.risk_contribution) },
      { label: "Decision", value: decisionLabel(decisionNextLevel) },
      { label: "Decision reason", value: stringValue(trace.decision_reason) || "unavailable" },
      { label: "Routing trigger", value: routingTrigger || "unavailable" },
      { label: "Executed", value: executed ? "true" : "false" },
      { label: "Explanation", value: stringValue(trace.explanation) || "unavailable" },
      { label: "Recommendation", value: stringValue(trace.recommendation) || "unavailable" },
      ...(kpis || []),
    ],
    metrics: executed ? levelMetrics(id, trace) : undefined,
    rawMetadata: trace,
    visualLevel: getAnomalyVisualLevel(
      stringValue(trace.anomaly_type),
      stringValue(trace.severity),
    ),
    decisionNextLevel,
  };
}

function riskStage(fusion: Record<string, unknown>, kpis?: DetailEntry[]): WorkflowStage {
  const contributions = asRecord(fusion.contributions);
  const hasFusion = numberValue(fusion.final_risk_score) !== null || fusion.status === "success";
  return {
    id: "fusion",
    label: "Risk Fusion",
    icon: "RF",
    kind: "process",
    status: hasFusion ? statusValue(fusion.status, "success") : "unavailable",
    decision: "fused",
    summary: stringValue(fusion.fusion_reason) || "Risk fusion metadata unavailable.",
    timestamp: null,
    analysisLevel: "fusion",
    details: [
      { label: "Final risk", value: formatValue(fusion.final_risk_score) },
      { label: "Final severity", value: stringValue(fusion.final_severity) || "unavailable" },
      { label: "Event contribution", value: formatValue(contributions.event) },
      { label: "Flow contribution", value: formatValue(contributions.flow) },
      { label: "Temporal contribution", value: formatValue(contributions.temporal) },
      { label: "Graph contribution", value: formatValue(contributions.graph) },
      { label: "Executed levels", value: formatList(fusion.executed_levels) },
      { label: "Skipped levels", value: formatList(fusion.skipped_levels) },
      ...(kpis || []),
    ],
    rawMetadata: fusion,
    visualLevel: getAnomalyVisualLevel(
      stringValue(fusion.anomaly_type),
      stringValue(fusion.final_severity),
    ),
  };
}

function applyRoutingView(stages: WorkflowStage[]) {
  const stageById = toStageMap(stages);
  const event = stageById.get("event");
  const flow = stageById.get("flow");
  const temporal = stageById.get("temporal");

  const eventContinues = normalizeDecision(event?.decisionNextLevel) === "flow";
  const flowContinues = eventContinues && normalizeDecision(flow?.decisionNextLevel) === "temporal";
  const temporalContinues = flowContinues && normalizeDecision(temporal?.decisionNextLevel) === "graph";

  return stages.map((stage) => {
    if (stage.id === "flow" && !eventContinues) return skippedByPrevious(stage);
    if (stage.id === "temporal" && !flowContinues) return skippedByPrevious(stage);
    if (stage.id === "graph" && !temporalContinues) return skippedByPrevious(stage);
    if (stage.id === "graph" && !stage.decisionNextLevel) {
      return { ...stage, decisionNextLevel: "end_analysis", decision: "End Analysis" };
    }
    return stage;
  });
}

function skippedByPrevious(stage: WorkflowStage): WorkflowStage {
  const reason = "Previous level ended the multi-level analysis.";
  return {
    ...stage,
    status: "skipped",
    decision: "End Analysis",
    summary: reason,
    decisionNextLevel: "end_analysis",
    details: [
      { label: "Executed", value: "false" },
      { label: "Decision", value: "End Analysis" },
      { label: "Decision reason", value: reason },
      { label: "Routing trigger", value: "previous_level_end" },
      { label: "Original status", value: stage.status },
    ],
    metrics: undefined,
  };
}

function buildWorkflowKpis(results: AiResult[]): Record<string, DetailEntry[]> {
  const population = uniqueEventResults(results);
  const traces = population.map((item) => {
    const metadata = workflowMetadata(item);
    const analysisTrace = asRecord(metadata.analysis_trace);
    return {
      item,
      event: asRecord(analysisTrace.event),
      flow: asRecord(analysisTrace.flow),
      temporal: asRecord(analysisTrace.temporal),
      graph: asRecord(analysisTrace.graph),
      fusion: asRecord(metadata.risk_fusion),
      recommendation: asRecord(metadata.recommendation_decision),
    };
  });
  const eventExecuted = traces.filter(({ event }) => event.executed === true);
  const eventAnomalies = eventExecuted.filter(({ event }) => event.anomaly_detected === true);
  const flowExecuted = traces.filter(({ flow }) => flow.executed === true);
  const temporalExecuted = traces.filter(({ temporal }) => temporal.executed === true);
  const graphExecuted = traces.filter(({ graph }) => graph.executed === true);
  const degradedFlows = new Set(
    traces
      .filter(({ flow }) => flow.anomaly_detected === true || (numberValue(flow.risk_contribution) || 0) > 0)
      .map(({ item }) => item.flow_code)
      .filter((value): value is string => Boolean(value)),
  );
  const fusionScores = traces
    .map(({ fusion }) => numberValue(fusion.final_risk_score))
    .filter((value): value is number => value !== null);
  const generatedRecommendations = traces.filter(({ item, recommendation }) =>
    recommendation.generated === true
    || Boolean(item.recommendation && item.recommendation !== "No action required"),
  ).length;
  const pendingReview = traces.filter(({ item, event, flow, temporal, graph }) =>
    (event.anomaly_detected === true || flow.anomaly_detected === true || temporal.anomaly_detected === true || graph.anomaly_detected === true)
    && (!item.validation_status || ["unverified", "pending_review", "partial"].includes(item.validation_status)),
  );

  return {
    event: [
      { label: "Executed count", value: String(eventExecuted.length) },
      { label: "Anomaly count", value: String(eventAnomalies.length) },
      { label: "Normal count", value: String(eventExecuted.length - eventAnomalies.length) },
    ],
    flow: [
      { label: "Executed count", value: String(flowExecuted.length) },
      { label: "Skipped count", value: String(traces.filter(({ flow }) => flow.status === "skipped").length) },
      { label: "Degraded flows", value: String(degradedFlows.size) },
    ],
    temporal: [
      { label: "Executed count", value: String(temporalExecuted.length) },
      { label: "Skipped count", value: String(traces.filter(({ temporal }) => temporal.status === "skipped").length) },
      { label: "Warming up count", value: String(traces.filter(({ temporal }) => isTemporalWarmingUp(temporal.status, stringValue(temporal.skip_reason) || stringValue(temporal.reason))).length) },
    ],
    graph: [
      { label: "Executed count", value: String(graphExecuted.length) },
      { label: "Skipped count", value: String(traces.filter(({ graph }) => graph.status === "skipped").length) },
      { label: "Warming up count", value: String(traces.filter(({ graph }) => isGraphWarmingUp(graph.status, stringValue(graph.skip_reason) || stringValue(graph.reason))).length) },
    ],
    fusion: [
      { label: "Average risk", value: fusionScores.length ? averageValue(fusionScores).toFixed(0) : "0" },
      { label: "High risk count", value: String(traces.filter(({ fusion }) => fusion.final_severity === "high").length) },
      { label: "Critical risk count", value: String(traces.filter(({ fusion }) => fusion.final_severity === "critical").length) },
    ],
    recommendation: [
      { label: "Recommendations generated", value: String(generatedRecommendations) },
      { label: "No action required", value: String(Math.max(0, traces.length - generatedRecommendations)) },
    ],
    validation: [
      { label: "Pending review count", value: String(pendingReview.length) },
      {
        label: "Needs investigation count",
        value: String(pendingReview.filter(({ item }) =>
          ["partial", "needs_investigation"].includes(item.validation_status || ""),
        ).length),
      },
    ],
  };
}

function uniqueEventResults(results: AiResult[]) {
  const selected = new Map<string, AiResult>();
  results
    .filter(hasEventAnalysisTrace)
    .forEach((result) => {
      const key = result.source_event_id || result.id;
      const current = selected.get(key);
      const resultLevel = stringValue(asRecord(result.metadata).analysis_level);
      const currentLevel = stringValue(asRecord(current?.metadata).analysis_level);
      if (!current || (resultLevel === "event" && currentLevel !== "event")) {
        selected.set(key, result);
      }
    });
  return [...selected.values()];
}

function levelMetrics(id: "event" | "flow" | "temporal" | "graph", trace: Record<string, unknown>) {
  const metrics = asRecord(trace.metrics);
  if (id === "event") return undefined;
  if (id === "flow") return metrics;
  if (id === "temporal") {
    return pickMetrics(metrics, [
      "event_count",
      "anomaly_count",
      "avg_latency_ms",
      "latency_slope",
      "error_rate_trend",
      "sla_breach_trend",
      "dominant_anomaly_type",
      "pattern_repetition_score",
    ]);
  }
  return pickMetrics(metrics, [
    "nodes_count",
    "edges_count",
    "impacted_producers_count",
    "impacted_consumers_count",
    "impacted_apis_count",
    "impacted_flows_count",
    "shared_provider_score",
    "cascade_risk_score",
    "dependency_hotspot_score",
    "propagation_depth",
    "dominant_impacted_node",
    "dominant_anomaly_type",
  ]);
}

function validationStatus(
  result: AiResult,
  triageDecision: Record<string, unknown>,
  anomalyDetected: boolean,
): WorkflowStepStatus {
  const triageStatus = stringValue(triageDecision.status);
  if (triageStatus === "AUTO_DISMISSED" || triageStatus === "auto_dismissed") return "skipped";
  if (triageStatus === "AUTO_CONFIRMED" || triageStatus === "auto_confirmed") return "success";
  if (!anomalyDetected) return "skipped";
  if (isReviewed(result.validation_status)) return "success";
  return "pending";
}

function validationDecision(
  result: AiResult,
  triageDecision: Record<string, unknown>,
  anomalyDetected: boolean,
) {
  const triageStatus = stringValue(triageDecision.status);
  if (triageStatus) return triageStatus;
  if (!anomalyDetected) return "No review";
  return result.validation_status || "pending_review";
}

function reviewSummary(
  result: AiResult,
  triageDecision: Record<string, unknown>,
  anomalyDetected: boolean,
) {
  const triageStatus = stringValue(triageDecision.status);
  const triageSource = stringValue(triageDecision.source);
  if (triageStatus) return `${triageStatus}${triageSource ? ` via ${triageSource}` : ""}.`;
  if (!anomalyDetected) return "No anomaly requires human validation.";
  if (isReviewed(result.validation_status)) return `Validation completed: ${result.validation_status}.`;
  return "Waiting for supervisor review.";
}

function decisionLabel(value: string) {
  if (value === "flow") return "to Flow";
  if (value === "temporal") return "to Temporal";
  if (value === "graph") return "to Graph";
  return "End Analysis";
}

function legacyRoutingTrigger(trace: Record<string, unknown>, metadata: Record<string, unknown>) {
  if (stringValue(trace.decision_next_level) !== "flow") return "NONE";
  if (trace.anomaly_detected === true) return "EVENT_ANOMALY";
  if ((numberValue(trace.risk_contribution) || 0) >= 40) return "RISK_THRESHOLD";
  if (["high", "critical"].includes(stringValue(metadata.flow_criticality))) return "FLOW_CRITICALITY";
  if (["high", "critical"].includes(stringValue(metadata.api_criticality))) return "API_CRITICALITY";
  return "MANUAL_POLICY";
}

function normalizeDecision(value: unknown) {
  const normalized = stringValue(value).trim().toLowerCase();
  if (["flow", "temporal", "graph"].includes(normalized)) return normalized;
  if (["stop", "end", "end_analysis", "end analysis", "none"].includes(normalized)) return "end_analysis";
  return normalized;
}

function isFlowWarmingUp(status: unknown, reason: string) {
  const normalized = reason.toLowerCase();
  return status === "warming_up"
    || normalized.includes("insufficient flow window data")
    || normalized.includes("collecting flow window data");
}

function isTemporalWarmingUp(status: unknown, reason: string) {
  const normalized = reason.toLowerCase();
  return status === "warming_up"
    || normalized.includes("insufficient temporal window data")
    || normalized.includes("collecting temporal window data");
}

function isGraphWarmingUp(status: unknown, reason: string) {
  const normalized = reason.toLowerCase();
  return status === "warming_up"
    || normalized.includes("insufficient graph window data")
    || normalized.includes("collecting graph dependency window data");
}

function Detail({ label, value }: DetailEntry) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function detailValue(stage: WorkflowStage, label: string) {
  return stage.details.find((entry) => entry.label === label)?.value || "";
}

function toStageMap(stages: WorkflowStage[]) {
  return new Map(stages.map((stage) => [stage.id, stage]));
}

function statusValue(value: unknown, fallback: WorkflowStepStatus = "unavailable"): WorkflowStepStatus {
  const candidate = String(value);
  return ["success", "warning", "failed", "skipped", "warming_up", "pending", "unavailable"].includes(candidate)
    ? candidate as WorkflowStepStatus
    : fallback;
}

function averageValue(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function isReviewed(status: string | null | undefined) {
  return Boolean(status && !["unverified", "pending_review", "partial"].includes(status));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function workflowMetadata(result: AiResult | null | undefined) {
  const metadata = asRecord(result?.metadata);
  const nested = asRecord(metadata.workflow_metadata);
  return Object.keys(nested).length > 0
    ? { ...metadata, ...nested }
    : metadata;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickMetrics(metrics: Record<string, unknown>, keys: string[]) {
  return keys.reduce<Record<string, unknown>>((selected, key) => {
    if (metrics[key] !== undefined && metrics[key] !== null && metrics[key] !== "") {
      selected[key] = metrics[key];
    }
    return selected;
  }, {});
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "unavailable";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function formatConfidence(value: unknown) {
  const numeric = numberValue(value);
  if (numeric === null) return "unavailable";
  return numeric <= 1 ? `${Math.round(numeric * 100)}%` : `${Math.round(numeric)}%`;
}

function formatList(value: unknown) {
  return Array.isArray(value) && value.length ? value.join(", ") : "unavailable";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR");
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
