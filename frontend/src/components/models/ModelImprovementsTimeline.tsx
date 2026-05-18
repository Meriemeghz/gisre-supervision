import type { AiModelImprovement } from "@/types/ai-models";

export function ModelImprovementsTimeline({ improvements }: { improvements: AiModelImprovement[] }) {
  if (improvements.length === 0) {
    return <p className="muted">Aucune amelioration documentee.</p>;
  }

  return (
    <div className="timeline">
      {improvements.map((item) => (
        <div className="timelineItem" key={`${item.date}-${item.version}-${item.change}`}>
          <strong>{item.date} - {item.version}</strong>
          <span>{item.change}</span>
          <small>Impact attendu: {item.expected_impact}</small>
          {item.measured_impact && <small>Impact mesure: {item.measured_impact}</small>}
        </div>
      ))}
    </div>
  );
}
