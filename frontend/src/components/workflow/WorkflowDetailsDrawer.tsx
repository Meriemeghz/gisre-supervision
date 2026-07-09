import type { WorkflowItem } from "@/types/workflow";
import { WorkflowStepCard } from "./WorkflowStepCard";

export function WorkflowDetailsDrawer({ item, onClose }: { item: WorkflowItem | null; onClose: () => void }) {
  if (!item) return null;

  return (
    <div className="workflowDrawerBackdrop" role="presentation" onClick={onClose}>
      <aside className="workflowDrawer" role="dialog" aria-label="Workflow details" onClick={(event) => event.stopPropagation()}>
        <div className="workflowDrawerHeader">
          <div>
            <span>Pipeline trace</span>
            <h2>{item.event_id}</h2>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        <section className="workflowDrawerSummary">
          <Info label="Flow" value={item.flow_code || "n/a"} />
          <Info label="API" value={item.api_name || "n/a"} />
          <Info label="Consumer" value={item.consumer_code || "n/a"} />
          <Info label="Producer" value={item.producer_code || "n/a"} />
          <Info label="Anomaly" value={item.anomaly_type || "NORMAL"} />
          <Info label="Risk" value={item.risk_score === null ? "n/a" : `${item.risk_score}/100`} />
          <Info label="Severity" value={item.severity || "n/a"} />
          <Info label="Confidence" value={formatConfidence(item.confidence)} />
          <Info label="Validation" value={item.validation_status} />
        </section>

        <section className="workflowDrawerNarrative">
          <h3>Explanation</h3>
          <p>{item.explanation || "No AI explanation is linked to this event yet."}</p>
          <h3>Recommendation</h3>
          <p>{item.recommendation || "No recommendation generated yet."}</p>
        </section>

        <section className="workflowDrawerSteps">
          {item.steps.map((step) => (
            <WorkflowStepCard step={step} key={step.id} />
          ))}
        </section>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatConfidence(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/a";
  return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`;
}
