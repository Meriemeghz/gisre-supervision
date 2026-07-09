"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AIHistoricalInsights } from "@/components/analysis/AIHistoricalInsights";
import {
  HistoricalFilters,
  type HistoricalFilterState,
} from "@/components/analysis/HistoricalFilters";
import { HistoricalAnomalyFamilies } from "@/components/analysis/HistoricalAnomalyFamilies";
import { RootCauseHistoricalAnalysis } from "@/components/analysis/RootCauseHistoricalAnalysis";
import { SupervisionQualityEvolution } from "@/components/analysis/SupervisionQualityEvolution";
import { TemporalAnomalyHeatmap } from "@/components/analysis/TemporalAnomalyHeatmap";
import { TopEvolvingAnomalies } from "@/components/analysis/TopEvolvingAnomalies";
import {
  getHistoricalAnalytics,
  type HistoricalAnalytics,
  type HistoricalAnalyticsFilters,
} from "@/lib/api/historical-analysis";

const INITIAL_FILTERS: HistoricalFilterState = {
  preset: "7d",
  startDate: "",
  endDate: "",
  flowCode: "",
  apiCode: "",
  producerCode: "",
  consumerCode: "",
  anomalyType: "",
};

export default function AnalyzePage() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [data, setData] = useState<HistoricalAnalytics | null>(null);
  const [filterOptions, setFilterOptions] = useState<HistoricalAnalytics["filter_options"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  const loadAnalytics = useCallback(async (nextFilters: HistoricalFilterState) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await getHistoricalAnalytics(toApiFilters(nextFilters), controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setFilterOptions(result.filter_options);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Historical analytics could not be loaded");
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadAnalytics(INITIAL_FILTERS);
    return () => requestController.current?.abort();
  }, [loadAnalytics]);

  const analysisCards = useMemo(() => {
    if (!data) return [];
    return [
      {
        id: "families",
        title: "Historical anomaly families evolution",
        meta: "Stacked family trend",
        compact: <HistoricalAnomalyFamilies timeline={data.anomaly_timeline} period={data.period} />,
        expanded: <HistoricalAnomalyFamilies timeline={data.anomaly_timeline} period={data.period} />,
      },
      {
        id: "heatmap",
        title: "Temporal anomaly heatmap",
        meta: "Day / hour concentration",
        compact: <TemporalAnomalyHeatmap cells={data.temporal_heatmap} />,
        expanded: <TemporalAnomalyHeatmap cells={data.temporal_heatmap} />,
      },
      {
        id: "sankey",
        title: "Anomaly propagation paths",
        meta: "Producer -> API -> anomaly",
        compact: <RootCauseHistoricalAnalysis chains={data.root_cause_chains || []} mode="sankey" />,
        expanded: <RootCauseHistoricalAnalysis chains={data.root_cause_chains || []} mode="sankey" />,
      },
      {
        id: "evolving",
        title: "Top evolving anomalies",
        meta: "Top 8 in compact view",
        compact: <TopEvolvingAnomalies anomalies={data.evolving_anomalies} limit={8} />,
        expanded: <TopEvolvingAnomalies anomalies={data.evolving_anomalies} />,
      },
      {
        id: "chains",
        title: "Top Root Cause Chains",
        meta: "Top 8 in compact view",
        compact: <RootCauseHistoricalAnalysis chains={data.root_cause_chains || []} mode="table" tableLimit={8} />,
        expanded: <RootCauseHistoricalAnalysis chains={data.root_cause_chains || []} mode="table" tableLimit={50} />,
      },
      {
        id: "interpretation",
        title: "Historical interpretation",
        meta: "Operational insight",
        compact: <AIHistoricalInsights data={data} />,
        expanded: <AIHistoricalInsights data={data} />,
      },
    ];
  }, [data]);

  const selectedCard = analysisCards.find((card) => card.id === expandedCard) || null;

  return (
    <main className="historicalAnalysisPage">
      <header className="pageHeader historicalPageHeader">
        <div>
          <span className="historicalEyebrow">Historical intelligence</span>
          <h1>Historical Platform Analysis</h1>
          <p>Understand recurring anomalies, long-term risk evolution and the components repeatedly involved in platform degradation.</p>
        </div>
        <span className="statusPill">Aggregated history</span>
      </header>

      <HistoricalFilters
        value={filters}
        options={filterOptions}
        loading={loading}
        onChange={setFilters}
        onApply={() => void loadAnalytics(filters)}
      />

      {error && <div className="errorBox">Historical data unavailable: {error}</div>}
      {loading && !data && <div className="historicalLoading">Loading historical platform signals...</div>}

      {data && (
        <>
          <HistoricalOverview data={data} />
          <section className="historicalQualityBand">
            <SupervisionQualityEvolution quality={data.supervision_quality} />
          </section>
          <section className="historicalCompactGrid" aria-label="Historical analysis visualizations">
            {analysisCards.map((card) => (
              <ExpandableAnalysisCard
                key={card.id}
                title={card.title}
                meta={card.meta}
                onExpand={() => setExpandedCard(card.id)}
              >
                {card.compact}
              </ExpandableAnalysisCard>
            ))}
          </section>
          {selectedCard && (
            <AnalysisExpandModal
              title={selectedCard.title}
              meta={selectedCard.meta}
              filters={filters}
              onClose={() => setExpandedCard(null)}
            >
              {selectedCard.expanded}
            </AnalysisExpandModal>
          )}
        </>
      )}
    </main>
  );
}

