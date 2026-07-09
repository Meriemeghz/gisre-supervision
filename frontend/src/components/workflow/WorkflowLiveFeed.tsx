import type { WorkflowItem } from "@/types/workflow";
import { getAnomalyVisualLevel } from "@/lib/anomaly-visual";

export function WorkflowLiveFeed({
  items,
  selectedId,
  onSelect,
}: {
  items: WorkflowItem[];
  selectedId: string | null;
  onSelect: (item: WorkflowItem) => void;
}) {
  return (
    <aside className="workflowLiveFeed">
      <div className="workflowPanelHeader">
        <div>
          <span>Live pipeline events</span>
          <strong>{items.length}</strong>
        </div>
      </div>
      <div className="workflowFeedRows">
        {items.length === 0 && (
          <div className="workflowFeedEmpty">
            <strong>Waiting for live events</strong>
            <p>Generate new Kafka events to populate the AI workflow.</p>
          </div>
        )}
        {items.map((item) => (
          <button
            className={`workflowFeedRow anomalyVisualRow ${getAnomalyVisualLevel(item.anomaly_type, item.severity)} ${item.status} ${selectedId === item.id ? "selected" : ""}`}
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
          >
            <time>{formatTime(item.timestamp)}</time>
            <span>
              <strong>{item.flow_code || "unknown flow"}</strong>
              <small>{item.api_name || item.source} / {item.event_id.slice(0, 8)}</small>
            </span>
            <em>{item.anomaly_type || "NORMAL"}</em>
            <b>{item.risk_score === null ? "n/a" : item.risk_score}</b>
          </button>
        ))}
      </div>
    </aside>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
