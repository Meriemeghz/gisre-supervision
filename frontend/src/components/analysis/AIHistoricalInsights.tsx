"use client";

import { useState, type ReactNode } from "react";
import { getAnomalyFamily } from "@/lib/anomaly-family";
import type { HistoricalAnalytics, HistoricalInterpretResult } from "@/lib/api/historical-analysis";
import { postHistoricalInterpret } from "@/lib/api/historical-analysis";
import { HistoricalSectionTitle } from "./HistoricalSectionTitle";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function AIHistoricalInsights({ data }: { data: HistoricalAnalytics }) {
  const [result, setResult] = useState<HistoricalInterpretResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasData = data.supervision_quality.anomalies_detected > 0 || data.evolving_anomalies.length > 0;

  async function handleGenerate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const payload = buildInterpretPayload(data);
      const res = await postHistoricalInterpret(payload);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Interpretation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="historicalSection">
      <HistoricalSectionTitle
        eyebrow="AI historical insights"
        title="Historical interpretation"
        description="OpenAI interprets aggregated trends only. No raw events or business data are transmitted."
      />

      <article className="historicalInsightPanel">
        <div>
          <span>LLM integration status</span>
          {result?.configured === false ? (
            <>
              <h3>LLM interpretation not configured</h3>
              <p>{result.message ?? "Set OPENAI_API_KEY in the environment to enable this feature."}</p>
            </>
          ) : result ? (
            <>
              <h3>Interpretation generated</h3>
              <p>Based on {data.supervision_quality.anomalies_detected} anomalies over the selected period.</p>
            </>
          ) : (
            <>
              <h3>AI-powered historical analysis</h3>
              <p>
                Send aggregated historical indicators to OpenAI for an operational interpretation.
                Only statistical summaries are transmitted — no raw events, no business data.
              </p>
            </>
          )}
        </div>
        <div className="historicalInsightAction">
          <strong>
            {hasData
              ? `${data.supervision_quality.anomalies_detected} anomalies · ${Object.keys(data.llm_ready_summary_payload).length} dimensions`
              : "No data available for the selected period"}
          </strong>
          <button
            className="button primary"
            type="button"
            disabled={loading || !hasData}
            onClick={handleGenerate}
          >
            {loading ? "Generating..." : result ? "Regenerate" : "Generate Historical Insight"}
          </button>
          {error && <small className="insightError">{error}</small>}
        </div>
      </article>

      {result?.configured && result.executive_summary && result.executive_summary !== "Not enough historical data to generate an insight." && (
        <div className="insightResultCard">
          <InsightSection label="Executive summary" className="insightExecSummary">
            <p>{result.executive_summary}</p>
          </InsightSection>

          {(result.key_findings ?? []).length > 0 && (
            <InsightSection label="Key findings">
              <ul className="insightList">
                {(result.key_findings ?? []).map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </InsightSection>
          )}

          <div className="insightTriCol">
            {result.risk_interpretation && (
              <InsightSection label="Risk interpretation">
                <p>{result.risk_interpretation}</p>
              </InsightSection>
            )}
            {result.root_cause_interpretation && (
              <InsightSection label="Root cause interpretation">
                <p>{result.root_cause_interpretation}</p>
              </InsightSection>
            )}
            {result.temporal_interpretation && (
              <InsightSection label="Temporal interpretation">
                <p>{result.temporal_interpretation}</p>
              </InsightSection>
            )}
          </div>

          {(result.recommendations ?? []).length > 0 && (
            <InsightSection label="Operational recommendations">
              <ul className="insightList insightRecommendations">
                {(result.recommendations ?? []).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </InsightSection>
          )}

          {result.confidence_note && (
            <p className="insightConfidenceNote">{result.confidence_note}</p>
          )}
        </div>
      )}

      {result?.configured && result.executive_summary === "Not enough historical data to generate an insight." && (
        <div className="historicalUnavailable">{result.executive_summary}</div>
      )}
    </section>
  );
}

function InsightSection({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`insightSection ${className}`}>
      <span className="insightSectionLabel">{label}</span>
      {children}
    </div>
  );
}

function buildInterpretPayload(data: HistoricalAnalytics): Record<string, unknown> {
  const familyTotals: Record<string, number> = {};
  data.anomaly_timeline.forEach((point) => {
    const family = getAnomalyFamily(point.anomaly_type);
    familyTotals[family] = (familyTotals[family] ?? 0) + Number(point.count || 0);
  });
  const anomalyFamilyEvolution = Object.entries(familyTotals)
    .map(([family, total]) => ({ family, total }))
    .sort((a, b) => b.total - a.total);

  const heatmapSummary = buildHeatmapSummary(data.temporal_heatmap);

  const topEvolvingAnomalies = data.evolving_anomalies.slice(0, 10).map((a) => {
    const prev = Number(a.previous_period_count || 0);
    const recent = Number(a.recent_period_count || 0);
    const evolution = prev > 0 ? Math.round(((recent - prev) / prev) * 100) : null;
    return {
      anomaly_type: a.anomaly_type,
      occurrences: a.occurrences,
      previous_period: prev,
      recent_period: recent,
      evolution_pct: evolution,
      trend: evolution === null && recent > 0 ? "new" : (evolution ?? 0) > 10 ? "increasing" : (evolution ?? 0) < -10 ? "decreasing" : "stable",
    };
  });

  const rootCauseChains = data.root_cause_chains.slice(0, 5).map((c) => ({
    producer: c.producer_code,
    api: c.api_code,
    anomaly: c.anomaly_type,
    occurrences: c.occurrences,
    avg_risk: Math.round(Number(c.average_risk_score || 0)),
    criticality: c.criticality,
  }));

  return {
    period: data.period,
    filters: data.filters,
    anomaly_family_evolution: anomalyFamilyEvolution,
    temporal_heatmap_summary: heatmapSummary,
    top_evolving_anomalies: topEvolvingAnomalies,
    root_cause_chains: rootCauseChains,
    supervision_quality: {
      total_results: data.supervision_quality.total_results,
      anomalies_detected: data.supervision_quality.anomalies_detected,
      normal_results: data.supervision_quality.normal_results,
      false_positives: data.supervision_quality.false_positives,
      true_positives: data.supervision_quality.true_positives,
      pending_reviews: data.supervision_quality.pending_reviews,
      validation_rate: data.supervision_quality.validation_rate,
    },
  };
}

function buildHeatmapSummary(cells: HistoricalAnalytics["temporal_heatmap"]) {
  if (!cells.length) return { available: false };
  const dayTotals = Array(7).fill(0) as number[];
  const hourTotals = Array(24).fill(0) as number[];
  cells.forEach((cell) => {
    const d = Number(cell.day) - 1;
    const h = Number(cell.hour);
    const c = Number(cell.anomaly_count || 0);
    if (d >= 0 && d < 7) dayTotals[d] += c;
    if (h >= 0 && h < 24) hourTotals[h] += c;
  });
  const peakDay = indexOfMax(dayTotals);
  const peakHour = indexOfMax(hourTotals);
  return {
    available: true,
    peak_day: DAYS[peakDay] ?? "Unknown",
    peak_hour: `${String(peakHour).padStart(2, "0")}:00`,
    top_hours: hourTotals
      .map((count, hour) => ({ hour: `${String(hour).padStart(2, "0")}:00`, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
  };
}

function indexOfMax(values: number[]) {
  return values.reduce((best, val, i) => (val > values[best] ? i : best), 0);
}
