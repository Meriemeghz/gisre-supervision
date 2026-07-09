import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_INTERNAL_API_URL =
  process.env.BACKEND_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production" ? "http://backend:3000" : "http://localhost:3000");
const BACKEND_FALLBACK_API_URL = process.env.BACKEND_FALLBACK_API_URL || "http://host.docker.internal:3000";

const AI_INTERNAL_API_URL =
  process.env.AI_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production" ? "http://ai-layer:8000" : "http://localhost:8000");
const AI_FALLBACK_API_URL = process.env.AI_FALLBACK_API_URL || "http://host.docker.internal:8000";

type AiResult = {
  id: string;
  source_event_id: string | null;
  source_event_type: string;
  detected_anomaly_type: string;
  risk_score: number;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number | null;
  explanation: string | null;
  recommendation: string | null;
  analysis_type: string;
  validation: Record<string, unknown> | null;
  validation_status: string | null;
  validated_by: string | null;
  validated_at: string | null;
  validation_comment: string | null;
  validation_source: string | null;
  metadata: Record<string, unknown> | null;
  detected_at: string;
  created_at: string;
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

type LiveState = "NORMAL" | "WARNING" | "CRITICAL";

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
};

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const seen = new Map<string, string>();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const heartbeat = () => controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));

      try {
        const snapshot = await loadLiveEvents(120);
        snapshot.forEach((item) => seen.set(liveEventKey(item), liveEventSignature(item)));
        send("snapshot", snapshot.slice(0, 120));
      } catch (error) {
        send("stream_error", { message: error instanceof Error ? error.message : "Realtime snapshot unavailable" });
      }

      try {
        while (!request.signal.aborted) {
          await sleep(1000);
          heartbeat();

          try {
            const events = await loadLiveEvents(80);
            const fresh = events
              .filter((item) => shouldEmitLiveEvent(item, seen.get(liveEventKey(item))))
              .sort((left, right) => parseDate(left.timestamp) - parseDate(right.timestamp));

            fresh.forEach((item) => {
              seen.set(liveEventKey(item), liveEventSignature(item));
              send("live_event", item);
            });
          } catch (error) {
            send("stream_error", { message: error instanceof Error ? error.message : "Realtime stream temporarily unavailable" });
          }
        }
      } catch (error) {
        send("stream_error", { message: error instanceof Error ? error.message : "Erreur SSE" });
      } finally {
        controller.close();
      }
    },
    cancel() {
      seen.clear();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function liveEventKey(event: LiveEvent) {
  return `${event.source}-${event.id}`;
}

function liveEventSignature(event: LiveEvent) {
  const result = event.aiResult;
  if (!result) return "pending";
  return [
    result.id,
    result.detected_at,
    result.validation_status || "",
    result.validated_at || "",
    result.risk_score,
    result.severity,
  ].join("|");
}

function shouldEmitLiveEvent(event: LiveEvent, previousSignature: string | undefined) {
  const nextSignature = liveEventSignature(event);
  if (!previousSignature) return true;
  if (nextSignature === "pending" && previousSignature !== "pending") return false;
  return nextSignature !== previousSignature;
}

async function loadLiveEvents(limit: number) {
  const [apiEventsResult, auditEventsResult, aiResultsResult] = await Promise.allSettled([
    readJsonAny<ApiCallEvent[]>([
      `${BACKEND_INTERNAL_API_URL}/events/api-calls?limit=${limit}`,
      `${BACKEND_FALLBACK_API_URL}/events/api-calls?limit=${limit}`,
    ]),
    readJsonAny<AuditEvent[]>([
      `${BACKEND_INTERNAL_API_URL}/events/audit-events?limit=${limit}`,
      `${BACKEND_FALLBACK_API_URL}/events/audit-events?limit=${limit}`,
    ]),
    readJsonAny<AiResult[]>([
      `${AI_INTERNAL_API_URL}/ai/results?limit=500&include_normal=true`,
      `${AI_FALLBACK_API_URL}/ai/results?limit=500&include_normal=true`,
    ]),
  ]);

  const apiEvents = apiEventsResult.status === "fulfilled" ? apiEventsResult.value : [];
  const auditEvents = auditEventsResult.status === "fulfilled" ? auditEventsResult.value : [];
  const aiResults = aiResultsResult.status === "fulfilled" ? aiResultsResult.value : [];

  if (!apiEvents.length && !auditEvents.length && apiEventsResult.status === "rejected" && auditEventsResult.status === "rejected") {
    throw new Error(
      `Backend event endpoints unavailable: ${errorMessage(apiEventsResult.reason)}; ${errorMessage(auditEventsResult.reason)}`,
    );
  }

  return buildLiveEvents(apiEvents, auditEvents, aiResults).slice(0, limit * 2);
}

async function readJsonAny<T>(urls: string[]): Promise<T> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      return await readJson<T>(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Live source unreachable");
}

async function readJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (error) {
    throw new Error(`endpoint unreachable ${url}: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} on ${url}`);
  }
  return response.json() as Promise<T>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function buildLiveEvents(apiEvents: ApiCallEvent[], auditEvents: AuditEvent[], aiResults: AiResult[]): LiveEvent[] {
  const apiRows: LiveEvent[] = apiEvents.map((event) => {
    const aiResult = findAiResult(event.id, event.correlation_id || null, "api_call", aiResults);
    const state = classifyApiEvent(event, aiResult);
    return {
      id: event.id,
      source: "api_call",
      timestamp: event.called_at,
      flow_code: event.flow_code,
      api_code: event.api_code || null,
      consumer: event.consumer_code || null,
      provider: event.producer_code || null,
      actor: event.consumer_code || null,
      latency_ms: event.latency_ms,
      status_code: event.status_code,
      success: event.success,
      is_sla_breach: event.is_sla_breach,
      correlation_id: event.correlation_id || null,
      state,
      anomalyType: aiResult?.detected_anomaly_type || fallbackApiType(event, state),
      aiResult,
      raw: event,
    };
  });

  const auditRows: LiveEvent[] = auditEvents.map((event) => {
    const aiResult = findAiResult(event.id, event.correlation_id || null, "audit_event", aiResults);
    const state = classifyAuditEvent(event, aiResult);
    return {
      id: event.id,
      source: "audit_event",
      timestamp: event.event_timestamp,
      flow_code: event.flow_code,
      api_code: event.api_code || null,
      consumer: event.actor_code || null,
      provider: null,
      actor: event.actor_code || null,
      latency_ms: null,
      status_code: null,
      success: event.outcome ? event.outcome === "success" : null,
      is_sla_breach: false,
      correlation_id: event.correlation_id || null,
      state,
      anomalyType: aiResult?.detected_anomaly_type || fallbackAuditType(event, state),
      aiResult,
      raw: event,
    };
  });

  return [...apiRows, ...auditRows].sort((left, right) => parseDate(right.timestamp) - parseDate(left.timestamp));
}

function findAiResult(eventId: string, correlationId: string | null, sourceType: string, aiResults: AiResult[]) {
  const candidates = aiResults.filter((item) => {
    if (item.source_event_type !== sourceType) return false;
    if (item.source_event_id === eventId) return true;
    return Boolean(
      correlationId
      && String(item.metadata?.correlation_id || "") === correlationId,
    );
  });

  const traced = candidates.filter(hasEventAnalysisTrace);
  return (
    traced.find(isEventLevelResult)
    || traced[0]
    || candidates.find(isEventLevelResult)
    || candidates[0]
    || null
  );
}

function hasEventAnalysisTrace(result: AiResult) {
  const analysisTrace = asRecord(result.metadata?.analysis_trace);
  return Object.keys(asRecord(analysisTrace.event)).length > 0;
}

function isEventLevelResult(result: AiResult) {
  return result.metadata?.analysis_level === "event";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function classifyApiEvent(event: ApiCallEvent, aiResult: AiResult | null): LiveState {
  if (aiResult?.severity === "critical" || (aiResult?.risk_score || 0) >= 80) {
    return "CRITICAL";
  }
  if ((event.status_code || 0) >= 500 || event.error_type === "timeout" || event.error_type === "provider_unreachable") {
    return "CRITICAL";
  }
  if (aiResult || !event.success || event.is_sla_breach || (event.status_code || 0) >= 400) {
    return "WARNING";
  }
  return "NORMAL";
}

function classifyAuditEvent(event: AuditEvent, aiResult: AiResult | null): LiveState {
  if (aiResult?.severity === "critical" || (aiResult?.risk_score || 0) >= 80) {
    return "CRITICAL";
  }
  if (event.outcome === "denied" || event.outcome === "failure" || aiResult) {
    return "WARNING";
  }
  return "NORMAL";
}

function fallbackApiType(event: ApiCallEvent, state: LiveState) {
  if (state === "NORMAL") {
    return "SUCCESS";
  }
  if (event.error_type) {
    return event.error_type.toUpperCase();
  }
  if (event.is_sla_breach) {
    return "SLA_BREACH";
  }
  return state;
}

function fallbackAuditType(event: AuditEvent, state: LiveState) {
  if (state === "NORMAL") {
    return "SUCCESS";
  }
  return (event.action || state).toUpperCase();
}

function parseDate(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
