import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_INTERNAL_API_URL =
  process.env.BACKEND_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production" ? "http://backend:3000" : "http://localhost:3000");

const AI_INTERNAL_API_URL =
  process.env.AI_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production" ? "http://ai-layer:8000" : "http://localhost:8000");

type AiResult = {
  id: string;
  source_event_id: string | null;
  source_event_type: string;
  detected_anomaly_type: string;
  risk_score: number;
  severity: "low" | "medium" | "high" | "critical";
  explanation: string | null;
  recommendation: string | null;
  metadata: Record<string, unknown> | null;
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
  const seen = new Set<string>();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const heartbeat = () => controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));

      try {
        const snapshot = await loadLiveEvents(120);
        snapshot.forEach((item) => seen.add(`${item.source}-${item.id}`));
        send("snapshot", snapshot.slice(0, 120));

        while (!request.signal.aborted) {
          await sleep(1000);
          heartbeat();

          const events = await loadLiveEvents(80);
          const fresh = events
            .filter((item) => !seen.has(`${item.source}-${item.id}`))
            .sort((left, right) => parseDate(left.timestamp) - parseDate(right.timestamp));

          fresh.forEach((item) => {
            seen.add(`${item.source}-${item.id}`);
            send("live_event", item);
          });
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

async function loadLiveEvents(limit: number) {
  const [apiEvents, auditEvents, aiResults] = await Promise.all([
    readJson<ApiCallEvent[]>(`${BACKEND_INTERNAL_API_URL}/events/api-calls?limit=${limit}`),
    readJson<AuditEvent[]>(`${BACKEND_INTERNAL_API_URL}/events/audit-events?limit=${limit}`),
    readJson<AiResult[]>(`${AI_INTERNAL_API_URL}/ai/results?limit=500`),
  ]);

  return buildLiveEvents(apiEvents, auditEvents, aiResults).slice(0, limit * 2);
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
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
  return (
    aiResults.find((item) => item.source_event_id === eventId && item.source_event_type === sourceType) ||
    aiResults.find((item) => String(item.metadata?.correlation_id || "") === correlationId && item.source_event_type === sourceType) ||
    null
  );
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
