"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AiResult,
  AiSummary,
  BackendSummary,
  FlowMetric,
  ModelTrainingStatus,
  fetchAiResults,
  fetchAiSummary,
  fetchBackendSummary,
  fetchFlowMetrics,
  fetchModelTrainingStatus,
} from "@/lib/api";
import { AnalysisPanel } from "./AnalysisPanel";
import { BarChart } from "./BarChart";
import { getIncidentStatus, IncidentTable } from "./IncidentTable";
import { KpiCard } from "./KpiCard";
import { ModelTrainingPanel } from "./ModelTrainingPanel";

type DashboardState = {
  aiSummary: AiSummary | null;
  backendSummary: BackendSummary | null;
  results: AiResult[];
  flows: FlowMetric[];
  modelStatus: ModelTrainingStatus | null;
  lastUpdated: Date | null;
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
  action: string | null;
  outcome: string | null;
  correlation_id?: string | null;
  event_timestamp: string;
};

export function DashboardClient() {
  const [state, setState] = useState<DashboardState>({
    aiSummary: null,
    backendSummary: null,
    results: [],
    flows: [],
    modelStatus: null,
    lastUpdated: null,
  });
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [liveFilter, setLiveFilter] = useState<LiveFilter>("all");
  const [liveQuery, setLiveQuery] = useState("");
  const [selectedLiveEvent, setSelectedLiveEvent] = useState<LiveEvent | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [unseenCount, setUnseenCount] = useState(0);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowRef = useRef(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [aiSummary, backendSummary, results, flows, modelStatus] = await Promise.all([
          fetchAiSummary(),
          fetchBackendSummary(),
          fetchAiResults(500),
          fetchFlowMetrics(),
          fetchModelTrainingStatus(),
        ]);
        if (active) {
          setState({ aiSummary, backendSummary, results, flows, modelStatus, lastUpdated: new Date() });
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Erreur de chargement");
        }
      }
    }

    load();
    const timer = window.setInterval(load, 10000);
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
      setUnseenCount(0);
    });

    source.addEventListener("live_event", (message) => {
      const payload = JSON.parse((message as MessageEvent).data) as LiveEvent;
      const receivedAt = Date.now();
      setLastEventAt(receivedAt);
      setLiveEvents((current) => {
        const next = [{ ...payload, receivedAt }, ...current.filter((item) => `${item.source}-${item.id}` !== `${payload.source}-${payload.id}`)];
        return next.slice(0, 200);
      });

      if (shouldFollowRef.current) {
        window.requestAnimationFrame(() => {
          if (feedRef.current) {
            feedRef.current.scrollTop = 0;
          }
        });
      } else {
        setUnseenCount((count) => count + 1);
      }
    });

    source.addEventListener("stream_error", (message) => {
      setStreamStatus("error");
      setError(JSON.parse((message as MessageEvent).data).message || "Erreur SSE");
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

  const byType = (state.aiSummary?.by_type || []).slice(0, 8).map((item) => ({
    label: item.detected_anomaly_type,
    value: item.count,
    tone: "blue" as const,
  }));

  const realtimeResults = useMemo(
    () => state.results.filter((item) => item.analysis_type === "realtime"),
    [state.results],
  );

  const historicalResults = useMemo(
    () => state.results.filter((item) => item.analysis_type === "historical"),
    [state.results],
  );

  const recentLiveEvents = useMemo(() => liveEvents.filter((item) => isRecent(item.timestamp, 1)), [liveEvents]);

  const filteredLiveEvents = useMemo(() => {
    const needle = liveQuery.trim().toLowerCase();
    return liveEvents.filter((event) => {
      const matchesFilter =
        liveFilter === "all" ||
        (liveFilter === "normal" && event.state === "NORMAL") ||
        (liveFilter === "anomalies" && event.state !== "NORMAL") ||
        (liveFilter === "critical" && event.state === "CRITICAL");

      const flowLabel = flowName(event.flow_code, flowNames);
      const matchesQuery =
        !needle ||
        event.source.toLowerCase().includes(needle) ||
        event.state.toLowerCase().includes(needle) ||
        flowLabel.toLowerCase().includes(needle) ||
        (event.flow_code || "").toLowerCase().includes(needle) ||
        (event.api_code || "").toLowerCase().includes(needle) ||
        (event.consumer || "").toLowerCase().includes(needle) ||
        (event.provider || "").toLowerCase().includes(needle) ||
        (event.actor || "").toLowerCase().includes(needle) ||
        (event.anomalyType || "").toLowerCase().includes(needle);

      return matchesFilter && matchesQuery;
    });
  }, [flowNames, liveEvents, liveFilter, liveQuery]);

  const activeIncidents = useMemo(
    () => state.results.filter((item) => ["OPEN", "INVESTIGATING"].includes(getIncidentStatus(item))),
    [state.results],
  );

  const avgScore = Number(state.aiSummary?.avg_risk_score || 0);
  const risk = getRisk(avgScore);
  const liveLatencyAvg = average(recentLiveEvents.map((item) => item.latency_ms).filter((value): value is number => value !== null));
  const liveSuccessRate = percent(recentLiveEvents.filter((item) => item.success !== null && item.success).length, recentLiveEvents.filter((item) => item.success !== null).length);
  const liveSlaBreaches = recentLiveEvents.filter((item) => item.is_sla_breach).length;
  const liveTraffic = useMemo(() => timeBuckets(liveEvents, "timestamp", 12, 1), [liveEvents]);
  const liveLatency = useMemo(() => latencyBuckets(liveEvents, 12, 1), [liveEvents]);
  const historicalTrend = useMemo(() => timeBuckets(historicalResults, "detected_at", 12, 60, "teal"), [historicalResults]);
  const realtimeTrend = useMemo(() => timeBuckets(realtimeResults, "detected_at", 12, 1, "blue"), [realtimeResults]);

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

  return (
    <>
      <div className="pageHeader">
        <div>
          <h1>Dashboard supervision GISRE</h1>
          <p>Flux temps reel des evenements simulateur: normaux, degrades et critiques.</p>
        </div>
        <div className="headerStatus">
          <span className={`statusPill stream-${streamStatus}`}>{streamStatus === "live" ? "SSE en direct" : streamStatus}</span>
          <span className="lastUpdated">
            Dernier evenement: {lastEventAt ? `${Math.max(0, Math.round((nowTick - lastEventAt) / 1000))}s` : "-"}
          </span>
        </div>
      </div>

      {error && <div className="errorBox">Impossible de charger les donnees: {error}</div>}

      <section className="liveHero">
        <div>
          <span className="sectionEyebrow">Page 1</span>
          <h2>Flux temps reel des evenements</h2>
          <p>Les evenements les plus recents arrivent en haut du flux, enrichis par l'IA quand une anomalie est detectee.</p>
        </div>
        <div className="livePulse">
          <span />
          En direct - {recentLiveEvents.length}/min
        </div>
      </section>

      <section className="grid kpiGrid">
        <KpiCard label="Evenements/min" value={recentLiveEvents.length} />
        <KpiCard label="Incidents actifs" value={activeIncidents.length} />
        <KpiCard label="Latence live" value={liveLatencyAvg === null ? "-" : `${Math.round(liveLatencyAvg)} ms`} />
        <KpiCard label="Taux succes live" value={`${liveSuccessRate.toFixed(0)}%`} />
        <KpiCard label="SLA breaches live" value={liveSlaBreaches} />
      </section>

      <section className="liveFilters">
        <div className="filterGroup">
          <button className={liveFilter === "all" ? "active" : ""} onClick={() => setLiveFilter("all")}>Tous</button>
          <button className={liveFilter === "normal" ? "active" : ""} onClick={() => setLiveFilter("normal")}>Normaux</button>
          <button className={liveFilter === "anomalies" ? "active" : ""} onClick={() => setLiveFilter("anomalies")}>Anomalies</button>
          <button className={liveFilter === "critical" ? "active" : ""} onClick={() => setLiveFilter("critical")}>Critiques</button>
        </div>
        <input
          className="input"
          placeholder="Filtrer par producteur, consumer, API, flow ou type anomalie"
          value={liveQuery}
          onChange={(event) => setLiveQuery(event.target.value)}
        />
      </section>

      <section className="liveGrid">
        <div className="card liveFeedCard">
          <div className="cardHeader">
            <h2>Flux live des evenements</h2>
            <div className="liveHeaderActions">
              {unseenCount > 0 && (
                <button className="newEventsButton" onClick={() => scrollToLiveTop(feedRef.current, setUnseenCount)}>
                  {unseenCount} nouveaux evenements
                </button>
              )}
              <span className="muted">{Math.min(filteredLiveEvents.length, 100)} evenements affiches</span>
            </div>
          </div>
          <div
            className="cardBody liveFeed"
            ref={feedRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              shouldFollowRef.current = element.scrollTop < 20;
              if (shouldFollowRef.current) {
                setUnseenCount(0);
              }
            }}
          >
            {filteredLiveEvents.slice(0, 100).map((event) => (
              <button
                className={`liveRow ${event.state.toLowerCase()} ${isNewEvent(event, nowTick) ? "fresh" : ""}`}
                key={`${event.source}-${event.id}`}
                onClick={() => setSelectedLiveEvent(event)}
              >
                <span className="liveTime">{formatTimeFromValue(event.timestamp)}</span>
                <span className="liveFlow">{flowName(event.flow_code, flowNames)}</span>
                <span className="liveApi">{event.api_code || "n/a"}</span>
                <span className="liveLatency">{event.latency_ms === null ? "-" : `${event.latency_ms}ms`}</span>
                <span className={`liveBadge ${event.state.toLowerCase()}`}>
                  {isNewEvent(event, nowTick) && <em>NEW</em>}
                  {event.anomalyType || event.state}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="card liveDetailCard">
          <div className="cardHeader">
            <h2>Detail evenement</h2>
          </div>
          <div className="cardBody">
            {selectedLiveEvent ? (
              <LiveEventDetail event={selectedLiveEvent} flowName={flowName(selectedLiveEvent.flow_code, flowNames)} />
            ) : (
              <p className="muted">Clique sur un evenement du flux pour voir le contexte complet.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid kpiGrid secondaryKpis">
        <KpiCard label="Risque global" value={risk.label} tone={risk.tone} detail={`Score moyen ${avgScore.toFixed(0)}/100`} />
        <KpiCard label="Volume API total" value={state.backendSummary?.total_api_calls ?? "-"} />
        <KpiCard label="Anomalies IA total" value={state.aiSummary?.total_results ?? "-"} />
        <KpiCard label="SLA breaches total" value={state.backendSummary?.sla_breaches ?? "-"} />
        <KpiCard label="Erreurs API total" value={state.backendSummary?.total_errors ?? "-"} />
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader">
            <h2>Courbes temps reel</h2>
          </div>
          <div className="cardBody temporalGrid">
            <MiniTrend title="Trafic live" subtitle="appels API par tranche de 1 min" items={liveTraffic} tone="blue" />
            <MiniTrend title="Latence live" subtitle="latence moyenne par tranche" items={liveLatency} tone="orange" suffix=" ms" />
          </div>
        </div>

        <div className="card">
          <div className="cardHeader">
            <h2>Recommandations prioritaires</h2>
          </div>
          <div className="cardBody recommendationList">
            {recommendations.map((item) => (
              <div className="recommendationItem" key={item.id}>
                <strong>{flowName(item.flow_code, flowNames)}</strong>
                <span>{item.recommendation}</span>
              </div>
            ))}
            {recommendations.length === 0 && <p className="muted">Aucune recommandation critique recente.</p>}
          </div>
        </div>
      </section>

      <ModelTrainingPanel status={state.modelStatus} />

      <AnalysisPanel
        title="Volet analyse temps reel"
        subtitle="Incidents detectes immediatement depuis Kafka: timeouts, erreurs serveur, SLA, acces refuses."
        results={realtimeResults}
        tone="blue"
        flowNames={flowNames}
      />

      <AnalysisPanel
        title="Volet analyse historique / ML-DL"
        subtitle="Signaux calcules depuis PostgreSQL: tendances, taux d'erreur, modeles Isolation Forest, SVM, Random Forest, K-Means, Autoencoder et GRU."
        results={historicalResults}
        tone="teal"
        flowNames={flowNames}
      />

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader">
            <h2>Evolution historique</h2>
          </div>
          <div className="cardBody temporalGrid">
            <MiniTrend title="Anomalies historiques" subtitle="fenetres d'une heure" items={historicalTrend} tone="teal" />
            <MiniTrend title="Incidents temps reel" subtitle="fenetres de 1 min" items={realtimeTrend} tone="blue" />
          </div>
        </div>

        <div className="card">
          <div className="cardHeader">
            <h2>Heatmap severite</h2>
          </div>
          <div className="cardBody">
            <SeverityHeatmap results={state.results} flowNames={flowNames} />
          </div>
        </div>
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader">
            <h2>Derniers incidents IA</h2>
          </div>
          <div className="cardBody">
            <IncidentTable results={state.results.slice(0, 8)} compact flowNames={flowNames} />
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="cardHeader">
              <h2>Anomalies par severite</h2>
            </div>
            <div className="cardBody">
              <BarChart items={severityItems} />
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <h2>Anomalies par type</h2>
            </div>
            <div className="cardBody">
              <BarChart items={byType} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid contentGrid">
        <div className="card">
          <div className="cardHeader">
            <h2>Top flux problematiques</h2>
          </div>
          <div className="cardBody">
            <BarChart items={topFlows} />
          </div>
        </div>

        <div className="card">
          <div className="cardHeader">
            <h2>Flux backend les plus actifs</h2>
          </div>
          <div className="cardBody">
            <BarChart
              items={state.flows
                .slice()
                .sort((left, right) => right.count - left.count)
                .slice(0, 8)
                .map((flow) => ({ label: flow.flow_name || flow.flow_code, value: flow.count, tone: "teal" as const }))}
            />
          </div>
        </div>
      </section>
    </>
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

function formatTime(date: Date) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

function formatTimeFromValue(value: string) {
  const date = parseDate(value);
  return date ? formatTime(date) : value;
}

function isNewEvent(event: LiveEvent, now: number) {
  return Boolean(event.receivedAt && now - event.receivedAt < 3000);
}

function scrollToLiveTop(element: HTMLDivElement | null, setUnseenCount: (value: number) => void) {
  if (element) {
    element.scrollTop = 0;
  }
  setUnseenCount(0);
}

function LiveEventDetail({ event, flowName }: { event: LiveEvent; flowName: string }) {
  return (
    <div>
      <div className="kv">
        <span>Etat</span>
        <strong className={`liveText ${event.state.toLowerCase()}`}>{event.state}</strong>
      </div>
      <div className="kv">
        <span>Flow</span>
        <strong>{flowName}</strong>
      </div>
      <div className="kv">
        <span>API</span>
        <span>{event.api_code || "n/a"}</span>
      </div>
      <div className="kv">
        <span>Consumer</span>
        <span>{event.consumer || "n/a"}</span>
      </div>
      <div className="kv">
        <span>Provider</span>
        <span>{event.provider || "n/a"}</span>
      </div>
      <div className="kv">
        <span>Latency</span>
        <span>{event.latency_ms === null ? "n/a" : `${event.latency_ms} ms`}</span>
      </div>
      <div className="kv">
        <span>Status code</span>
        <span>{event.status_code || "n/a"}</span>
      </div>
      <div className="kv">
        <span>Score IA</span>
        <strong>{event.aiResult?.risk_score ?? "n/a"}</strong>
      </div>
      <div className="kv">
        <span>Diagnostic</span>
        <span>{event.aiResult?.explanation || event.anomalyType || "Evenement normal"}</span>
      </div>
      <div className="kv">
        <span>Recommandation</span>
        <strong>{event.aiResult?.recommendation || "Surveillance normale."}</strong>
      </div>
      <div className="liveRaw">
        <pre>{JSON.stringify(event.raw, null, 2)}</pre>
      </div>
    </div>
  );
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

function SeverityHeatmap({ results, flowNames }: { results: AiResult[]; flowNames: Map<string, string> }) {
  const flows = [...new Set(results.map((item) => item.flow_code).filter(Boolean) as string[])].slice(0, 6);
  const severities = ["critical", "high", "medium", "low"] as const;

  return (
    <div className="heatmap">
      <div className="heatHead">Flux</div>
      {severities.map((severity) => (
        <strong key={severity}>{severity}</strong>
      ))}
      {flows.map((flow) => (
        <div className="heatmapRow" key={flow}>
          <span>{flowName(flow, flowNames)}</span>
          {severities.map((severity) => {
            const value = results.filter((item) => item.flow_code === flow && item.severity === severity).length;
            return (
              <div className={`heatCell ${severity}`} key={severity}>
                {value}
              </div>
            );
          })}
        </div>
      ))}
      {flows.length === 0 && <p className="muted">Pas encore assez de donnees pour la heatmap.</p>}
    </div>
  );
}
