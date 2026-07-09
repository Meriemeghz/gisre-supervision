"use client";

import { useEffect, useState } from "react";
import type {
  WorkflowConnectionStatus,
  WorkflowItem,
  WorkflowLiveEvent,
  WorkflowStep,
  WorkflowStepStatus,
} from "@/types/workflow";

const WORKFLOW_STEP_NAMES: Array<{ id: WorkflowStep["id"]; name: string }> = [
  { id: "kafka_received", name: "Kafka Event Received" },
  { id: "backend_ingestion", name: "Backend Ingestion" },
  { id: "postgres_persistence", name: "PostgreSQL Persistence" },
  { id: "ai_analysis", name: "AI Layer Analysis" },
  { id: "anomaly_detection", name: "Anomaly Detection" },
  { id: "risk_scoring", name: "Risk Scoring" },
  { id: "incident_creation", name: "Incident Creation" },
  { id: "recommendation_generation", name: "Recommendation Generation" },
  { id: "human_review", name: "Human Review / Validation" },
  { id: "resolution_closure", name: "Resolution / Closure" },
];

export function useLiveWorkflow() {
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<WorkflowConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/live/events");
    setConnectionStatus("connecting");

    source.addEventListener("open", () => {
      setConnectionStatus("live");
      setError(null);
    });

    source.addEventListener("snapshot", (message) => {
      const payload = JSON.parse((message as MessageEvent).data) as WorkflowLiveEvent[];
      const now = Date.now();
      setItems(payload.map((item) => buildWorkflowItem({ ...item, receivedAt: now })).slice(0, 80));
      if (payload.length) setLastEventAt(now);
    });

    source.addEventListener("live_event", (message) => {
      const payload = JSON.parse((message as MessageEvent).data) as WorkflowLiveEvent;
      const receivedAt = Date.now();
      const workflowItem = buildWorkflowItem({ ...payload, receivedAt });
      setLastEventAt(receivedAt);
      setItems((current) => {
        const deduped = current.filter((item) => item.id !== workflowItem.id);
        return [workflowItem, ...deduped].slice(0, 120);
      });
    });

    source.addEventListener("stream_error", (message) => {
      const payload = JSON.parse((message as MessageEvent).data) as { message?: string };
      setConnectionStatus("error");
      setError(payload.message || "Realtime workflow stream unavailable");
    });

    source.onerror = () => {
      setConnectionStatus("error");
      setError("SSE disconnected. Waiting for the realtime stream to recover.");
    };

    return () => source.close();
  }, []);

  return {
    items,
    liveItems: items,
    connectionStatus,
    error,
    lastEventAt,
    usingFallback: items.length === 0,
  };
}

function buildWorkflowItem(event: WorkflowLiveEvent): WorkflowItem {
  const aiResult = event.aiResult;
  const riskScore = aiResult?.risk_score ?? null;
  const validationStatus = validationStatusFrom(aiResult);
  const status = itemStatus(event, validationStatus);
  const timestamp = event.timestamp;
  const steps = buildSteps(event, validationStatus);

  return {
    id: `${event.source}-${event.id}`,
    event_id: event.id,
    source: event.source,
    api_name: event.api_code,
    flow_code: event.flow_code,
    consumer_code: event.consumer,
    producer_code: event.provider,
    anomaly_type: aiResult?.detected_anomaly_type || event.anomalyType,
    risk_score: riskScore,
    severity: aiResult?.severity || severityFromEvent(event),
    confidence: aiResult?.confidence ?? null,
    explanation: aiResult?.explanation || eventExplanation(event),
    recommendation: aiResult?.recommendation || null,
    validation_status: validationStatus,
    timestamp,
    status,
    steps,
    raw: event,
  };
}

