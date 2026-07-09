"use client";

import { useEffect, useMemo, useState } from "react";
import { getAnomalyVisualLevel } from "@/lib/anomaly-visual";
import type {
  AnalysisTraceStatus,
  AnalysisLevelTrace,
  AnalysisTrace,
  FlowAnalysisMetrics,
  FlowAnalysisTrace,
  GraphAnalysisMetrics,
  GraphAnalysisTrace,
  RiskFusionMetadata,
  TemporalAnalysisMetrics,
  TemporalAnalysisTrace,
  WorkflowItem,
  WorkflowStepStatus,
} from "@/types/workflow";

type DetailEntry = {
  label: string;
  value: string;
};

type AnalysisNode = {
  id: string;
  label: string;
  status: WorkflowStepStatus;
  timestamp: string | null;
  summary: string;
  details: DetailEntry[];
  metrics?: FlowAnalysisMetrics | TemporalAnalysisMetrics | GraphAnalysisMetrics;
};

export function AIAnalysisWorkflow({ item }: { item: WorkflowItem }) {
  const [selectedId, setSelectedId] = useState("event");
  const [validationStatus, setValidationStatus] = useState(item.validation_status);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationPending, setValidationPending] = useState(false);

  useEffect(() => {
    setSelectedId("event");
    setValidationStatus(item.validation_status);
    setValidationError(null);
  }, [item.id, item.validation_status]);

  const nodes = useMemo(
    () => buildAnalysisNodes(item, validationStatus),
    [item, validationStatus],
  );
  const selected = nodes.find((node) => node.id === selectedId) || nodes[0];

  async function validate(status: "confirmed" | "false_positive" | "partial") {
    const resultId = item.raw.aiResult?.id;
    if (!resultId) {
      setValidationError("AI result unavailable for validation.");
      return;
    }
    setValidationPending(true);
    setValidationError(null);
    try {
      const response = await fetch(`/api/ai/results/${resultId}/validation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          validation_status: status,
          validation_comment:
            status === "confirmed"
              ? "Validated as true positive from AI Analysis Workflow"
              : status === "false_positive"
                ? "Marked as false positive from AI Analysis Workflow"
                : "Needs further investigation",
          validated_by: "supervisor",
        }),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || `Validation failed (${response.status})`);
      }
      setValidationStatus(status);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Validation failed");
    } finally {
      setValidationPending(false);
    }
  }

  const anomalyDetected = workflowAnomalyDetected(item);
  const traceAvailable = hasEventAnalysisTrace(item.raw.aiResult);
  const hasResult = Boolean(item.raw.aiResult?.id);

  return (
    <div className="aiAnalysisBranch">
      <div className="aiAnalysisTraceHeader">
        {hasResult && (
          <span className={`aiAnalysisTraceBadge ${traceAvailable ? "available" : "legacy"}`}>
            {traceAvailable ? "Trace available" : "Legacy result"}
          </span>
        )}
        {!traceAvailable && (
          <p>
            {hasResult
              ? "Legacy AI result - analysis trace not available. No AI analysis trace available yet. Generate new Kafka events to see the real AI workflow."
              : "No AI analysis trace available yet. Generate new Kafka events to see the real AI workflow."}
          </p>
        )}
      </div>

      <div className="aiAnalysisBranchMeta">
        <div><span>AI result</span><strong>{item.raw.aiResult?.id || "unavailable"}</strong></div>
        <div>
          <span>Decision</span>
          <strong className={`anomalyVisualBadge ${getAnomalyVisualLevel(item.anomaly_type, item.severity)}`}>
            {item.anomaly_type || "NORMAL"}
          </strong>
        </div>
        <div><span>Risk</span><strong>{item.risk_score === null ? "unavailable" : `${item.risk_score}/100`}</strong></div>
        <div><span>Validation</span><strong>{validationStatusForDisplay(anomalyDetected, validationStatus)}</strong></div>
      </div>

      <div className="aiAnalysisBranchBody">
        <div className="aiAnalysisTimeline" role="list" aria-label="AI analysis workflow">
          {nodes.map((node, index) => (
            <button
            className={`aiAnalysisNode ${node.status} ${["event", "flow", "temporal", "graph"].includes(node.id) ? `anomalyVisualStage ${getAnomalyVisualLevel(item.anomaly_type, item.severity)}` : ""} ${selected.id === node.id ? "selected" : ""}`}
              key={node.id}
              onClick={() => setSelectedId(node.id)}
              role="listitem"
              type="button"
            >
              <span className="aiAnalysisNodeIndex">{String(index + 1).padStart(2, "0")}</span>
              <span className="aiAnalysisNodeContent">
                <span className="aiAnalysisNodeTop">
                  <strong>{node.label}</strong>
                  <b>{node.status}</b>
                </span>
                <small>{node.summary}</small>
                <em>{node.timestamp ? formatTimestamp(node.timestamp) : "timestamp unavailable"}</em>
              </span>
            </button>
          ))}
        </div>

        <aside className="aiAnalysisDetail">
          <span className="sectionEyebrow">Selected AI stage</span>
          <h3>{selected.label}</h3>
          <p>{selected.summary}</p>

          <div className="aiAnalysisDetailGrid">
            <Detail label="Status" value={selected.status} />
            <Detail
              label="Timestamp"
              value={selected.timestamp ? formatTimestamp(selected.timestamp) : "timestamp unavailable"}
            />
            {selected.details.map((entry) => (
              <Detail key={entry.label} label={entry.label} value={entry.value} />
            ))}
          </div>

          {selected.metrics && Object.keys(selected.metrics).length > 0 && (
            <section className="aiAnalysisMetrics">
              <h4>{selected.id === "graph" ? "Graph dependency metrics" : selected.id === "temporal" ? "Temporal window metrics" : "Flow window metrics"}</h4>
              <div className="aiAnalysisMetricsGrid">
                {Object.entries(selected.metrics).map(([key, value]) => (
                  <Detail
                    key={key}
                    label={humanize(key)}
                    value={formatMetric(key, value)}
                  />
                ))}
              </div>
            </section>
          )}

          {selected.id === "recommendation" && (
            <section className="aiAnalysisNarrative">
              <h4>Operational recommendation</h4>
              <p>{item.recommendation || "Recommendation unavailable."}</p>
            </section>
          )}

          {selected.id === "human_validation" && anomalyDetected && (
            <section className="aiAnalysisValidation">
              <h4>Human validation</h4>
              <div>
                <button disabled={validationPending} onClick={() => validate("confirmed")} type="button">
                  Validate True Positive
                </button>
                <button disabled={validationPending} onClick={() => validate("false_positive")} type="button">
                  Mark False Positive
                </button>
                <button disabled={validationPending} onClick={() => validate("partial")} type="button">
                  Needs Investigation
                </button>
              </div>
              {validationError && <p className="workflowNotice">{validationError}</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function buildAnalysisNodes(item: WorkflowItem, validationStatus: string): AnalysisNode[] {
  const result = item.raw.aiResult;
  const metadata = asRecord(result?.metadata);
  const trace = readAnalysisTrace(metadata.analysis_trace);
  const eventTrace = trace.event || {};
  const flowTrace = trace.flow || {};
  const temporalTrace = trace.temporal || {};
  const graphTrace = trace.graph || {};
  const riskFusion = readRiskFusion(metadata.risk_fusion);
  const recommendationDecision = asRecord(metadata.recommendation_decision);
  const hasResult = Boolean(result?.id);
  const traceAvailable = hasEventAnalysisTrace(result);
  const anomalyDetected = workflowAnomalyDetected(item);

  return [
    {
      id: "kafka_received",
      label: "Kafka Event Received",
      status: item.raw.id ? "success" : "unavailable",
      timestamp: item.timestamp || null,
      summary: item.raw.id
        ? `${item.source === "api_call" ? "API call" : "Audit event"} received from the live Kafka-backed stream.`
        : "Kafka source event unavailable.",
      details: [
        { label: "Event ID", value: item.event_id || "unavailable" },
        { label: "Source", value: item.source || "unavailable" },
        { label: "Flow", value: item.flow_code || "unavailable" },
      ],
    },
    {
      id: "fastapi_consumer",
      label: "FastAPI Kafka Consumer",
      status: hasResult ? "success" : "unavailable",
      timestamp: null,
      summary: hasResult
        ? "An ai_analysis_results entry proves that the FastAPI Kafka consumer processed the event."
        : "FastAPI consumer evidence unavailable.",
      details: [
        { label: "AI result ID", value: result?.id || "unavailable" },
        { label: "Correlation", value: item.raw.correlation_id || "unavailable" },
      ],
    },
    traceAvailable
      ? levelNode("event", "Event-Level Analysis", eventTrace)
      : legacyLevelNode("event", "Event-Level Analysis"),
    traceAvailable
      ? levelNode("flow", "Flow-Level Analysis", flowTrace, flowTrace.metrics ?? undefined)
      : legacyLevelNode("flow", "Flow-Level Analysis"),
    traceAvailable
      ? levelNode("temporal", "Temporal-Level Analysis", temporalTrace, temporalTrace.metrics ?? undefined)
      : legacyLevelNode("temporal", "Temporal-Level Analysis"),
    traceAvailable
      ? levelNode("graph", "Graph-Level Analysis", graphTrace, graphTrace.metrics ?? undefined)
      : legacyLevelNode("graph", "Graph-Level Analysis"),
    riskFusionNode(riskFusion),
    {
      id: "stored",
      label: "AI Result Stored",
      status: hasResult ? "success" : "unavailable",
      timestamp: result?.created_at || result?.detected_at || null,
      summary: hasResult
        ? "The analysis result is persisted in ai_analysis_results."
        : "Persisted AI result unavailable.",
      details: [
        { label: "Result ID", value: result?.id || "unavailable" },
        { label: "Analysis type", value: result?.analysis_type || "unavailable" },
      ],
    },
    {
      id: "recommendation",
      label: "Recommendation",
      status: item.recommendation
        ? "success"
        : recommendationDecision.generated === false
          ? "skipped"
          : "unavailable",
      timestamp: null,
      summary:
        stringValue(recommendationDecision.reason)
        || (item.recommendation ? "Operational recommendation generated." : "Recommendation unavailable."),
      details: [
        { label: "Generated", value: item.recommendation ? "true" : recommendationDecision.generated === false ? "false" : "unavailable" },
        { label: "Recommendation", value: item.recommendation || "unavailable" },
      ],
    },
    humanValidationNode(item, validationStatus, anomalyDetected),
  ];
}

function legacyLevelNode(id: "event" | "flow" | "temporal" | "graph", label: string): AnalysisNode {
  return {
    id,
    label,
    status: "legacy",
    timestamp: null,
    summary: "Legacy AI result - analysis trace not available",
    details: [
      { label: "Trace status", value: "Legacy result" },
      { label: "Analysis trace", value: "not available" },
    ],
  };
}

function levelNode(
  id: "event" | "flow" | "temporal" | "graph",
  label: string,
  trace: AnalysisLevelTrace,
  metrics?: FlowAnalysisMetrics | TemporalAnalysisMetrics | GraphAnalysisMetrics,
): AnalysisNode {
  const rawReason = stringValue(trace.skip_reason)
    || stringValue(trace.reason)
    || stringValue(trace.decision_reason);
  const status = id === "temporal" && isTemporalWarmingUp(trace.status, rawReason)
    ? "warming_up"
    : id === "graph" && isGraphWarmingUp(trace.status, rawReason)
      ? "warming_up"
    : validStatus(trace.status) || "unavailable";
  const executed = typeof trace.executed === "boolean" ? trace.executed : null;
  const reason = status === "warming_up"
    ? id === "graph" ? "Collecting graph dependency window data" : "Collecting temporal window data"
    : rawReason || "Analysis metadata unavailable.";
  const details: DetailEntry[] = [
    { label: "Executed", value: executed === null ? "unavailable" : executed ? "true" : "false" },
    { label: "Selected model", value: trace.selected_model_id || "unavailable" },
    { label: "Model name", value: trace.selected_model_name || "unavailable" },
    { label: "Model version", value: trace.selected_model_version || "unavailable" },
    {
      label: "Anomaly detected",
      value: typeof trace.anomaly_detected === "boolean"
        ? trace.anomaly_detected ? "true" : "false"
        : "unavailable",
    },
    { label: "Anomaly type", value: trace.anomaly_type || "unavailable" },
    { label: "Confidence", value: formatConfidence(numberValue(trace.confidence)) },
    {
      label: "Risk contribution",
      value: numberValue(trace.risk_contribution) === null
        ? "unavailable"
        : String(numberValue(trace.risk_contribution)),
    },
    { label: "Next level", value: trace.decision_next_level || "unavailable" },
    { label: "Decision reason", value: trace.decision_reason || "unavailable" },
  ];
  if (id === "flow" || id === "temporal" || id === "graph") {
    const windowTrace = trace as AnalysisLevelTrace & { window?: string };
    details.splice(1, 0, { label: "Window", value: windowTrace.window || "unavailable" });
  }
  return {
    id,
    label,
    status,
    timestamp: null,
    summary: reason,
    details,
    metrics: metrics && Object.keys(metrics).length > 0 ? metrics : undefined,
  };
}

function riskFusionNode(riskFusion: RiskFusionMetadata): AnalysisNode {
  const contributions = asRecord(riskFusion.contributions);
  const executedLevels = stringArray(riskFusion.executed_levels);
  const skippedLevels = stringArray(riskFusion.skipped_levels);
  const hasFusion = numberValue(riskFusion.final_risk_score) !== null || riskFusion.status === "success";
  return {
    id: "risk_fusion",
    label: "Risk Fusion",
    status: hasFusion ? validStatus(riskFusion.status) || "success" : "unavailable",
    timestamp: null,
    summary: stringValue(riskFusion.fusion_reason) || "Risk fusion metadata unavailable.",
    details: [
      { label: "Final risk score", value: formatNumber(riskFusion.final_risk_score) },
      { label: "Final severity", value: stringValue(riskFusion.final_severity) || "unavailable" },
      { label: "Event contribution", value: formatNumber(contributions.event) },
      { label: "Flow contribution", value: formatNumber(contributions.flow) },
      { label: "Temporal contribution", value: formatNumber(contributions.temporal) },
      { label: "Graph contribution", value: formatNumber(contributions.graph) },
      { label: "Executed levels", value: executedLevels.length ? executedLevels.join(", ") : "unavailable" },
      { label: "Skipped levels", value: skippedLevels.length ? skippedLevels.join(", ") : "none" },
    ],
  };
}

function humanValidationNode(
  item: WorkflowItem,
  status: string,
  anomalyDetected: boolean,
): AnalysisNode {
  const effectiveStatus = validationStatusForDisplay(anomalyDetected, status);
  const completed = ["confirmed", "validated_true_positive", "false_positive"].includes(effectiveStatus);
  return {
    id: "human_validation",
    label: "Review Queue",
    status: !anomalyDetected ? "skipped" : completed ? "success" : "pending",
    timestamp: item.raw.aiResult?.validated_at || null,
    summary: !anomalyDetected
      ? "No anomaly requires human validation."
      : completed
        ? `Human validation completed: ${effectiveStatus}.`
        : "Anomaly is waiting for supervisor review.",
    details: [
      { label: "Validation status", value: effectiveStatus },
      { label: "Validated by", value: item.raw.aiResult?.validated_by || "unavailable" },
      { label: "Validation source", value: item.raw.aiResult?.validation_source || "unavailable" },
      { label: "Comment", value: item.raw.aiResult?.validation_comment || "unavailable" },
    ],
  };
}

function workflowAnomalyDetected(item: WorkflowItem) {
  const metadata = asRecord(item.raw.aiResult?.metadata);
  const trace = asRecord(metadata.analysis_trace);
  const eventTrace = asRecord(trace.event);
  const flowTrace = asRecord(trace.flow);
  const temporalTrace = asRecord(trace.temporal);
  if (
    eventTrace.anomaly_detected === true
    || flowTrace.anomaly_detected === true
    || temporalTrace.anomaly_detected === true
  ) return true;
  if (metadata.anomaly_detected === true) return true;
  return Boolean(
    item.anomaly_type
    && !["NORMAL", "FLOW_NORMAL"].includes(item.anomaly_type),
  );
}

function hasEventAnalysisTrace(result: WorkflowItem["raw"]["aiResult"]) {
  const metadata = asRecord(result?.metadata);
  const analysisTrace = asRecord(metadata.analysis_trace);
  return Object.keys(asRecord(analysisTrace.event)).length > 0;
}

function validationStatusForDisplay(anomalyDetected: boolean, status: string) {
  if (!anomalyDetected) return "skipped";
  if (!status || ["unverified", "pending_review"].includes(status)) return "pending_review";
  return status;
}

function Detail({ label, value }: DetailEntry) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readAnalysisTrace(value: unknown): AnalysisTrace {
  const raw = asRecord(value);
  return {
    event: readLevelTrace(raw.event),
    flow: readFlowTrace(raw.flow),
    temporal: readTemporalTrace(raw.temporal),
    graph: readGraphTrace(raw.graph),
  };
}

function readLevelTrace(value: unknown): AnalysisLevelTrace {
  const raw = asRecord(value);
  return {
    status: validAnalysisStatus(raw.status),
    executed: typeof raw.executed === "boolean" ? raw.executed : undefined,
    reason: nullableString(raw.reason),
    skip_reason: nullableString(raw.skip_reason),
    selected_model_id: nullableString(raw.selected_model_id),
    selected_model_name: nullableString(raw.selected_model_name),
    selected_model_version: nullableString(raw.selected_model_version),
    anomaly_detected: typeof raw.anomaly_detected === "boolean" ? raw.anomaly_detected : undefined,
    anomaly_type: nullableString(raw.anomaly_type),
    confidence: numberValue(raw.confidence),
    risk_contribution: numberValue(raw.risk_contribution),
    decision_next_level: validNextLevel(raw.decision_next_level),
    decision_reason: nullableString(raw.decision_reason),
  };
}

function readFlowTrace(value: unknown): FlowAnalysisTrace {
  const raw = asRecord(value);
  return {
    ...readLevelTrace(value),
    window: nullableString(raw.window),
    metrics: asRecord(raw.metrics),
  };
}

function readTemporalTrace(value: unknown): TemporalAnalysisTrace {
  const raw = asRecord(value);
  return {
    ...readLevelTrace(value),
    window: nullableString(raw.window),
    metrics: pickMetrics(asRecord(raw.metrics), [
      "event_count",
      "anomaly_count",
      "avg_latency_ms",
      "latency_slope",
      "error_rate_trend",
      "sla_breach_trend",
      "dominant_anomaly_type",
      "pattern_repetition_score",
    ]),
  };
}

function readGraphTrace(value: unknown): GraphAnalysisTrace {
  const raw = asRecord(value);
  return {
    ...readLevelTrace(value),
    window: nullableString(raw.window),
    metrics: pickMetrics(asRecord(raw.metrics), [
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
    ]),
  };
}

function readRiskFusion(value: unknown): RiskFusionMetadata {
  const raw = asRecord(value);
  const contributions = asRecord(raw.contributions);
  return {
    status: validAnalysisStatus(raw.status),
    final_risk_score: numberValue(raw.final_risk_score),
    final_severity: nullableString(raw.final_severity),
    contributions: {
      event: numberValue(contributions.event),
      flow: numberValue(contributions.flow),
      temporal: numberValue(contributions.temporal),
      graph: numberValue(contributions.graph),
    },
    executed_levels: stringArray(raw.executed_levels),
    skipped_levels: stringArray(raw.skipped_levels),
    fusion_reason: nullableString(raw.fusion_reason),
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validStatus(value: unknown): WorkflowStepStatus | null {
  return ["success", "warning", "failed", "skipped", "warming_up", "pending", "unavailable", "running", "review", "legacy"].includes(String(value))
    ? String(value) as WorkflowStepStatus
    : null;
}

function validAnalysisStatus(value: unknown): AnalysisTraceStatus | undefined {
  return ["success", "warning", "failed", "skipped", "warming_up", "unavailable"].includes(String(value))
    ? String(value) as AnalysisTraceStatus
    : undefined;
}

function validNextLevel(value: unknown): "stop" | "flow" | "temporal" | "graph" | null {
  return ["stop", "flow", "temporal", "graph"].includes(String(value))
    ? String(value) as "stop" | "flow" | "temporal" | "graph"
    : null;
}

function pickMetrics(
  metrics: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return keys.reduce<Record<string, unknown>>((selected, key) => {
    if (metrics[key] !== undefined && metrics[key] !== null && metrics[key] !== "") {
      selected[key] = metrics[key];
    }
    return selected;
  }, {});
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

function formatConfidence(value: number | null) {
  if (value === null) return "unavailable";
  return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`;
}

function formatNumber(value: unknown) {
  const number = numberValue(value);
  return number === null ? "unavailable" : String(number);
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function formatMetric(key: string, value: unknown) {
  if (value === null || value === undefined) return "unavailable";
  if (typeof value === "number") {
    if (key.endsWith("_rate") || key.endsWith("_share")) {
      return `${Math.round(value * 100)}%`;
    }
    if (key.endsWith("_ms")) return `${Math.round(value)} ms`;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
      });
}
