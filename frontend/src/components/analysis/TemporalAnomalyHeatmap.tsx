import type { HistoricalTemporalHeatmapCell } from "@/lib/api/historical-analysis";
import { HistoricalSectionTitle } from "./HistoricalSectionTitle";

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function TemporalAnomalyHeatmap({ cells }: { cells: HistoricalTemporalHeatmapCell[] }) {
  const cellMap = new Map(cells.map((cell) => [`${cell.day}-${cell.hour}`, cell]));
  const maxCount = Math.max(1, ...cells.map((cell) => Number(cell.anomaly_count || 0)));
  const interpretation = buildInterpretation(cells);

  return (
    <section className="historicalSection">
      <HistoricalSectionTitle
        eyebrow="Temporal recurrence"
        title="Temporal anomaly heatmap"
        description="Historical anomaly concentration by day of week and hour of day for the selected filters."
      />

      {!cells.length ? (
        <div className="historicalEmptyState">No anomaly activity found for the selected period.</div>
      ) : (
        <>
          <div className="temporalHeatmapScroll">
            <div className="temporalHeatmap">
              <div className="temporalHeatmapCorner">Hour</div>
              {DAYS.map((day) => <div className="temporalHeatmapDay" key={day}>{day}</div>)}

              {Array.from({ length: 24 }, (_, hour) => (
                <HeatmapRow hour={hour} cellMap={cellMap} maxCount={maxCount} key={hour} />
              ))}
            </div>
          </div>

          <div className="temporalHeatmapFooter">
            <div className="temporalHeatmapLegend" aria-label="Heatmap intensity legend">
              <span>Low</span>
              {[0, 0.25, 0.5, 0.75, 1].map((intensity) => (
                <i key={intensity} style={heatStyle(intensity)} />
              ))}
              <span>High</span>
            </div>
            <TemporalInterpretation interpretation={interpretation} />
          </div>
        </>
      )}
    </section>
  );
}

function HeatmapRow({
  hour,
  cellMap,
  maxCount,
}: {
  hour: number;
  cellMap: Map<string, HistoricalTemporalHeatmapCell>;
  maxCount: number;
}) {
  return (
    <>
      <div className="temporalHeatmapHour">{formatHour(hour)}</div>
      {DAYS.map((day, dayIndex) => {
        const cell = cellMap.get(`${dayIndex + 1}-${hour}`);
        const count = Number(cell?.anomaly_count || 0);
        const intensity = count / maxCount;
        const tooltip = [
          `${day}, ${formatHour(hour)}`,
          `${count} anomalies`,
          `Top type: ${cell?.top_anomaly_type || "Not available"}`,
          `Average risk: ${formatRisk(cell?.average_risk_score)}`,
        ].join("\n");
        return (
          <div className="temporalHeatmapCell" key={`${day}-${hour}`} style={heatStyle(intensity)} tabIndex={0} title={tooltip}>
            <strong>{count || ""}</strong>
            <div className="temporalHeatmapTooltip">
              <b>{day}, {formatHour(hour)}</b>
              <span>{count} anomalies</span>
              <span>Top type: {cell?.top_anomaly_type || "Not available"}</span>
              <span>Average risk: {formatRisk(cell?.average_risk_score)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

type TemporalInterpretationData = {
  day: string;
  hour: string;
  slot: string;
  slotTotal: number;
  summary: string;
};

function TemporalInterpretation({ interpretation }: { interpretation: TemporalInterpretationData }) {
  return (
    <article className="temporalInterpretation">
      <div>
        <span>Temporal interpretation</span>
        <h3>{interpretation.summary}</h3>
      </div>
      <dl>
        <div><dt>Most problematic day</dt><dd>{interpretation.day}</dd></div>
        <div><dt>Peak hour</dt><dd>{interpretation.hour}</dd></div>
        <div><dt>Dominant time slot</dt><dd>{interpretation.slot}</dd></div>
        <div><dt>Anomalies in slot</dt><dd>{interpretation.slotTotal}</dd></div>
      </dl>
    </article>
  );
}

function buildInterpretation(cells: HistoricalTemporalHeatmapCell[]): TemporalInterpretationData {
  if (!cells.length) {
    return {
      day: "Not available",
      hour: "Not available",
      slot: "Not available",
      slotTotal: 0,
      summary: "No anomaly activity found for the selected period.",
    };
  }

  const dayTotals = Array(7).fill(0) as number[];
  const hourTotals = Array(24).fill(0) as number[];
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  cells.forEach((cell) => {
    const dayIndex = Number(cell.day) - 1;
    const hour = Number(cell.hour);
    const count = Number(cell.anomaly_count || 0);
    if (dayIndex < 0 || dayIndex > 6 || hour < 0 || hour > 23) return;
    dayTotals[dayIndex] += count;
    hourTotals[hour] += count;
    matrix[dayIndex][hour] += count;
  });

  const mostProblematicDay = indexOfMax(dayTotals);
  const peakHour = indexOfMax(hourTotals);
  let dominantDay = 0;
  let dominantStart = 0;
  let dominantTotal = -1;
  matrix.forEach((hours, dayIndex) => {
    for (let start = 0; start <= 21; start += 1) {
      const total = hours[start] + hours[start + 1] + hours[start + 2];
      if (total > dominantTotal) {
        dominantTotal = total;
        dominantDay = dayIndex;
        dominantStart = start;
      }
    }
  });

  const slotEnd = dominantStart + 3;
  return {
    day: DAYS[mostProblematicDay],
    hour: formatHour(peakHour),
    slot: `${DAYS[dominantDay]} ${formatHour(dominantStart)}-${formatHour(slotEnd)}`,
    slotTotal: Math.max(0, dominantTotal),
    summary: `Anomalies are concentrated mainly on ${DAYS[dominantDay]} between ${formatHour(dominantStart)} and ${formatHour(slotEnd)}, with the overall hourly peak observed at ${formatHour(peakHour)}.`,
  };
}

function indexOfMax(values: number[]) {
  return values.reduce((bestIndex, value, index) => value > values[bestIndex] ? index : bestIndex, 0);
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatRisk(value?: number | null) {
  return value === null || value === undefined ? "Not available" : `${Number(value).toFixed(1)}/100`;
}

function heatStyle(intensity: number) {
  if (intensity <= 0) return { backgroundColor: "#f8fafc", borderColor: "#e2e8f0" };
  const alpha = 0.12 + Math.min(1, intensity) * 0.78;
  return {
    backgroundColor: `rgba(220, 38, 38, ${alpha})`,
    borderColor: `rgba(185, 28, 28, ${Math.min(0.9, alpha + 0.08)})`,
    color: intensity > 0.42 ? "#ffffff" : "#7f1d1d",
  };
}
