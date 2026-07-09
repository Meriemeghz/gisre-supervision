import type { WorkflowItem, WorkflowStep, WorkflowStepStatus } from "@/types/workflow";
import { getAnomalyVisualLevel } from "@/lib/anomaly-visual";
import { AIAnalysisWorkflow } from "./AIAnalysisWorkflow";

export type WorkflowViewMode = "technical" | "ai_decision" | "ai_analysis";

type DiagramNode = {
  id: string;
  label: string;
  status: WorkflowStepStatus;
  timestamp: string | null;
  durationMs: number | null;
  message: string;
  source: string;
  x: number;
  y: number;
};

type DiagramEdge = {
  id: string;
  from: DiagramNode;
  to: DiagramNode;
  highlighted: boolean;
};

export function WorkflowTimeline({
  item,
  mode,
  onModeChange,
  onSelect,
}: {
  item: WorkflowItem | null;
  mode: WorkflowViewMode;
  onModeChange: (mode: WorkflowViewMode) => void;
  onSelect: () => void;
}) {
  if (!item) {
    return (
      <section className="workflowTimeline empty">
        <p>No workflow selected.</p>
      </section>
    );
  }

  const nodes = mode === "technical" ? technicalNodes(item) : mode === "ai_decision" ? aiDecisionNodes(item) : [];
  const activeIndex = Math.max(0, lastActiveIndex(nodes));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `${node.id}-${nodes[index + 1].id}`,
    from: node,
    to: nodes[index + 1],
    highlighted: index < activeIndex,
  }));

  return (
    <section className="workflowTimeline">
      <div className="workflowTimelineHeader">
        <div>
          <span>{mode === "technical" ? "Technical Pipeline View" : mode === "ai_decision" ? "AI Decision Flow" : "AI Analysis Branch"}</span>
          <h2>{item.flow_code || "Unknown flow"} / {item.api_name || item.source}</h2>
          <p>{mode === "technical" ? "End-to-end supervision processing path for the selected event." : mode === "ai_decision" ? "AI decision path showing detectors, fusion, incidenting and human validation." : "Conditional FastAPI analysis path reconstructed from ai_analysis_results metadata."}</p>
        </div>
        <div className="workflowHeaderActions">
          <div className="workflowViewToggle" role="tablist" aria-label="Workflow view mode">
            <button className={mode === "technical" ? "active" : ""} type="button" onClick={() => onModeChange("technical")}>
              Technical Pipeline
            </button>
            <button className={mode === "ai_decision" ? "active" : ""} type="button" onClick={() => onModeChange("ai_decision")}>
              AI Decision Flow
            </button>
            <button className={mode === "ai_analysis" ? "active" : ""} type="button" onClick={() => onModeChange("ai_analysis")}>
              AI Analysis Branch
            </button>
          </div>
          <button type="button" onClick={onSelect}>Open details</button>
        </div>
      </div>

      {mode === "ai_analysis"
        ? <AIAnalysisWorkflow item={item} />
        : <WorkflowDiagram nodes={nodes} edges={edges} item={item} mode={mode} />}
    </section>
  );
}