function ExpandableAnalysisCard({
  title,
  meta,
  children,
  onExpand,
}: {
  title: string;
  meta: string;
  children: ReactNode;
  onExpand: () => void;
}) {
  return (
    <article className="analysisCompactCard">
      <header className="analysisCompactCardHeader">
        <div>
          <span>{meta}</span>
          <h2>{title}</h2>
        </div>
        <button className="analysisExpandButton" type="button" onClick={onExpand}>
          Agrandir
        </button>
      </header>
      <div className="analysisCompactCardBody">{children}</div>
    </article>
  );
}

function AnalysisExpandModal({
  title,
  meta,
  filters,
  children,
  onClose,
}: {
  title: string;
  meta: string;
  filters: HistoricalFilterState;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="analysisModalOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <article className="analysisModalPanel">
        <header className="analysisModalHeader">
          <div>
            <span>{meta}</span>
            <h2>{title}</h2>
            <small>{formatAppliedFilters(filters)}</small>
          </div>
          <button className="analysisExpandButton" type="button" onClick={onClose}>
            Fermer
          </button>
        </header>
        <div className="analysisModalBody">{children}</div>
      </article>
    </div>
  );
}

function formatAppliedFilters(filters: HistoricalFilterState) {
  const active = [
    `period: ${filters.preset}`,
    filters.flowCode ? `flow: ${filters.flowCode}` : "",
    filters.apiCode ? `api: ${filters.apiCode}` : "",
    filters.producerCode ? `producer: ${filters.producerCode}` : "",
    filters.consumerCode ? `consumer: ${filters.consumerCode}` : "",
    filters.anomalyType ? `anomaly: ${filters.anomalyType}` : "",
  ].filter(Boolean);
  return `Filtres appliques - ${active.join(" / ")}`;
}

function HistoricalOverview({ data }: { data: HistoricalAnalytics }) {
  const quality = data.supervision_quality;
  const periodStart = new Date(data.period.start_date);
  const periodEnd = new Date(data.period.end_date);
  const formatDate = (date: Date) => Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="historicalOverview" aria-label="Historical period summary">
      <article><span>Period start</span><strong>{formatDate(periodStart)}</strong><small>Selected historical window</small></article>
      <article><span>Period end</span><strong>{formatDate(periodEnd)}</strong><small>Exclusive query boundary</small></article>
      <article><span>AI results</span><strong>{quality.total_results}</strong><small>{data.period.bucket} aggregation</small></article>
      <article><span>Anomalies</span><strong>{quality.anomalies_detected}</strong><small>{quality.normal_results} normal results</small></article>
    </section>
  );
}

function toApiFilters(filters: HistoricalFilterState): HistoricalAnalyticsFilters {
  const period = resolvePeriod(filters);
  return {
    start_date: period.start.toISOString(),
    end_date: period.end.toISOString(),
    flow_code: filters.flowCode || undefined,
    api_code: filters.apiCode || undefined,
    producer_code: filters.producerCode || undefined,
    consumer_code: filters.consumerCode || undefined,
    anomaly_type: filters.anomalyType || undefined,
  };
}

function resolvePeriod(filters: HistoricalFilterState) {
  if (filters.preset === "custom") {
    const start = parseCustomDate(filters.startDate, "start");
    const end = parseCustomDate(filters.endDate, "end");
    if (!filters.startDate || !filters.endDate || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Select a valid custom start and end date");
    }
    if (start >= end) {
      throw new Error("The start date must be before the end date");
    }
    return { start, end };
  }

  const end = new Date();
  const durationMs = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  }[filters.preset];
  return { start: new Date(end.getTime() - durationMs), end };
}

function parseCustomDate(value: string, boundary: "start" | "end") {
  if (!value) return new Date(Number.NaN);
  const normalized = value.includes("T")
    ? value
    : boundary === "start"
      ? `${value}T00:00:00`
      : `${value}T23:59:59`;
  return new Date(normalized);
}
