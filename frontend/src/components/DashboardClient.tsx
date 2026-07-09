"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AiResult,
  AiSummary,
  BackendSummary,
  FlowMetric,
  fetchAiSummary,
  fetchAiWorkflowResults,
  fetchBackendSummary,
  fetchFlowMetrics,
} from "@/lib/api";
import { getAnomalyVisualLabel, getAnomalyVisualLevel } from "@/lib/anomaly-visual";
import { BarChart } from "./BarChart";
import { getIncidentStatus } from "./IncidentTable";
import { RealtimeKafkaWorkflow } from "./workflow/RealtimeKafkaWorkflow";

type DashboardState = {
  aiSummary: AiSummary | null;
  backendSummary: BackendSummary | null;
  results: AiResult[];
  workflowResults: AiResult[];
  flows: FlowMetric[];
};

type LiveState = "NORMAL" | "WARNING" | "CRITICAL";
type LiveFilter = "all" | "normal" | "anomalies" | "critical";

type LiveEvent = {
  id: string;
  source: "api_call" | "audit_event";
  timestamp: string;
  flow_code: string | null;
  api_code: string | null;
  consumer: string | null;
  provider: string | null;
  actor: string | null;
  latency_ms: number | null;
  status_code: number | null;
  success: boolean | null;
  is_sla_breach: boolean;
  correlation_id: string | null;
  state: LiveState;
  anomalyType: string | null;
  aiResult: AiResult | null;
  raw: ApiCallEvent | AuditEvent;
  receivedAt?: number;
};

type ApiCallEvent = {
  id: string;
  flow_code: string | null;
  api_code?: string | null;
  consumer_code?: string | null;
  producer_code?: string | null;
  anomaly_type?: string | null;
  status_code: number | null;
  latency_ms: number | null;
  success: boolean;
  error_type?: string | null;
  is_sla_breach: boolean;
  correlation_id?: string | null;
  called_at: string;
};

type AuditEvent = {
  id: string;
  flow_code: string | null;
  api_code?: string | null;
  actor_code?: string | null;
  anomaly_type?: string | null;
  action: string | null;
  outcome: string | null;
  correlation_id?: string | null;
  event_timestamp: string;
};

type TopologyState = "healthy" | "degraded" | "critical";

type TopologyNodeModel = {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
  state: TopologyState;
  anomalies: number;
  latencyMs: number | null;
  criticality: string;
  statusLabel: string;
  ai: boolean;
};

type TopologyEdgeModel = {
  id: string;
  path: string;
  state: TopologyState | "ai";
  label: string;
  labelX: number;
  labelY: number;
  propagation: boolean;
};

type TopologyFlowModel = {
  id: string;
  flowCode: string;
  label: string;
  sublabel: string;
  anomalyType: string;
  state: TopologyState;
  statusLabel: string;
  anomalies: number;
  latencyMs: number | null;
  criticality: string;
  riskScore: number;
  propagationRisk: string;
  ai: boolean;
  edgeState: TopologyState | "ai";
  edgeLabel: string;
};

type FlowImpactGroup = {
  anomalyType: string;
  visualLevel: ReturnType<typeof getAnomalyVisualLevel>;
  flows: TopologyFlowModel[];
  anomalyCount: number;
  averageLatencyMs: number | null;
  maxRiskScore: number;
  maxCriticality: string;
};

function isDashboardAnomaly(result: AiResult) {
  return result.detected_anomaly_type !== "NORMAL" && Number(result.risk_score || 0) > 0;
}