function WorkflowDiagram({ nodes, edges, item, mode }: { nodes: DiagramNode[]; edges: DiagramEdge[]; item: WorkflowItem; mode: Exclude<WorkflowViewMode, "ai_analysis"> }) {
  return (
    <div className={`workflowDiagramShell ${mode}`}>
      <div className="workflowDiagramMeta">
        <div>
          <span>Selected trace</span>
          <strong>{item.event_id.slice(0, 12)}</strong>
        </div>
        <div>
          <span>Anomaly</span>
          <strong className={`anomalyVisualBadge ${getAnomalyVisualLevel(item.anomaly_type, item.severity)}`}>
            {item.anomaly_type || "NORMAL"}
          </strong>
        </div>
        <div>
          <span>Risk</span>
          <strong>{item.risk_score === null ? "n/a" : `${item.risk_score}/100`}</strong>
        </div>
        <div>
          <span>Validation</span>
          <strong>{item.validation_status}</strong>
        </div>
      </div>

      <svg className="workflowDiagram" viewBox="0 0 1180 560" role="img" aria-label="Realtime supervision workflow diagram">
        <defs>
          <marker id="workflowArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
          <filter id="workflowNodeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {edges.map((edge) => (
          <g className={`workflowEdge ${edge.highlighted ? "highlighted" : ""} ${edge.from.status}`} key={edge.id}>
            <path d={edgePath(edge.from, edge.to)} markerEnd="url(#workflowArrow)" />
            {edge.highlighted && <path className="workflowEdgePulse" d={edgePath(edge.from, edge.to)} />}
          </g>
        ))}

        {nodes.map((node, index) => (
          <foreignObject
            className={`workflowNodeObject ${node.status} ${index <= lastActiveIndex(nodes) ? "pathActive" : ""}`}
            filter={node.status === "running" || node.status === "warning" ? "url(#workflowNodeGlow)" : undefined}
            height="118"
            key={node.id}
            width="184"
            x={node.x - 92}
            y={node.y - 59}
          >
            <div className={`workflowNode ${node.status}`}>
              <div>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <b>{node.status}</b>
              </div>
              <strong>{node.label}</strong>
              <p>{node.message}</p>
              <footer>
                <small>{node.timestamp ? formatTime(node.timestamp) : "pending"}</small>
                <small>{node.durationMs === null ? "n/a" : `${node.durationMs} ms`}</small>
              </footer>
            </div>
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}

function lastActiveIndex(nodes: DiagramNode[]) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index].status !== "pending") {
      return index;
    }
  }
  return -1;
}

function technicalNodes(item: WorkflowItem): DiagramNode[] {
  const positions = diagramPositions(10);
  return item.steps.map((step, index) => toDiagramNode(step, positions[index]));
}

function aiDecisionNodes(item: WorkflowItem): DiagramNode[] {
  const positions = diagramPositions(12);
  const baseTime = new Date(item.timestamp).getTime();
  const aiLinked = item.risk_score !== null;
  const hasAnomaly = Boolean(item.anomaly_type && item.anomaly_type !== "NORMAL");
  const highRisk = (item.risk_score || 0) >= 70 || item.severity === "critical";
  const reviewed = !["unverified", "pending_review"].includes(item.validation_status);
  const modelId = String(item.raw.aiResult?.metadata?.model_id || item.raw.aiResult?.metadata?.detector || "");

  const specs: Array<Omit<DiagramNode, "x" | "y">> = [
    nodeSpec("kafka", "Kafka", "success", baseTime, 18, "Event received from the Kafka supervision stream.", "gisre.api.calls / gisre.audit.events"),
    nodeSpec("backend", "Backend", "success", baseTime + 120, 24, "Backend consumer normalized the event.", "NestJS ingestion"),
    nodeSpec("postgres", "PostgreSQL", "success", baseTime + 220, 31, "Event is persisted and exposed through existing endpoints.", "api_calls / audit_events"),
    detectorSpec("rules", "Rules Engine", item, modelId, "rules"),
    detectorSpec("isolation", "Isolation Forest", item, modelId, "isolation"),
    detectorSpec("gru", "GRU", item, modelId, "gru"),
    detectorSpec("autoencoder", "Autoencoder", item, modelId, "autoencoder"),
    nodeSpec("fusion", "Risk Fusion", aiLinked ? riskStatus(item.risk_score) : "pending", baseTime + 820, 54, aiLinked ? `Risk fused at ${item.risk_score}/100.` : "Waiting for AI risk score.", "AI scoring service"),
    nodeSpec("incident", "Incident", highRisk ? "warning" : hasAnomaly ? "running" : "pending", baseTime + 980, 42, highRisk ? "Incident candidate created from high-risk signal." : hasAnomaly ? "Anomaly below critical incident threshold." : "No incident needed.", "incident derivation"),
    nodeSpec("recommendation", "Recommendation", item.recommendation ? "success" : aiLinked ? "running" : "pending", baseTime + 1120, 39, item.recommendation ? "Recommendation generated for operators." : "Recommendation pending.", "recommendation service"),
    nodeSpec("validation", "Review Queue", reviewed ? "review" : hasAnomaly ? "running" : "pending", baseTime + 1260, null, reviewed ? `Review status: ${item.validation_status}.` : "Waiting for supervisor review.", "validation feedback"),
    nodeSpec("closure", "Closure", reviewed ? "success" : "pending", baseTime + 1440, null, reviewed ? "Outcome available for closure." : "Closure pending.", "supervision workflow"),
  ];

  return specs.map((spec, index) => ({ ...spec, x: positions[index].x, y: positions[index].y }));
}

