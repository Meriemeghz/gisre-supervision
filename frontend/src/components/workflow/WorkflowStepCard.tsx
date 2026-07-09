import type { WorkflowStep } from "@/types/workflow";

export function WorkflowStepCard({ step, compact = false }: { step: WorkflowStep; compact?: boolean }) {
  return (
    <article className={`workflowStepCard ${step.status} ${compact ? "compact" : ""}`}>
      <div className="workflowStepTop">
        <span className="workflowStepDot" />
        <strong>{step.name}</strong>
      </div>
      <p>{step.message}</p>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{step.status}</dd>
        </div>
        <div>
          <dt>Timestamp</dt>
          <dd>{step.timestamp ? formatTime(step.timestamp) : "pending"}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{step.durationMs === null ? "n/a" : `${step.durationMs} ms`}</dd>
        </div>
      </dl>
      <small>{step.source}</small>
    </article>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