function buildSteps(event: WorkflowLiveEvent, validationStatus: string): WorkflowStep[] {
  const aiResult = event.aiResult;
  const baseTime = parseDate(event.timestamp)?.getTime() || Date.now();
  const hasAi = Boolean(aiResult);
  const hasAnomaly = event.state !== "NORMAL" || Boolean(aiResult);
  const hasIncident = Boolean(aiResult && (aiResult.severity === "critical" || aiResult.risk_score >= 70));
  const hasRecommendation = Boolean(aiResult?.recommendation);
  const reviewed = !["unverified", "pending_review"].includes(validationStatus);

  const stateByStep: Record<WorkflowStep["id"], { status: WorkflowStepStatus; message: string; source: string }> = {
    kafka_received: {
      status: "success",
      message: `${event.source === "api_call" ? "API call" : "Audit"} event received from Kafka stream.`,
      source: "Kafka topics gisre.api.calls / gisre.audit.events",
    },
    backend_ingestion: {
      status: "success",
      message: "Backend consumer ingested and normalized the event.",
      source: "NestJS backend Kafka consumer",
    },
    postgres_persistence: {
      status: "success",
      message: "Event is available from PostgreSQL-backed event endpoints.",
      source: event.source === "api_call" ? "/events/api-calls" : "/events/audit-events",
    },
    ai_analysis: {
      status: hasAi ? "success" : hasAnomaly ? "running" : "pending",
      message: hasAi ? "AI result linked to this event." : hasAnomaly ? "Waiting for AI enrichment." : "No AI anomaly result linked.",
      source: "/ai/results",
    },
    anomaly_detection: {
      status: hasAi || hasAnomaly ? event.state === "CRITICAL" ? "warning" : "success" : "pending",
      message: hasAnomaly ? `${aiResult?.detected_anomaly_type || event.anomalyType || "Behaviour signal"} detected.` : "No anomaly detected.",
      source: hasAi ? "AI layer detection result" : "Realtime event state",
    },
    risk_scoring: {
      status: riskStatus(aiResult?.risk_score ?? null),
      message: aiResult ? `Risk score ${aiResult.risk_score}/100 with severity ${aiResult.severity}.` : "Risk score pending until AI result is linked.",
      source: "AI scoring service",
    },
    incident_creation: {
      status: hasIncident ? "warning" : hasAnomaly ? "running" : "pending",
      message: hasIncident ? "Critical or high-risk anomaly eligible for incident tracking." : hasAnomaly ? "Anomaly observed; incident threshold not reached." : "No incident needed.",
      source: "Incident derivation from ai_analysis_results",
    },
    recommendation_generation: {
      status: hasRecommendation ? "success" : hasAi ? "running" : "pending",
      message: hasRecommendation ? "Operational recommendation generated." : "Recommendation unavailable for this event yet.",
      source: "Recommendation service",
    },
    human_review: {
      status: reviewed ? "review" : hasAnomaly ? "running" : "pending",
      message: reviewMessage(validationStatus),
      source: "Human validation feedback / ai_analysis_results",
    },
    resolution_closure: {
      status: ["confirmed", "ignored", "false_positive"].includes(validationStatus) ? "success" : "pending",
      message: ["confirmed", "ignored", "false_positive"].includes(validationStatus)
        ? "Review outcome is available for operational closure."
        : "Awaiting review or operational closure.",
      source: "Supervisor workflow",
    },
  };

  return WORKFLOW_STEP_NAMES.map((step, index) => {
    const current = stateByStep[step.id];
    const active = current.status !== "pending";
    return {
      id: step.id,
      name: step.name,
      status: current.status,
      timestamp: active ? new Date(baseTime + index * 180).toISOString() : null,
      durationMs: active ? stepDuration(event, index) : null,
      message: current.message,
      source: current.source,
    };
  });
}

function itemStatus(event: WorkflowLiveEvent, validationStatus: string): WorkflowStepStatus {
  if (validationStatus === "false_positive") return "review";
  if (validationStatus === "confirmed" || validationStatus === "ignored") return "success";
  if (event.state === "CRITICAL") return "warning";
  if (event.state === "WARNING") return "running";
  return "success";
}

function riskStatus(riskScore: number | null): WorkflowStepStatus {
  if (riskScore === null) return "pending";
  if (riskScore >= 80) return "warning";
  if (riskScore >= 45) return "success";
  return "success";
}

function validationStatusFrom(aiResult: WorkflowLiveEvent["aiResult"]) {
  if (typeof aiResult?.validation_status === "string") {
    return aiResult.validation_status;
  }
  const metadata = aiResult?.metadata || {};
  const direct = metadata.validation_status || metadata.human_validation_status || metadata.review_status;
  if (typeof direct === "string") return direct;
  const validation = aiResult?.validation;
  if (validation && typeof validation === "object") {
    const status = validation.validation_status || validation.status || validation.result;
    if (typeof status === "string") return status;
  }
  return aiResult ? "pending_review" : "unverified";
}

function reviewMessage(status: string) {
  if (status === "confirmed") return "Validated as true positive by a supervisor.";
  if (status === "false_positive") return "Marked as false positive by human review.";
  if (status === "partial") return "Partially validated; more context is required.";
  if (status === "ignored") return "Ignored by supervisor.";
  if (status === "pending_review") return "Waiting for human validation.";
  return "No human validation yet.";
}

function severityFromEvent(event: WorkflowLiveEvent) {
  if (event.state === "CRITICAL") return "critical";
  if (event.state === "WARNING") return "medium";
  return "low";
}

function eventExplanation(event: WorkflowLiveEvent) {
  if (event.is_sla_breach) return "SLA latency breach observed on the event.";
  if ((event.status_code || 0) >= 500) return "Server-side error observed during backend ingestion.";
  if ((event.status_code || 0) >= 400) return "Client or access error observed during backend ingestion.";
  return "Realtime event is flowing through the supervision pipeline.";
}

function stepDuration(event: WorkflowLiveEvent, index: number) {
  const latency = event.latency_ms ?? 120;
  if (index <= 2) return Math.max(8, Math.round(latency / 12 + index * 8));
  if (index <= 5) return Math.max(12, Math.round(latency / 8 + index * 11));
  return index >= 8 ? null : Math.max(16, Math.round(latency / 10 + index * 9));
}

function parseDate(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}