function detectorSpec(id: string, label: string, item: WorkflowItem, modelId: string, token: string): Omit<DiagramNode, "x" | "y"> {
  const baseTime = new Date(item.timestamp).getTime();
  const matched = modelId.toLowerCase().includes(token);
  const hasAi = item.risk_score !== null;
  const status: WorkflowStepStatus = matched ? item.severity === "critical" ? "warning" : "success" : hasAi ? "success" : "pending";
  return nodeSpec(
    id,
    label,
    status,
    baseTime + 380 + token.length * 40,
    matched ? 48 : hasAi ? 35 : null,
    matched ? `${label} contributed to the selected AI result.` : hasAi ? `${label} available in the decision layer.` : `${label} not reached yet.`,
    "AI detector layer",
  );
}

function nodeSpec(
  id: string,
  label: string,
  status: WorkflowStepStatus,
  timestampMs: number,
  durationMs: number | null,
  message: string,
  source: string,
): Omit<DiagramNode, "x" | "y"> {
  return {
    id,
    label,
    status,
    timestamp: status === "pending" ? null : new Date(timestampMs).toISOString(),
    durationMs: status === "pending" ? null : durationMs,
    message,
    source,
  };
}

function toDiagramNode(step: WorkflowStep, position: { x: number; y: number }): DiagramNode {
  return {
    id: step.id,
    label: step.name,
    status: step.status,
    timestamp: step.timestamp,
    durationMs: step.durationMs,
    message: step.message,
    source: step.source,
    x: position.x,
    y: position.y,
  };
}

function diagramPositions(count: number) {
  const topCount = Math.ceil(count / 2);
  const bottomCount = count - topCount;
  const top = Array.from({ length: topCount }, (_, index) => ({
    x: 105 + index * (970 / Math.max(topCount - 1, 1)),
    y: 150,
  }));
  const bottom = Array.from({ length: bottomCount }, (_, index) => ({
    x: 1075 - index * (970 / Math.max(bottomCount - 1, 1)),
    y: 392,
  }));
  return [...top, ...bottom];
}

function edgePath(from: DiagramNode, to: DiagramNode) {
  const sameRow = Math.abs(from.y - to.y) < 10;
  if (sameRow) {
    const startX = from.x + (to.x > from.x ? 92 : -92);
    const endX = to.x + (to.x > from.x ? -92 : 92);
    return `M ${startX} ${from.y} C ${(startX + endX) / 2} ${from.y}, ${(startX + endX) / 2} ${to.y}, ${endX} ${to.y}`;
  }
  const startX = from.x - 8;
  const endX = to.x + 8;
  return `M ${startX} ${from.y + 64} C ${startX} ${from.y + 160}, ${endX} ${to.y - 160}, ${endX} ${to.y - 64}`;
}

function riskStatus(riskScore: number | null): WorkflowStepStatus {
  if (riskScore === null) return "pending";
  if (riskScore >= 80) return "warning";
  if (riskScore >= 45) return "success";
  return "success";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
