import {
  ANOMALY_FAMILIES,
  ANOMALY_FAMILY_COLORS,
  getAnomalyFamily,
  type AnomalyFamily,
} from "@/lib/anomaly-family";
import type {
  HistoricalAnalytics,
  HistoricalAnomalyTimelinePoint,
} from "@/lib/api/historical-analysis";
import { HistoricalSectionTitle } from "./HistoricalSectionTitle";

type FamilyBucket = {
  bucket: string;
  total: number;
  values: Record<AnomalyFamily, number>;
};

export function HistoricalAnomalyFamilies({
  timeline,
  period,
}: {
  timeline: HistoricalAnomalyTimelinePoint[];
  period: HistoricalAnalytics["period"];
}) {
  const buckets = aggregateFamilies(timeline, period);
  const interpretation = interpretFamilies(buckets, period);
  const maxTotal = Math.max(1, ...buckets.map((bucket) => bucket.total));

  return (
    <section className="historicalSection">
      <HistoricalSectionTitle
        eyebrow="Anomaly family intelligence"
        title="Historical anomaly families evolution"
        description={`Stacked anomaly volumes by ${period.bucket}. Detailed anomaly types remain available in the evolution table.`}
      />

      {!buckets.length ? (
        <div className="historicalUnavailable">Not available</div>
      ) : (
        <>
          <div className="familyEvolutionLayout">
            <article className="familyChartPanel">
              <div className="familyLegend">
                {ANOMALY_FAMILIES.map((family) => (
                  <span key={family}><i style={{ background: ANOMALY_FAMILY_COLORS[family] }} />{family}</span>
                ))}
              </div>
              <div className="familyChart">
                <div className="familyYAxis">
                  <span>{maxTotal}</span><span>{Math.round(maxTotal / 2)}</span><span>0</span>
                </div>
                <div className="familyPlot">
                  <div className="familyGridLine top" />
                  <div className="familyGridLine middle" />
                  <div className="familyGridLine bottom" />
                  <div className="familyBars">
                    {buckets.map((bucket) => (
                      <div className="familyBarColumn" key={bucket.bucket} title={`${formatBucket(bucket.bucket, period.bucket)}: ${bucket.total} anomalies`}>
                        <div className="familyStack" style={{ height: `${bucket.total ? Math.max(3, (bucket.total / maxTotal) * 100) : 0}%` }}>
                          {ANOMALY_FAMILIES.map((family) => {
                            const count = bucket.values[family];
                            if (!count) return null;
                            return (
                              <i
                                key={family}
                                title={`${family}: ${count}`}
                                style={{
                                  background: ANOMALY_FAMILY_COLORS[family],
                                  height: `${(count / bucket.total) * 100}%`,
                                }}
                              />
                            );
                          })}
                        </div>
                        <span>{formatBucket(bucket.bucket, period.bucket)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>

            <HistoricalInterpretation interpretation={interpretation} />
          </div>
        </>
      )}
    </section>
  );
}

function HistoricalInterpretation({ interpretation }: { interpretation: FamilyInterpretation }) {
  return (
    <article className="historicalInterpretation">
      <span>Historical interpretation</span>
      <h3>{interpretation.summary}</h3>
      <dl>
        <div><dt>Dominant family</dt><dd>{interpretation.dominant}</dd></div>
        <div><dt>Strongest increase</dt><dd>{interpretation.increasing}</dd></div>
        <div><dt>Decreasing family</dt><dd>{interpretation.decreasing}</dd></div>
        <div><dt>Most problematic period</dt><dd>{interpretation.problematicPeriod}</dd></div>
      </dl>
    </article>
  );
}

type FamilyInterpretation = {
  dominant: string;
  increasing: string;
  decreasing: string;
  problematicPeriod: string;
  summary: string;
};

function interpretFamilies(
  buckets: FamilyBucket[],
  period: HistoricalAnalytics["period"],
): FamilyInterpretation {
  if (!buckets.length) {
    return {
      dominant: "Not available",
      increasing: "Not available",
      decreasing: "Not available",
      problematicPeriod: "Not available",
      summary: "Not enough historical data is available for interpretation.",
    };
  }

  const periodStart = new Date(period.start_date).getTime();
  const periodEnd = new Date(period.end_date).getTime();
  const midpoint = periodStart + (periodEnd - periodStart) / 2;
  const previous = sumFamilies(buckets.filter((bucket) => new Date(bucket.bucket).getTime() < midpoint));
  const recent = sumFamilies(buckets.filter((bucket) => new Date(bucket.bucket).getTime() >= midpoint));
  const totals = sumFamilies(buckets);
  const rankedTotals = ANOMALY_FAMILIES.map((family) => ({ family, value: totals[family] }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
  const changes = buckets.length < 2
    ? []
    : ANOMALY_FAMILIES.map((family) => ({
        family,
        change: recent[family] - previous[family],
      })).filter((item) => totals[item.family] > 0);
  const increasing = [...changes].sort((a, b) => b.change - a.change).find((item) => item.change > 0);
  const decreasing = [...changes].sort((a, b) => a.change - b.change).find((item) => item.change < 0);
  const problematic = [...buckets].sort((a, b) => b.total - a.total)[0];
  const dominant = rankedTotals[0]?.family || "Not available";
  const increaseLabel = increasing?.family || "No clear increase";
  const decreaseLabel = decreasing?.family || "No clear decrease";

  return {
    dominant,
    increasing: increaseLabel,
    decreasing: decreaseLabel,
    problematicPeriod: formatBucket(problematic.bucket, period.bucket),
    summary: `Les anomalies de ${dominant} dominent la période sélectionnée. ${increaseLabel === "No clear increase" ? "Aucune famille ne présente de hausse nette" : `La famille ${increaseLabel} présente la plus forte progression`} sur les derniers intervalles.`,
  };
}

function aggregateFamilies(
  timeline: HistoricalAnomalyTimelinePoint[],
  period: HistoricalAnalytics["period"],
): FamilyBucket[] {
  const grouped = new Map<string, FamilyBucket>();
  buildBucketRange(period).forEach((bucket) => {
    grouped.set(bucket, { bucket, total: 0, values: emptyFamilyCounts() });
  });
  timeline.forEach((point) => {
    const bucketKey = normalizeBucket(point.bucket);
    const family = getAnomalyFamily(point.anomaly_type);
    const current = grouped.get(bucketKey) || {
      bucket: bucketKey,
      total: 0,
      values: emptyFamilyCounts(),
    };
    current.values[family] += Number(point.count || 0);
    current.total += Number(point.count || 0);
    grouped.set(bucketKey, current);
  });
  return Array.from(grouped.values()).sort((a, b) => new Date(a.bucket).getTime() - new Date(b.bucket).getTime());
}

function sumFamilies(buckets: FamilyBucket[]) {
  const totals = emptyFamilyCounts();
  buckets.forEach((bucket) => {
    ANOMALY_FAMILIES.forEach((family) => {
      totals[family] += bucket.values[family];
    });
  });
  return totals;
}

function emptyFamilyCounts(): Record<AnomalyFamily, number> {
  return Object.fromEntries(ANOMALY_FAMILIES.map((family) => [family, 0])) as Record<AnomalyFamily, number>;
}

function formatBucket(value: string, unit: HistoricalAnalytics["period"]["bucket"]) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (unit === "hour") return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (unit === "week") return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function buildBucketRange(period: HistoricalAnalytics["period"]) {
  const start = floorBucket(new Date(period.start_date), period.bucket);
  const end = new Date(period.end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const buckets: string[] = [];
  const cursor = new Date(start);
  while (cursor < end && buckets.length < 400) {
    buckets.push(cursor.toISOString());
    if (period.bucket === "hour") cursor.setUTCHours(cursor.getUTCHours() + 1);
    else if (period.bucket === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

function floorBucket(date: Date, unit: HistoricalAnalytics["period"]["bucket"]) {
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);
  if (unit !== "hour") result.setUTCHours(0);
  if (unit === "week") {
    const isoDay = result.getUTCDay() || 7;
    result.setUTCDate(result.getUTCDate() - isoDay + 1);
  }
  return result;
}

function normalizeBucket(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
