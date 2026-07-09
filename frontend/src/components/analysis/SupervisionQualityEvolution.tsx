import type { HistoricalAnalytics } from "@/lib/api/historical-analysis";
import { HistoricalSectionTitle } from "./HistoricalSectionTitle";

export function SupervisionQualityEvolution({ quality }: { quality: HistoricalAnalytics["supervision_quality"] }) {
  const metrics = [
    ["AI results", quality.total_results, "All persisted analyses"],
    ["Detected anomalies", quality.anomalies_detected, "Non-normal results"],
    ["Normal results", quality.normal_results, "No anomaly detected"],
    ["True positives", quality.true_positives, "Human-confirmed"],
    ["False positives", quality.false_positives, "Human-rejected"],
    ["Pending reviews", quality.pending_reviews, "Historical queue volume"],
    ["Validation rate", quality.validation_rate === null ? "Not available" : `${(quality.validation_rate * 100).toFixed(1)}%`, "Reviewed / anomalies"],
  ];
  return (
    <section className="historicalSection">
      <HistoricalSectionTitle eyebrow="Supervision quality" title="Quality evolution snapshot" description="Historical quality statistics only; review actions remain in Investigations." />
      <div className="historicalQualityGrid">
        {metrics.map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}
      </div>
    </section>
  );
}