export function DashboardClient() {
  const [state, setState] = useState<DashboardState>({
    aiSummary: null,
    backendSummary: null,
    results: [],
    workflowResults: [],
    flows: [],
  });
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [liveFilter, setLiveFilter] = useState<LiveFilter>("all");
  const [liveQuery, setLiveQuery] = useState("");
  const [selectedLiveEvent, setSelectedLiveEvent] = useState<LiveEvent | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const snapshotLoading = useRef(false);

  useEffect(() => {
    let active = true;

    async function load() {
      if (snapshotLoading.current || document.visibilityState === "hidden") return;
      snapshotLoading.current = true;
      const [aiSummaryResult, backendSummaryResult, workflowResultsResult, flowsResult] = await Promise.allSettled([
        fetchAiSummary(),
        fetchBackendSummary(),
        fetchAiWorkflowResults(200),
        fetchFlowMetrics(),
      ]);
      snapshotLoading.current = false;
      if (active) {
        setState((current) => {
          const workflowResults = workflowResultsResult.status === "fulfilled"
            ? workflowResultsResult.value
            : current.workflowResults;
          return {
            aiSummary: aiSummaryResult.status === "fulfilled" ? aiSummaryResult.value : current.aiSummary,
            backendSummary: backendSummaryResult.status === "fulfilled" ? backendSummaryResult.value : current.backendSummary,
            results: workflowResultsResult.status === "fulfilled"
              ? workflowResults.filter(isDashboardAnomaly)
              : current.results,
            workflowResults,
            flows: flowsResult.status === "fulfilled" ? flowsResult.value : current.flows,
          };
        });
        const failed = [aiSummaryResult, backendSummaryResult, workflowResultsResult, flowsResult].filter((item) => item.status === "rejected") as PromiseRejectedResult[];
        setError(failed.length ? `Chargement partiel: ${failed.map((item) => errorMessage(item.reason)).join(" | ")}` : null);
      }
    }

    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/live/events");
    setStreamStatus("connecting");

    source.addEventListener("open", () => {
      setStreamStatus("live");
    });

    source.addEventListener("snapshot", (message) => {
      const payload = JSON.parse((message as MessageEvent).data) as LiveEvent[];
      setLiveEvents(payload.map((item) => ({ ...item, receivedAt: Date.now() })).slice(0, 200));
      setLastEventAt(Date.now());
    });

    source.addEventListener("live_event", (message) => {
      const payload = JSON.parse((message as MessageEvent).data) as LiveEvent;
      const receivedAt = Date.now();
      setLastEventAt(receivedAt);
      setLiveEvents((current) => {
        const next = [{ ...payload, receivedAt }, ...current.filter((item) => `${item.source}-${item.id}` !== `${payload.source}-${payload.id}`)];
        return next.slice(0, 200);
      });
      setSelectedLiveEvent((current) => current || { ...payload, receivedAt });
    });

    source.addEventListener("stream_error", (message) => {
      setStreamStatus("error");
      const payload = JSON.parse((message as MessageEvent).data) as { message?: string };
      setError(`SSE/realtime stream unavailable: ${payload.message || "Erreur SSE"}`);
    });

    source.onerror = () => {
      setStreamStatus("error");
    };

    return () => source.close();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const flowNames = useMemo(() => new Map(state.flows.map((flow) => [flow.flow_code, flow.flow_name])), [state.flows]);

  const severityItems = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    state.results.forEach((item) => {
      counts[item.severity] += 1;
    });
    return [
      { label: "critical", value: counts.critical, tone: "red" as const },
      { label: "high", value: counts.high, tone: "orange" as const },
      { label: "medium", value: counts.medium, tone: "blue" as const },
      { label: "low", value: counts.low, tone: "teal" as const },
    ];
  }, [state.results]);

  const topFlows = useMemo(() => {
    const counts = new Map<string, number>();
    state.results.forEach((item) => {
      const key = flowName(item.flow_code, flowNames);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value, tone: "teal" as const }));
  }, [flowNames, state.results]);

  const recentLiveEvents = useMemo(() => liveEvents.filter((item) => isRecent(item.timestamp, 1)), [liveEvents]);
  const filteredLiveEvents = useMemo(() => {
    const needle = liveQuery.trim().toLowerCase();
    return liveEvents.filter((item) => {
      const matchesFilter =
        liveFilter === "all" ||
        (liveFilter === "normal" && item.state === "NORMAL") ||
        (liveFilter === "anomalies" && item.state !== "NORMAL") ||
        (liveFilter === "critical" && item.state === "CRITICAL");
      const matchesQuery =
        !needle ||
        item.source.toLowerCase().includes(needle) ||
        item.state.toLowerCase().includes(needle) ||
        (item.flow_code || "").toLowerCase().includes(needle) ||
        flowName(item.flow_code, flowNames).toLowerCase().includes(needle) ||
        (item.api_code || "").toLowerCase().includes(needle) ||
        (item.consumer || "").toLowerCase().includes(needle) ||
        (item.provider || "").toLowerCase().includes(needle) ||
        (item.actor || "").toLowerCase().includes(needle) ||
        (item.anomalyType || "").toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [flowNames, liveEvents, liveFilter, liveQuery]);

  useEffect(() => {
    if (!selectedLiveEvent && liveEvents.length) {
      setSelectedLiveEvent(liveEvents[0]);
    }
  }, [liveEvents, selectedLiveEvent]);

  useEffect(() => {
    setSelectedLiveEvent((current) => {
      if (!current) return liveEvents[0] || null;
      const refreshed = liveEvents.find((item) => item.id === current.id && item.source === current.source);
      return refreshed && refreshed !== current ? refreshed : current;
    });
  }, [liveEvents]);

  const activeIncidents = useMemo(
    () => state.results.filter((item) => ["OPEN", "INVESTIGATING"].includes(getIncidentStatus(item))),
    [state.results],
  );

  const avgScore = Number(state.aiSummary?.avg_risk_score || 0);
  const risk = getRisk(avgScore);
  const liveLatencyAvg = average(recentLiveEvents.map((item) => item.latency_ms).filter((value): value is number => value !== null));
  const liveSuccessRate = percent(recentLiveEvents.filter((item) => item.success !== null && item.success).length, recentLiveEvents.filter((item) => item.success !== null).length);
  const liveSlaBreaches = recentLiveEvents.filter((item) => item.is_sla_breach).length;
  const slaCompliance = Math.max(0, 100 - percent(liveSlaBreaches, Math.max(recentLiveEvents.length, 1)));
  const eventRate = recentLiveEvents.length;
  const liveTraffic = useMemo(() => timeBuckets(liveEvents, "timestamp", 12, 1), [liveEvents]);
  const liveLatency = useMemo(() => latencyBuckets(liveEvents, 12, 1), [liveEvents]);
  const eventTrend = useMemo(() => eventTrendLabel(liveEvents), [liveEvents]);

  const recommendations = useMemo(() => {
    const seen = new Set<string>();
    return state.results
      .filter((item) => item.recommendation && (item.severity === "critical" || item.severity === "high"))
      .slice(0, 80)
      .filter((item) => {
        const key = `${item.detected_anomaly_type}-${item.flow_code}-${item.recommendation}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, 5);
  }, [state.results]);

  const criticalIncidents = activeIncidents.filter((item) => item.severity === "critical");
  const resolvedIncidents = state.results.filter((item) => getIncidentStatus(item) === "RESOLVED").length;
  const priorityIncidents = useMemo(
    () =>
      [...activeIncidents]
        .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.risk_score - left.risk_score)
        .slice(0, 5),
    [activeIncidents],
  );
  const anomalyFeed = useMemo(
    () =>
      [...state.results]
        .sort((left, right) => (parseDate(right.detected_at)?.getTime() || 0) - (parseDate(left.detected_at)?.getTime() || 0))
        .slice(0, 8),
    [state.results],
  );
  const propagatingIncidents = activeIncidents.filter((item) => isPropagationAnomaly(item.detected_anomaly_type));
  const criticalServices = criticalServicesFromIncidents(activeIncidents, flowNames);
  const platformStatus = getPlatformStatus(avgScore, criticalIncidents.length, propagatingIncidents.length, liveSlaBreaches, streamStatus);
  const primaryInsight = buildPrimaryInsight(priorityIncidents[0], propagatingIncidents.length, criticalServices, flowNames);
  const latestWorkflowResult = useMemo(
    () => {
      if (selectedLiveEvent) {
        return selectedLiveEvent.aiResult || findWorkflowResult(selectedLiveEvent, state.workflowResults);
      }
      return [...state.workflowResults]
        .sort((left, right) => (parseDate(right.detected_at)?.getTime() || 0) - (parseDate(left.detected_at)?.getTime() || 0))[0] || null;
    },
    [selectedLiveEvent, state.workflowResults],
  );
  const synchronizedSelectedLiveEvent = useMemo(
    () =>
      selectedLiveEvent && latestWorkflowResult && selectedLiveEvent.aiResult?.id !== latestWorkflowResult.id
        ? { ...selectedLiveEvent, aiResult: latestWorkflowResult }
        : selectedLiveEvent,
    [latestWorkflowResult, selectedLiveEvent],
  );
  const visibleError = error;
  return (
    <>
      <section className="executiveHeroV2">
        <div className="executiveHeroCopy">
          <span className="sectionEyebrow">Page 1</span>
          <h1>GISRE AI Supervision</h1>
          <strong>Realtime AI Supervision</strong>
          <div className={`platformStatusBadge ${platformStatus.tone}`}>
            <span>Platform Status</span>
            <strong>{platformStatus.label}</strong>
          </div>
        </div>
        <div className="executiveHeroSignal">
          <RiskScoreHero score={avgScore} tone={risk.tone} label={risk.label} />
          <div className="primaryAiInsight">
            <span>AI Insight</span>
            <strong>{primaryInsight.title}</strong>
            <p>{primaryInsight.body}</p>
          </div>
          <HeroLiveTicker items={liveEvents.slice(0, 4)} flowNames={flowNames} nowTick={nowTick} />
        </div>
      </section>

      <section className="executiveMetricStrip executiveMetricStripSix">
        <ExecutiveMetric label="events/min" value={eventRate} meta={eventTrend} tone="live" />
        <ExecutiveMetric label="active incidents" value={activeIncidents.length} meta={`${resolvedIncidents} resolved`} tone={criticalIncidents.length ? "critical" : "neutral"} />
        <ExecutiveMetric label="risk score" value={`${avgScore.toFixed(0)}/100`} meta={risk.label} tone={risk.tone} />
        <ExecutiveMetric label="SLA health" value={`${slaCompliance.toFixed(0)}%`} meta={`${liveSlaBreaches} breaches`} tone={liveSlaBreaches > 0 ? "high" : "live"} />
        <ExecutiveMetric label="propagating" value={propagatingIncidents.length} meta="incidents" tone={propagatingIncidents.length > 0 ? "ai" : "neutral"} />
        <ExecutiveMetric label="critical services" value={criticalServices.length} meta={criticalServices.slice(0, 2).join(", ") || "none"} tone={criticalServices.length > 0 ? "critical" : "live"} />
      </section>

      <section className="executiveLiveStreamSurface">
        <div className="executiveSurfaceHeader">
          <div>
            <span>Realtime Kafka Event Stream</span>
            <p>Arrivee des evenements API et audit un par un depuis le simulateur, Kafka, backend et AI layer.</p>
          </div>
          <strong>{streamStatus === "live" ? "live" : streamStatus}</strong>
        </div>
        <RealtimeKafkaWorkflow
          embedded
          eventTimestamp={synchronizedSelectedLiveEvent?.timestamp || null}
          result={latestWorkflowResult}
          results={state.workflowResults}
          streamStatus={streamStatus}
        />
        <LiveEventsConsole
          items={filteredLiveEvents}
          totalCount={liveEvents.length}
          flowNames={flowNames}
          nowTick={nowTick}
          filter={liveFilter}
          setFilter={setLiveFilter}
          query={liveQuery}
          setQuery={setLiveQuery}
          selected={synchronizedSelectedLiveEvent}
          setSelected={setSelectedLiveEvent}
        />
      </section>

      {visibleError && <div className="errorBox">Impossible de charger les donnees: {visibleError}</div>}

      <section className="executiveFocusGrid">
        <div className="executiveTopologySurface">
          <div className="executiveSurfaceHeader topologyHeader">
            <div>
              <span>Flow Impact Matrix</span>
              <p>Vue operationnelle des flows impactes, latence, SLA, anomalies IA et risque de propagation.</p>
            </div>
            <strong>{risk.label}</strong>
          </div>
          <TopologyGraph incidents={priorityIncidents} liveEvents={recentLiveEvents} flows={state.flows} flowNames={flowNames} />
        </div>

        <aside className="executiveIncidentRail">
          <div className="railSectionTitle">
            <span>Live AI Incidents</span>
            <strong>{priorityIncidents.length}</strong>
          </div>
          <LiveIncidentCards items={priorityIncidents} flowNames={flowNames} nowTick={nowTick} />
          <StreamHealthCard streamStatus={streamStatus} lastEventAt={lastEventAt} nowTick={nowTick} eventRate={eventRate} />
        </aside>
      </section>

      <section className="executiveAsymmetricGrid">
        <div className="executiveWideSurface">
          <div className="executiveSurfaceHeader">
            <span>Realtime Curves</span>
            <strong>{liveLatencyAvg === null ? "latency n/a" : `${Math.round(liveLatencyAvg)} ms avg`}</strong>
          </div>
          <div className="executiveTrendPair">
            <MiniTrend title="Traffic" subtitle="" items={liveTraffic} tone="blue" />
            <LineTrend title="Latency" items={liveLatency} tone="orange" suffix=" ms" />
          </div>
        </div>

        <div className="executiveFeedSurface">
          <div className="executiveSurfaceHeader">
            <span>Live Anomaly Feed</span>
            <strong>{activeIncidents.length}</strong>
          </div>
          <LiveAnomalyFeed items={anomalyFeed} flowNames={flowNames} nowTick={nowTick} />
        </div>
      </section>

      <section className="executiveBottomGrid">
        <div className="executiveInvisibleBlock">
          <div className="executiveSurfaceHeader">
            <span>Severity</span>
            <strong>distribution</strong>
          </div>
          <SeverityDonut items={severityItems} />
        </div>
        <div className="executiveInvisibleBlock">
          <div className="executiveSurfaceHeader">
            <span>Top flows</span>
            <strong>impact</strong>
          </div>
          <BarChart items={topFlows} />
        </div>
        <div className="executiveInvisibleBlock">
          <div className="executiveSurfaceHeader">
            <span>Priority Recommendations</span>
            <strong>{recommendations.length}</strong>
          </div>
          <PriorityRecommendations items={recommendations.slice(0, 3)} flowNames={flowNames} />
        </div>
      </section>
    </>
  );
}

function HeroPill({
  label,
  value,
  trend,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  trend: string;
  tone?: "neutral" | "live" | "critical";
}) {
  return (
    <div className={`heroPillV2 ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      <em>{trend}</em>
    </div>
  );
}

function RiskScoreHero({ score, tone, label }: { score: number; tone: string; label: string }) {
  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className={`riskScoreHero ${tone}`}>
      <span>Global Risk Score</span>
      <strong>{normalized}<small>/100</small></strong>
      <em>{label}</em>
      <div className="riskScoreTrack">
        <i style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}

function ExecutiveMetric({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  meta: string;
  tone?: "neutral" | "live" | "ai" | "critical" | "high" | "medium" | "low";
}) {
  return (
    <div className={`executiveMetric ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      <em>{meta}</em>
    </div>
  );
}

function TopologyGraph({
  incidents,
  liveEvents,
  flows,
  flowNames,
}: {
  incidents: AiResult[];
  liveEvents: LiveEvent[];
  flows: FlowMetric[];
  flowNames: Map<string, string>;
}) {
  const flowModels = buildTopologyFlowModels(incidents, liveEvents, flows, flowNames);
  const rows = flowModels.length ? flowModels : buildTopology(incidents, liveEvents, flows, flowNames).nodes
    .filter((item) => !["gateway", "ai"].includes(item.id))
    .map((item) => ({
      id: item.id,
      flowCode: item.id,
      label: item.label,
      sublabel: item.sublabel,
      anomalyType: item.statusLabel || "UNKNOWN_ANOMALY",
      state: item.state,
      statusLabel: item.statusLabel,
      anomalies: item.anomalies,
      latencyMs: item.latencyMs,
      criticality: item.criticality,
      riskScore: 0,
      propagationRisk: item.state === "critical" ? "watch" : item.state === "degraded" ? "local" : "low",
      ai: item.ai,
      edgeState: item.state,
      edgeLabel: item.statusLabel,
    }));
  const groups = buildFlowImpactGroups(rows);
  return (
    <div className="flowImpactMatrix">
      <div className="flowImpactSummary">
        <div>
          <span>Supervised flows</span>
          <strong>{rows.length}</strong>
        </div>
        <div>
          <span>Degraded</span>
          <strong>{rows.filter((item) => item.state === "degraded").length}</strong>
        </div>
        <div>
          <span>Critical</span>
          <strong>{rows.filter((item) => item.state === "critical").length}</strong>
        </div>
        <div>
          <span>AI flagged</span>
          <strong>{rows.filter((item) => item.ai).length}</strong>
        </div>
      </div>
      <div className="flowImpactGroups">
        {groups.map((group, index) => (
          <details className={`flowImpactGroup ${group.visualLevel}`} key={group.anomalyType} open={index < 3}>
            <summary>
              <div className="flowImpactGroupIdentity">
                <span className={`anomalyVisualBadge ${group.visualLevel}`}>{group.anomalyType}</span>
                <strong>{group.flows.length} flow{group.flows.length > 1 ? "s" : ""} impacted</strong>
              </div>
              <div className="flowImpactGroupMetrics">
                <span><small>Max risk</small><strong>{group.maxCriticality} · {group.maxRiskScore}/100</strong></span>
                <span><small>Average latency</small><strong>{group.averageLatencyMs === null ? "n/a" : `${group.averageLatencyMs} ms`}</strong></span>
                <span><small>Anomalies</small><strong>{group.anomalyCount}</strong></span>
              </div>
              <span className="flowImpactChevron" aria-hidden="true">v</span>
            </summary>
            <div className="flowImpactGroupRows">
              {group.flows.map((row) => (
                <div
                  className={`flowImpactRow anomalyVisualRow ${group.visualLevel} ${row.ai ? "ai" : ""}`}
                  key={`${group.anomalyType}-${row.id}`}
                >
                  <div>
                    <strong>{row.flowCode}</strong>
                    <span>{row.sublabel}</span>
                  </div>
                  <div>
                    <span>Status</span>
                    <em>{stateLabel(row.state)}</em>
                  </div>
                  <div>
                    <span>Risk</span>
                    <em>{row.riskScore}/100</em>
                  </div>
                  <div>
                    <span>Latency</span>
                    <em>{row.latencyMs === null ? "n/a" : `${row.latencyMs} ms`}</em>
                  </div>
                  <div>
                    <span>Criticality</span>
                    <em>{row.criticality}</em>
                  </div>
                  <div>
                    <span>Propagation risk</span>
                    <b>{row.propagationRisk}</b>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function buildFlowImpactGroups(rows: TopologyFlowModel[]): FlowImpactGroup[] {
  const groups = new Map<string, TopologyFlowModel[]>();
  rows.forEach((row) => {
    const anomalyType = normalizeImpactAnomalyType(row.anomalyType);
    groups.set(anomalyType, [...(groups.get(anomalyType) || []), row]);
  });

  return [...groups.entries()]
    .map(([anomalyType, groupFlows]) => {
      const sortedFlows = [...groupFlows].sort(
        (left, right) =>
          right.riskScore - left.riskScore
          || impactCriticalityRank(right.criticality) - impactCriticalityRank(left.criticality),
      );
      const latencies = sortedFlows
        .map((flow) => flow.latencyMs)
        .filter((value): value is number => value !== null);
      const maxCriticality = [...sortedFlows]
        .sort((left, right) => impactCriticalityRank(right.criticality) - impactCriticalityRank(left.criticality))[0]
        ?.criticality || "standard";
      const maxRiskScore = Math.max(0, ...sortedFlows.map((flow) => flow.riskScore));
      const visualLevel = getAnomalyVisualLevel(anomalyType, maxCriticality);
      return {
        anomalyType,
        visualLevel,
        flows: sortedFlows,
        anomalyCount: sortedFlows.reduce((total, flow) => total + flow.anomalies, 0),
        averageLatencyMs: latencies.length ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : null,
        maxRiskScore,
        maxCriticality,
      };
    })
    .sort(
      (left, right) =>
        impactVisualRank(right.visualLevel) - impactVisualRank(left.visualLevel)
        || right.maxRiskScore - left.maxRiskScore
        || right.flows.length - left.flows.length,
    );
}

function TopologyNode({ node }: { node: TopologyNodeModel }) {
  return (
    <foreignObject
      x={node.x - node.width / 2}
      y={node.y - node.height / 2}
      width={node.width}
      height={node.height}
      className={`topologyNodeBox ${node.state} ${node.ai ? "ai" : ""}`}
      filter={node.state === "critical" ? "url(#softGlow)" : undefined}
    >
      <div className="topologyNodeCard">
        <strong>{node.label}</strong>
        <b>{node.sublabel}</b>
        <span>{node.anomalies} anomalies</span>
        <em>{node.latencyMs === null ? "latency n/a" : `${node.latencyMs} ms`}</em>
        <small>{node.statusLabel} / {node.criticality}</small>
      </div>
    </foreignObject>
  );
}

function LiveEventsConsole({
  items,
  totalCount,
  flowNames,
  nowTick,
  filter,
  setFilter,
  query,
  setQuery,
  selected,
  setSelected,
}: {
  items: LiveEvent[];
  totalCount: number;
  flowNames: Map<string, string>;
  nowTick: number;
  filter: LiveFilter;
  setFilter: (value: LiveFilter) => void;
  query: string;
  setQuery: (value: string) => void;
  selected: LiveEvent | null;
  setSelected: (value: LiveEvent) => void;
}) {
  return (
    <>
      <div className="liveFilters">
        <div className="filterGroup">
          {[
            ["all", "Tous"],
            ["normal", "Normaux"],
            ["anomalies", "Anomalies"],
            ["critical", "Critiques"],
          ].map(([value, label]) => (
            <button
              className={filter === value ? "active" : ""}
              key={value}
              type="button"
              onClick={() => setFilter(value as LiveFilter)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="input"
          placeholder="Filtrer par producteur, consumer, API, flow ou type anomalie"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="liveGrid">
        <div className="card liveFeedCard">
          <div className="cardHeader">
            <h2>Flux live des evenements</h2>
            <div className="liveHeaderActions">
              <span>{items.length} / {totalCount} evenements affiches</span>
            </div>
          </div>
          <div className="cardBody">
            {items.length === 0 ? (
              <p className="muted">En attente des prochains evenements Kafka...</p>
            ) : (
              <div className="liveFeed">
                {items.slice(0, 120).map((item, index) => (
                  <button
                    className={`liveRow anomalyVisualRow ${getAnomalyVisualLevel(item.anomalyType || item.state, item.aiResult?.severity)} ${index === 0 ? "fresh" : ""} ${selected && selected.id === item.id && selected.source === item.source ? "selected" : ""}`}
                    key={`${item.source}-${item.id}`}
                    type="button"
                    onClick={() => setSelected(item)}
                  >
                    <time className="liveTime">{clockTime(item.timestamp)}</time>
                    <span className="liveFlow">{flowName(item.flow_code, flowNames)}</span>
                    <span className="liveApi">{item.api_code || item.source}</span>
                    <span className="liveLatency">{item.latency_ms === null ? "-" : `${item.latency_ms}ms`}</span>
                    <span className={`liveBadge anomalyVisualBadge ${getAnomalyVisualLevel(item.anomalyType || item.state, item.aiResult?.severity)}`}>
                      <em>NEW</em>{item.anomalyType || item.state}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card liveDetailCard">
          <div className="cardHeader">
            <h2>Detail evenement</h2>
          </div>
          <div className="cardBody">
            {selected ? (
              <LiveEventDetail event={selected} flowNames={flowNames} nowTick={nowTick} />
            ) : (
              <p className="muted">Clique sur un evenement du flux pour voir le contexte complet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function LiveEventDetail({ event, flowNames, nowTick }: { event: LiveEvent; flowNames: Map<string, string>; nowTick: number }) {
  const aiResult = event.aiResult;
  const detector = selectPrimaryDetector(aiResult);
  const detectorLevel = aiResult
    ? getAnomalyVisualLevel(detector.anomalyType, aiResult.severity)
    : getAnomalyVisualLevel(event.anomalyType || event.state);
  const eventLevel = getAnomalyVisualLevel(event.anomalyType || event.state, aiResult?.severity);
  const incidentStatus = aiResult
    ? getIncidentStatus(aiResult)
    : eventLevel === "success"
      ? "CLOSED"
      : "OPEN";
  const incidentType = aiResult?.detected_anomaly_type || event.anomalyType || event.state;
  const recommendation = aiResult?.recommendation
    || aiResult?.explanation
    || "Aucun resultat IA n'est encore associe a cet evenement.";

  return (
    <div className={`liveDetail liveIncidentVertical anomalyVisualRow ${eventLevel}`}>
      <section className="liveIncidentVerticalTable" aria-label="Detail evenement">
        <VerticalDetailRow label="Type">
          <span className={`anomalyVisualBadge ${eventLevel}`}>{incidentType}</span>
        </VerticalDetailRow>
        <VerticalDetailRow label="Flux metier">
          <>
            {flowName(event.flow_code, flowNames)}
            <small>{event.flow_code || "n/a"} / {event.api_code || event.source}</small>
          </>
        </VerticalDetailRow>
        <VerticalDetailRow label="Detecteur IA">
          <span className={`modelDetectionBadge ${detector.available ? "rules" : ""}`}>
            <span>{aiResult ? detector.name : "Signal evenementiel"}</span>
            <small>{aiResult ? detector.level : "SOURCE EVENT"}</small>
          </span>
        </VerticalDetailRow>
        <VerticalDetailRow label="Statut">
          <span className={`incidentStatus ${incidentStatus.toLowerCase()}`}>{incidentStatus}</span>
        </VerticalDetailRow>
        <VerticalDetailRow label="Severity">
          <span className={`severityBadgeInline anomalyVisualBadge ${detectorLevel}`}>
            {aiResult
              ? getAnomalyVisualLabel(aiResult.detected_anomaly_type, aiResult.severity)
              : getAnomalyVisualLabel(event.anomalyType || event.state)}
          </span>
        </VerticalDetailRow>
        <VerticalDetailRow label="Score">
          <span className="score">{aiResult ? aiResult.risk_score : "n/a"}</span>
        </VerticalDetailRow>
        <VerticalDetailRow label="Recommandation">
          {recommendation}
        </VerticalDetailRow>
        <VerticalDetailRow label="Detail">
          <>
            {aiResult ? (
              <Link className="button" href={`/incidents/${aiResult.id}`}>
                Ouvrir
              </Link>
            ) : (
              <span className="button disabled">Indisponible</span>
            )}
          </>
        </VerticalDetailRow>
      </section>

      <section className="liveEventTechnicalContext" aria-label="Contexte technique">
        <div><span>Source</span><strong>{event.source}</strong></div>
        <div><span>Consumer / actor</span><strong>{event.consumer || event.actor || "n/a"}</strong></div>
        <div><span>Provider</span><strong>{event.provider || liveProducer(event) || "n/a"}</strong></div>
        <div><span>Status</span><strong>{event.status_code ?? "n/a"}</strong></div>
        <div><span>Latency</span><strong>{event.latency_ms === null ? "n/a" : `${event.latency_ms} ms`}</strong></div>
        <div><span>SLA breach</span><strong>{event.is_sla_breach ? "yes" : "no"}</strong></div>
        <div><span>Correlation</span><strong>{event.correlation_id || "n/a"}</strong></div>
        <div><span>Recu</span><strong>{relativeTime(event.timestamp, nowTick)}</strong></div>
      </section>

      <details className="liveRaw">
        <summary>Payload brut</summary>
        <pre>{JSON.stringify(event.raw, null, 2)}</pre>
      </details>
    </div>
  );
}

function VerticalDetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="liveIncidentVerticalRow">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

type PrimaryDetector = {
  available: boolean;
  level: "EVENT_LEVEL" | "FLOW_LEVEL" | "UNAVAILABLE";
  name: string;
  id: string;
  version: string;
  anomalyType: string;
  confidence: string;
  riskContribution: string;
  decisionNextLevel: string;
  decisionReason: string;
};

function selectPrimaryDetector(aiResult: AiResult | null): PrimaryDetector {
  const unavailable: PrimaryDetector = {
    available: false,
    level: "UNAVAILABLE",
    name: "Detector unavailable",
    id: "unavailable",
    version: "unavailable",
    anomalyType: "unavailable",
    confidence: "unavailable",
    riskContribution: "unavailable",
    decisionNextLevel: "unavailable",
    decisionReason: "unavailable",
  };
  if (!aiResult) return unavailable;

  const metadata = dashboardRecord(aiResult.metadata);
  const analysisTrace = dashboardRecord(metadata.analysis_trace);
  const flowTrace = dashboardRecord(analysisTrace.flow);
  const eventTrace = dashboardRecord(analysisTrace.event);
  const flowExecuted = flowTrace.executed === true;
  const flowAnomaly = flowTrace.anomaly_detected === true;
  const selectedTrace = flowExecuted && flowAnomaly
    ? flowTrace
    : Object.keys(eventTrace).length > 0
      ? eventTrace
      : null;
  const selectedLevel: PrimaryDetector["level"] = selectedTrace === flowTrace
    ? "FLOW_LEVEL"
    : "EVENT_LEVEL";

  if (selectedTrace) {
    const id = dashboardString(selectedTrace.selected_model_id);
    const name = dashboardString(selectedTrace.selected_model_name) || id;
    if (id || name) {
      return {
        available: true,
        level: selectedLevel,
        name: name || "Detector unavailable",
        id: id || "unavailable",
        version: dashboardString(selectedTrace.selected_model_version) || "unavailable",
        anomalyType: dashboardString(selectedTrace.anomaly_type) || aiResult.detected_anomaly_type || "NORMAL",
        confidence: dashboardMetric(selectedTrace.confidence, true),
        riskContribution: dashboardMetric(selectedTrace.risk_contribution),
        decisionNextLevel: dashboardString(selectedTrace.decision_next_level) || "unavailable",
        decisionReason: dashboardString(selectedTrace.decision_reason) || "unavailable",
      };
    }
  }

  const legacyResult = dashboardRecord(aiResult);
  const legacyModel = dashboardRecord(metadata.model);
  const legacyId = dashboardString(legacyResult.model_id)
    || dashboardString(metadata.model_id)
    || dashboardString(legacyModel.id);
  const legacyName = dashboardString(legacyResult.model_name)
    || dashboardString(metadata.model_name)
    || dashboardString(legacyModel.name)
    || legacyId;
  if (!legacyId && !legacyName) return unavailable;

  return {
    available: true,
    level: "EVENT_LEVEL",
    name: legacyName || "Detector unavailable",
    id: legacyId || "unavailable",
    version: dashboardString(legacyResult.model_version)
      || dashboardString(metadata.model_version)
      || dashboardString(legacyModel.version)
      || "unavailable",
    anomalyType: aiResult.detected_anomaly_type || "NORMAL",
    confidence: dashboardMetric(aiResult.confidence, true),
    riskContribution: dashboardMetric(aiResult.risk_score),
    decisionNextLevel: "unavailable",
    decisionReason: "Legacy result - analysis trace not available",
  };
}

function dashboardRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function findWorkflowResult(event: LiveEvent, results: AiResult[]) {
  const candidates = results.filter((result) => {
    if (result.source_event_type !== event.source) return false;
    if (result.source_event_id === event.id) return true;
    return Boolean(
      event.correlation_id
      && dashboardString(dashboardRecord(result.metadata).correlation_id) === event.correlation_id,
    );
  });

  return (
    candidates.find((result) => {
      const trace = dashboardRecord(dashboardRecord(result.metadata).analysis_trace);
      return Object.keys(dashboardRecord(trace.event)).length > 0;
    })
    || candidates.find((result) => dashboardString(dashboardRecord(result.metadata).analysis_level) === "event")
    || candidates[0]
    || null
  );
}

function dashboardString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "";
}

function dashboardMetric(value: unknown, confidence = false) {
  if (value === null || value === undefined || value === "") return "unavailable";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (confidence && numeric <= 1) return `${Math.round(numeric * 100)}%`;
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function HeroLiveTicker({ items, flowNames, nowTick }: { items: LiveEvent[]; flowNames: Map<string, string>; nowTick: number }) {
  return (
    <div className="heroLiveTicker">
      <div className="heroLiveTickerHeader">
        <span><i /> Live event arrival</span>
        <strong>{items.length ? compactTime(items[0].timestamp, nowTick) : "waiting"}</strong>
      </div>
      <div className="heroLiveTickerRows">
        {items.length ? items.map((item) => (
          <div className={`heroLiveTickerRow ${getAnomalyVisualLevel(item.anomalyType || item.state, item.aiResult?.severity)}`} key={`${item.source}-${item.id}`}>
            <b>{item.source === "api_call" ? "API" : "AUDIT"}</b>
            <span>{item.flow_code || flowName(item.flow_code, flowNames)}</span>
            <em>{item.anomalyType || item.state}</em>
          </div>
        )) : (
          <div className="heroLiveTickerRow">
            <b>SSE</b>
            <span>waiting for Kafka events</span>
            <em>connecting</em>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveIncidentCards({ items, flowNames, nowTick }: { items: AiResult[]; flowNames: Map<string, string>; nowTick: number }) {
  if (items.length === 0) {
    return <p className="muted">Aucun incident IA actif.</p>;
  }
  return (
    <div className="liveIncidentCards">
      {items.slice(0, 3).map((item) => (
        <article className={`liveIncidentCard anomalyVisualRow ${getAnomalyVisualLevel(item.detected_anomaly_type, item.severity)}`} key={item.id}>
          <div className="incidentBadges">
            <span className={`severityBadgeInline anomalyVisualBadge ${getAnomalyVisualLevel(item.detected_anomaly_type, item.severity)}`}>
              {getAnomalyVisualLabel(item.detected_anomaly_type, item.severity)}
            </span>
            <span className="statusBadgeInline">{getIncidentStatus(item).toLowerCase()}</span>
          </div>
          <h3>{item.detected_anomaly_type}</h3>
          <p className="incidentFlow">{flowName(item.flow_code, flowNames)}</p>
          <div className="incidentMetaLine">
            <span>Risk {item.risk_score}</span>
            <span>Confidence {formatConfidence(item.confidence)}</span>
            <span>{analysisLevel(item)} level</span>
            <span>{detectorName(item)}</span>
            <span>{relativeTime(item.detected_at, nowTick)}</span>
          </div>
          <p>{item.explanation || incidentFallback(item)}</p>
          <strong>Recommandation: {item.recommendation || "prioriser l'investigation du flow impacte."}</strong>
          <Link className="incidentOpenButton" href={`/incidents/${item.id}`}>
            Open incident
          </Link>
        </article>
      ))}
    </div>
  );
}

function StreamHealthCard({
  streamStatus,
  lastEventAt,
  nowTick,
  eventRate,
}: {
  streamStatus: "connecting" | "live" | "error";
  lastEventAt: number | null;
  nowTick: number;
  eventRate: number;
}) {
  const connected = streamStatus === "live";
  const lastAge = lastEventAt ? `${Math.max(0, Math.round((nowTick - lastEventAt) / 1000))}s ago` : "waiting";
  return (
    <div className={`streamHealthCard ${connected ? "live" : "error"}`}>
      <div>
        <span>Stream Health</span>
        <strong>{connected ? "SSE connected" : streamStatus === "connecting" ? "SSE connecting" : "SSE disconnected"}</strong>
      </div>
      <dl>
        <div>
          <dt>Last event</dt>
          <dd>{lastAge}</dd>
        </div>
        <div>
          <dt>Events/min</dt>
          <dd>{eventRate}</dd>
        </div>
        <div>
          <dt>Pipeline</dt>
          <dd>{`Kafka -> AI -> Dashboard ${connected ? "active" : "check"}`}</dd>
        </div>
      </dl>
    </div>
  );
}

function LiveAnomalyFeed({ items, flowNames, nowTick }: { items: AiResult[]; flowNames: Map<string, string>; nowTick: number }) {
  if (items.length === 0) {
    return <p className="muted">Aucune anomalie live.</p>;
  }
  return (
    <div className="liveAnomalyFeed">
      {items.map((item) => (
        <div className={`anomalyFeedRow anomalyVisualRow ${getAnomalyVisualLevel(item.detected_anomaly_type, item.severity)}`} key={item.id}>
          <time>{compactTime(item.detected_at, nowTick)}</time>
          <span className={`feedDot ${getAnomalyVisualLevel(item.detected_anomaly_type, item.severity)}`} />
          <strong>{item.detected_anomaly_type}</strong>
          <em>{item.flow_code || flowName(item.flow_code, flowNames)}</em>
          <small>{detectorName(item)}</small>
          <b>{item.risk_score}</b>
        </div>
      ))}
    </div>
  );
}

function PriorityRecommendations({ items, flowNames }: { items: AiResult[]; flowNames: Map<string, string> }) {
  if (items.length === 0) {
    return <p className="muted">Aucune action prioritaire.</p>;
  }
  return (
    <div className="executiveActions">
      {items.map((item) => (
        <div key={item.id}>
          <span>{flowName(item.flow_code, flowNames)}</span>
          <strong>{item.recommendation}</strong>
        </div>
      ))}
    </div>
  );
}

function SeverityDonut({ items }: { items: Array<{ label: string; value: number; tone: "red" | "orange" | "blue" | "teal" }> }) {
  const total = Math.max(items.reduce((sum, item) => sum + item.value, 0), 1);
  let cursor = 0;
  const palette = { red: "#dc2626", orange: "#d97706", blue: "#2563eb", teal: "#0f766e" };
  const segments = items.map((item) => {
    const start = cursor;
    const size = (item.value / total) * 100;
    cursor += size;
    return `${palette[item.tone]} ${start}% ${cursor}%`;
  });
  const top = [...items].sort((left, right) => right.value - left.value)[0];
  return (
    <div className="severityDonutPanel">
      <div className="severityDonut" style={{ background: `conic-gradient(${segments.join(", ")})` }}>
        <div>
          <strong>{total === 1 && items.every((item) => item.value === 0) ? 0 : total}</strong>
          <span>signals</span>
        </div>
      </div>
      <div className="severityLegend">
        {items.map((item) => (
          <span key={item.label}>
            <i className={item.tone} />
            {item.label} <b>{item.value}</b>
          </span>
        ))}
      </div>
      <p className="muted">Dominant: {top?.label || "none"}</p>
    </div>
  );
}

function flowName(flowCode: string | null, flowNames: Map<string, string>) {
  if (!flowCode) {
    return "unknown";
  }
  return flowNames.get(flowCode) || flowCode;
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecent(value: string | null | undefined, minutes: number) {
  const date = parseDate(value);
  if (!date) {
    return false;
  }
  return Date.now() - date.getTime() <= minutes * 60000;
}

function getRisk(score: number) {
  if (score >= 80) {
    return { label: "CRITIQUE", tone: "critical" as const };
  }
  if (score >= 65) {
    return { label: "ELEVE", tone: "high" as const };
  }
  if (score >= 45) {
    return { label: "MODERE", tone: "medium" as const };
  }
  return { label: "FAIBLE", tone: "low" as const };
}

function getPlatformStatus(
  riskScore: number,
  criticalCount: number,
  propagationCount: number,
  slaBreaches: number,
  streamStatus: "connecting" | "live" | "error",
) {
  if (streamStatus === "error" || riskScore >= 80 || criticalCount >= 3) {
    return { label: "CRITICAL", tone: "critical" as const };
  }
  if (propagationCount > 0 || riskScore >= 60) {
    return { label: "UNSTABLE", tone: "critical" as const };
  }
  if (slaBreaches > 0 || riskScore >= 30 || streamStatus === "connecting") {
    return { label: "DEGRADED", tone: "high" as const };
  }
  return { label: "HEALTHY", tone: "live" as const };
}

function severityRank(severity: AiResult["severity"]) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

function buildPrimaryInsight(
  incident: AiResult | undefined,
  propagationCount: number,
  criticalServices: string[],
  flowNames: Map<string, string>,
) {
  if (!incident) {
    return {
      title: "No active AI incident",
      body: "Traffic remains within the expected operating envelope.",
    };
  }
  if (propagationCount > 0) {
    return {
      title: `${incident.detected_anomaly_type} propagating`,
      body: `AI detected abnormal dependency propagation around ${flowName(incident.flow_code, flowNames)}.`,
    };
  }
  if (criticalServices.length > 0) {
    return {
      title: `${criticalServices[0]} service impacted`,
      body: `${incident.detected_anomaly_type} is affecting a critical supervised dependency.`,
    };
  }
  return {
    title: incident.detected_anomaly_type,
    body: `${flowName(incident.flow_code, flowNames)} requires attention. Risk ${incident.risk_score}/100.`,
  };
}

function criticalServicesFromIncidents(incidents: AiResult[], flowNames: Map<string, string>) {
  return [
    ...new Set(
      incidents
        .filter((item) => item.severity === "critical" || item.severity === "high")
        .map((item) => (item.flow_code ? inferServiceName(item.flow_code, flowNames) : null))
        .filter(Boolean) as string[],
    ),
  ].slice(0, 4);
}

function buildTopology(
  incidents: AiResult[],
  liveEvents: LiveEvent[],
  flows: FlowMetric[],
  flowNames: Map<string, string>,
): { nodes: TopologyNodeModel[]; edges: TopologyEdgeModel[] } {
  const priority = incidents[0] || null;
  const flowModels = buildTopologyFlowModels(incidents, liveEvents, flows, flowNames);
  const incidentByFlow = new Map<string, AiResult[]>();
  incidents.forEach((item) => {
    if (!item.flow_code) {
      return;
    }
    const current = incidentByFlow.get(item.flow_code) || [];
    current.push(item);
    incidentByFlow.set(item.flow_code, current);
  });

  const servicePositions = [
    { x: 565, y: 86, labelX: 446, labelY: 120 },
    { x: 620, y: 190, labelX: 475, labelY: 178 },
    { x: 548, y: 304, labelX: 450, labelY: 284 },
    { x: 405, y: 324, labelX: 382, labelY: 260 },
  ];

  const gatewayState = incidents.some((item) => item.severity === "critical")
    ? "critical"
    : incidents.some((item) => item.severity === "high" || item.severity === "medium")
      ? "degraded"
      : "healthy";

  const nodes: TopologyNodeModel[] = [
    {
      id: "gisre",
      label: "GISRE",
      sublabel: "Supervision platform",
      x: 106,
      y: 202,
      width: 138,
      height: 108,
      state: liveEvents.some((item) => item.state === "CRITICAL") ? "degraded" : "healthy",
      anomalies: incidents.length,
      latencyMs: average(liveEvents.map((item) => item.latency_ms).filter((value): value is number => value !== null)) === null
        ? null
        : Math.round(average(liveEvents.map((item) => item.latency_ms).filter((value): value is number => value !== null)) || 0),
      criticality: "platform",
      statusLabel: liveEvents.some((item) => item.state === "CRITICAL") ? "degraded" : "healthy",
      ai: incidents.length > 0,
    },
    {
      id: "api",
      label: "API",
      sublabel: "Interoperability layer",
      x: 286,
      y: 202,
      width: 138,
      height: 108,
      state: gatewayState,
      anomalies: incidents.length,
      latencyMs: average(liveEvents.map((item) => item.latency_ms).filter((value): value is number => value !== null)) === null
        ? null
        : Math.round(average(liveEvents.map((item) => item.latency_ms).filter((value): value is number => value !== null)) || 0),
      criticality: priority?.severity || "normal",
      statusLabel: stateLabel(gatewayState),
      ai: incidents.length > 0,
    },
  ];

  flowModels.slice(0, 4).forEach((flow, index) => {
    const position = servicePositions[index];
    nodes.push({
      id: flow.id,
      label: flow.label,
      sublabel: flow.sublabel,
      x: position.x,
      y: position.y,
      width: 164,
      height: 116,
      state: flow.state,
      anomalies: flow.anomalies,
      latencyMs: flow.latencyMs,
      criticality: flow.criticality,
      statusLabel: flow.statusLabel,
      ai: flow.ai,
    });
  });

  const edges: TopologyEdgeModel[] = [
    {
      id: "gisre-api",
      path: "M175 202 C205 202, 232 202, 217 202",
      state: gatewayState,
      label: `${liveEvents.length}/min`,
      labelX: 197,
      labelY: 184,
      propagation: false,
    },
  ];

  nodes.slice(2).forEach((node, index) => {
    const flow = flowModels[index];
    const relatedFlow = flow?.flowCode;
    const related = relatedFlow ? incidentByFlow.get(relatedFlow) || [] : [];
    const propagation = related.some((item) => isPropagationAnomaly(item.detected_anomaly_type));
    const edgeState = flow?.edgeState || node.state;
    const startY = 202;
    const controlY = node.y < 202 ? 126 : node.y > 260 ? 284 : 202;
    const position = servicePositions[index];
    edges.push({
      id: `api-${node.id}`,
      path: `M355 ${startY} C420 ${controlY}, 470 ${controlY}, ${node.x - 86} ${node.y}`,
      state: edgeState,
      label: flow?.edgeLabel || edgeLabel(related, relatedFlow, flows, liveEvents),
      labelX: position.labelX,
      labelY: position.labelY,
      propagation,
    });
  });

  return { nodes, edges };
}

function buildTopologyFlowModels(incidents: AiResult[], liveEvents: LiveEvent[], flows: FlowMetric[], flowNames: Map<string, string>): TopologyFlowModel[] {
  const candidates = new Map<string, { flowCode: string; incidents: AiResult[]; events: LiveEvent[]; metric?: FlowMetric }>();

  incidents.forEach((incident) => {
    const flowCode = incident.flow_code || "unknown";
    const current = candidates.get(flowCode) || { flowCode, incidents: [], events: [], metric: flows.find((flow) => flow.flow_code === flowCode) };
    current.incidents.push(incident);
    candidates.set(flowCode, current);
  });

  liveEvents.forEach((event) => {
    if (!event.flow_code) {
      return;
    }
    const current = candidates.get(event.flow_code) || { flowCode: event.flow_code, incidents: [], events: [], metric: flows.find((flow) => flow.flow_code === event.flow_code) };
    current.events.push(event);
    candidates.set(event.flow_code, current);
  });

  if (candidates.size === 0) {
    flows.slice(0, 4).forEach((flow) => {
      candidates.set(flow.flow_code, { flowCode: flow.flow_code, incidents: [], events: [], metric: flow });
    });
  }

  return [...candidates.values()]
    .sort((left, right) => flowPriority(right) - flowPriority(left))
    .map((item) => {
      const topIncident = [...item.incidents].sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.risk_score - left.risk_score)[0];
      const topEvent = [...item.events].sort(
        (left, right) => Number(right.aiResult?.risk_score || 0) - Number(left.aiResult?.risk_score || 0),
      )[0];
      const anomalyType = topIncident?.detected_anomaly_type
        || topEvent?.aiResult?.detected_anomaly_type
        || topEvent?.anomalyType
        || ("anomaly_type" in (topEvent?.raw || {}) ? String((topEvent?.raw as ApiCallEvent | AuditEvent).anomaly_type || "") : "")
        || (topEvent?.is_sla_breach ? "SLA_BREACH" : "UNKNOWN_ANOMALY");
      const riskScore = Number(topIncident?.risk_score ?? topEvent?.aiResult?.risk_score ?? 0);
      const anomalyCount = item.incidents.length + item.events.filter((event) => event.anomalyType || event.state !== "NORMAL" || event.is_sla_breach).length;
      const latency = average(item.events.map((event) => event.latency_ms).filter((value): value is number => value !== null));
      const metricLatency = item.metric ? Math.round(Number(item.metric.avg_latency_ms || 0)) : null;
      const state: TopologyState = topIncident?.severity === "critical"
        ? "critical"
        : topIncident || item.events.some((event) => event.state === "WARNING" || event.is_sla_breach) || Number(item.metric?.sla_breach_count || 0) > 0
          ? "degraded"
          : "healthy";
      const service = inferServiceName(item.flowCode, flowNames);
      const flowLabel = flowName(item.flowCode, flowNames);
      const edgeState: TopologyState | "ai" = topIncident?.severity === "critical"
        ? "critical"
        : topIncident
          ? "ai"
          : state;
      return {
        id: item.flowCode,
        flowCode: item.flowCode,
        label: service,
        sublabel: truncateLabel(flowLabel, 52),
        anomalyType,
        state,
        statusLabel: anomalyType,
        anomalies: anomalyCount,
        latencyMs: latency === null ? metricLatency : Math.round(latency),
        criticality: topIncident?.severity || item.metric?.flow_criticality || "standard",
        riskScore,
        propagationRisk: isPropagationAnomaly(anomalyType)
          ? "high"
          : state === "critical" || riskScore >= 70
            ? "watch"
            : state === "degraded"
              ? "local"
              : "low",
        ai: Boolean(topIncident || topEvent?.aiResult),
        edgeState,
        edgeLabel: topIncident ? `${item.flowCode} / risk ${topIncident.risk_score}` : item.metric?.sla_breach_count ? `${item.flowCode} / SLA breach` : `${item.flowCode} / ${item.events.length || item.metric?.count || 0}/min`,
      };
    });
}

function liveProducer(item: LiveEvent) {
  return "producer_code" in item.raw ? item.raw.producer_code || null : null;
}

function eventActorLabel(item: LiveEvent) {
  if (item.source === "api_call") {
    return `${item.consumer || "consumer"} -> ${item.provider || liveProducer(item) || "provider"}`;
  }
  return item.actor ? `actor ${item.actor}` : "audit actor n/a";
}

function eventTechnicalLabel(item: LiveEvent) {
  if (item.source === "api_call") {
    const status = item.status_code === null ? "status n/a" : `HTTP ${item.status_code}`;
    const latency = item.latency_ms === null ? "latency n/a" : `${item.latency_ms} ms`;
    return `${status} / ${latency}`;
  }
  const raw = item.raw as AuditEvent;
  return `${raw.action || "audit"} / ${raw.outcome || "outcome n/a"}`;
}

function inferServiceName(flowCode: string, flowNames: Map<string, string>) {
  const name = flowNames.get(flowCode) || flowCode;
  const parts = name.replace(String.fromCharCode(8594), "->").split(/->|-|_/).map((part) => part.trim()).filter(Boolean);
  return shortServiceName(parts[parts.length - 1] || name);
}

function shortServiceName(value: string) {
  const clean = value.replace(/[^a-zA-Z0-9_ ]/g, " ").trim();
  if (!clean) {
    return "SERVICE";
  }
  const upper = clean.toUpperCase();
  if (upper.length <= 8 && !upper.includes(" ")) {
    return upper;
  }
  return upper
    .split(/\s+|_/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 8);
}

function flowCriticality(flowCode: string | undefined, flows: FlowMetric[]) {
  if (!flowCode) {
    return null;
  }
  return flows.find((flow) => flow.flow_code === flowCode)?.flow_criticality || null;
}

function flowPriority(item: { incidents: AiResult[]; events: LiveEvent[]; metric?: FlowMetric }) {
  const topSeverity = Math.max(0, ...item.incidents.map((incident) => severityRank(incident.severity)));
  const topRisk = Math.max(0, ...item.incidents.map((incident) => incident.risk_score));
  const liveSignals = item.events.filter((event) => event.anomalyType || event.state !== "NORMAL" || event.is_sla_breach).length;
  return topSeverity * 1000 + topRisk * 10 + liveSignals * 5 + Number(item.metric?.sla_breach_count || 0);
}

function stateLabel(state: TopologyState) {
  if (state === "critical") {
    return "critical";
  }
  if (state === "degraded") {
    return "degraded";
  }
  return "healthy";
}

function normalizeImpactAnomalyType(value: string | null | undefined) {
  const normalized = String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  return normalized && !["HEALTHY", "DEGRADED", "CRITICAL"].includes(normalized)
    ? normalized
    : normalized === "HEALTHY"
      ? "NORMAL"
      : "UNKNOWN_ANOMALY";
}

function impactCriticalityRank(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "critical") return 4;
  if (normalized === "high") return 3;
  if (normalized === "medium" || normalized === "degraded") return 2;
  if (normalized === "low" || normalized === "standard") return 1;
  return 0;
}

function impactVisualRank(value: ReturnType<typeof getAnomalyVisualLevel>) {
  if (value === "critical") return 3;
  if (value === "warning") return 2;
  return 1;
}

function truncateLabel(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

function edgeLabel(incidents: AiResult[], flowCode: string | undefined, flows: FlowMetric[], liveEvents: LiveEvent[]) {
  if (incidents.length > 0) {
    const top = incidents[0];
    if (isPropagationAnomaly(top.detected_anomaly_type)) {
      return "Propagation detected";
    }
    return `${incidents.length} anomalies`;
  }
  const metric = flows.find((flow) => flow.flow_code === flowCode);
  if (metric) {
    const latency = Math.round(Number(metric.avg_latency_ms || 0));
    return metric.sla_breach_count > 0 ? "SLA breach" : `${latency} ms`;
  }
  return `${liveEvents.length}/min`;
}

function isPropagationAnomaly(type: string) {
  return ["CASCADE_FAILURE", "SHARED_PROVIDER_FAILURE", "DEPENDENT_SERVICE_FAILURE", "INTEROPERABILITY_DEGRADATION"].includes(type);
}

function detectorName(item: AiResult) {
  const metadata = item.metadata || {};
  const modelId = typeof metadata.model_id === "string" ? metadata.model_id : null;
  const detector = typeof metadata.detector === "string" ? metadata.detector : null;
  const analysisLevel = typeof metadata.analysis_level === "string" ? metadata.analysis_level : null;
  return detector || modelId || analysisLevel || item.analysis_type || item.source_event_type || "AI detector";
}

function analysisLevel(item: AiResult) {
  const metadata = item.metadata || {};
  const level = typeof metadata.analysis_level === "string" ? metadata.analysis_level : null;
  if (level) {
    return level;
  }
  if (item.detected_anomaly_type.includes("CASCADE") || item.detected_anomaly_type.includes("PROVIDER")) {
    return "graph";
  }
  if (item.detected_anomaly_type.includes("FLOW")) {
    return "flow";
  }
  if (item.detected_anomaly_type.includes("PLATFORM")) {
    return "platform";
  }
  return item.analysis_type || "event";
}

function formatConfidence(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }
  return value <= 1 ? value.toFixed(2) : `${Math.round(value)}%`;
}

function relativeTime(value: string, nowTick: number) {
  const date = parseDate(value);
  if (!date) {
    return "time n/a";
  }
  const seconds = Math.max(0, Math.round((nowTick - date.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  return `${Math.round(minutes / 60)}h ago`;
}

function compactTime(value: string, nowTick: number) {
  const date = parseDate(value);
  if (!date) {
    return "--:--";
  }
  if (nowTick - date.getTime() < 10 * 60000) {
    return relativeTime(value, nowTick).replace(" ago", "");
  }
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function clockTime(value: string) {
  const date = parseDate(value);
  if (!date) {
    return "--:--:--";
  }
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function incidentFallback(item: AiResult) {
  if (isPropagationAnomaly(item.detected_anomaly_type)) {
    return "Propagation detectee sur des flows dependants.";
  }
  if (item.detected_anomaly_type.includes("ERROR")) {
    return "Taux d'erreur anormal sur le flow surveille.";
  }
  return "Signal IA actif sur le perimetre supervise.";
}

function timeBuckets(
  items: unknown[],
  dateKey: string,
  bucketCount: number,
  bucketMinutes: number,
  tone: "blue" | "teal" = "blue",
) {
  const now = Date.now();
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const minutesAgo = (bucketCount - index - 1) * bucketMinutes;
    return { label: `-${minutesAgo}m`, value: 0, tone };
  });

  items.forEach((item) => {
    const record = item as Record<string, unknown>;
    const date = parseDate(String(record[dateKey] || ""));
    if (!date) {
      return;
    }
    const ageMinutes = (now - date.getTime()) / 60000;
    const index = bucketCount - 1 - Math.floor(ageMinutes / bucketMinutes);
    if (index >= 0 && index < bucketCount) {
      buckets[index].value += 1;
    }
  });

  return buckets;
}

function latencyBuckets(items: LiveEvent[], bucketCount: number, bucketMinutes: number) {
  const now = Date.now();
  const sums = Array.from({ length: bucketCount }, () => ({ sum: 0, count: 0 }));

  items.forEach((item) => {
    const date = parseDate(item.timestamp);
    if (!date || item.latency_ms === null) {
      return;
    }
    const ageMinutes = (now - date.getTime()) / 60000;
    const index = bucketCount - 1 - Math.floor(ageMinutes / bucketMinutes);
    if (index >= 0 && index < bucketCount) {
      sums[index].sum += item.latency_ms;
      sums[index].count += 1;
    }
  });

  return sums.map((bucket, index) => ({
    label: `-${(bucketCount - index - 1) * bucketMinutes}m`,
    value: bucket.count === 0 ? 0 : Math.round(bucket.sum / bucket.count),
  }));
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(value: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return (value / total) * 100;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "endpoint indisponible");
}

function eventTrendLabel(items: LiveEvent[]) {
  const now = Date.now();
  const current = items.filter((item) => {
    const date = parseDate(item.timestamp);
    return date ? now - date.getTime() <= 60000 : false;
  }).length;
  const previous = items.filter((item) => {
    const date = parseDate(item.timestamp);
    if (!date) {
      return false;
    }
    const age = now - date.getTime();
    return age > 60000 && age <= 6 * 60000;
  }).length / 5;

  if (previous <= 0) {
    return current > 0 ? "live baseline" : "waiting";
  }
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${Math.round(delta)}% vs last 5 min`;
}

function MiniTrend({
  title,
  subtitle,
  items,
  tone,
  suffix = "",
}: {
  title: string;
  subtitle: string;
  items: Array<{ label: string; value: number }>;
  tone: "blue" | "orange" | "teal";
  suffix?: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="miniTrend">
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="sparkBars">
        {items.map((item) => (
          <div className="sparkColumn" key={item.label}>
            <div
              className={`sparkFill ${tone}`}
              style={{ height: `${Math.max(8, (item.value / max) * 100)}%` }}
              title={`${item.label}: ${item.value}${suffix}`}
            />
            <small>
              {item.value}
              {suffix}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineTrend({
  title,
  items,
  tone,
  suffix = "",
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  tone: "orange" | "blue" | "teal";
  suffix?: string;
}) {
  const width = 360;
  const height = 132;
  const max = Math.max(...items.map((item) => item.value), 1);
  const points = items.map((item, index) => {
    const x = items.length <= 1 ? 0 : (index / (items.length - 1)) * width;
    const y = height - (item.value / max) * (height - 22) - 10;
    return { x, y, item };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = `${path} L ${width} ${height} L 0 ${height} Z`;
  const latest = items[items.length - 1]?.value || 0;
  return (
    <div className="lineTrend">
      <div>
        <strong>{title}</strong>
        <span>{latest}{suffix}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} trend`}>
        <path className={`lineTrendArea ${tone}`} d={area} />
        <path className={`lineTrendPath ${tone}`} d={path} />
        {points.map((point) => (
          <circle key={point.item.label} cx={point.x} cy={point.y} r="3" />
        ))}
      </svg>
    </div>
  );
}
