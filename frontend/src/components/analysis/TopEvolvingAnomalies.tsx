import type { CSSProperties } from "react";
import { getAnomalyFamily, ANOMALY_FAMILY_COLORS } from "@/lib/anomaly-family";
import type { HistoricalEvolvingAnomaly } from "@/lib/api/historical-analysis";
import { HistoricalSectionTitle } from "./HistoricalSectionTitle";

type EvolvingRow = HistoricalEvolvingAnomaly & {
  evolution: number | null;
  trend: "increasing" | "stable" | "decreasing";
};

export function TopEvolvingAnomalies({
  anomalies,
  limit,
}: {
  anomalies: HistoricalEvolvingAnomaly[];
  limit?: number;
}) {
  const rows = anomalies.map(toEvolvingRow).sort((a, b) => evolutionSortValue(b) - evolutionSortValue(a));
  const visibleRows = typeof limit === "number" ? rows.slice(0, limit) : rows;
  return (
    <section className="historicalSection">
      <HistoricalSectionTitle
        eyebrow="Anomaly evolution"
        title="Top evolving anomalies"
        description="Change compares anomaly occurrences in the second half of the selected period with the first half."
      />
      {!rows.length ? <div className="historicalUnavailable">Not available</div> : (
        <div className="tableScroll">
          <table className="table evolvingAnomaliesTable">
            <thead>
              <tr>
                <th>Anomaly type</th>
                <th>Family</th>
                <th>Occurrences</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Evolution</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const family = getAnomalyFamily(row.anomaly_type);
                return (
                  <tr key={row.anomaly_type}>
                    <td className="typeCell">{row.anomaly_type}</td>
                    <td><span className="familyBadge" style={{ "--family-color": ANOMALY_FAMILY_COLORS[family] } as CSSProperties}>{family}</span></td>
                    <td><strong>{row.occurrences}</strong></td>
                    <td>{formatDate(row.first_seen)}</td>
                    <td>{formatDate(row.last_seen)}</td>
                    <td className={row.evolution === null || row.evolution > 0 ? "trendUp" : row.evolution < 0 ? "trendDown" : ""}>{formatEvolution(row.evolution)}</td>
                    <td><span className={`evolutionTrend ${row.trend}`}>{row.trend}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function toEvolvingRow(anomaly: HistoricalEvolvingAnomaly): EvolvingRow {
  const previous = Number(anomaly.previous_period_count || 0);
  const recent = Number(anomaly.recent_period_count || 0);
  const evolution = previous === 0
    ? null
    : ((recent - previous) / previous) * 100;
  const rounded = evolution === null ? null : Math.round(evolution);
  return {
    ...anomaly,
    evolution: rounded,
    trend: rounded === null && recent > 0
      ? "increasing"
      : (rounded || 0) > 10
        ? "increasing"
        : (rounded || 0) < -10
          ? "decreasing"
          : "stable",
  };
}

function evolutionSortValue(row: EvolvingRow) {
  return row.evolution === null && row.recent_period_count > 0
    ? Number.POSITIVE_INFINITY
    : row.evolution || 0;
}

function formatEvolution(value: number | null) {
  if (value === null) return "New";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}
