import { NextRequest, NextResponse } from "next/server";

const AI_INTERNAL_API_URL =
  process.env.AI_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production" ? "http://ai-layer:8000" : "http://localhost:8000");
const AI_FALLBACK_API_URL = process.env.AI_FALLBACK_API_URL || "http://host.docker.internal:8000";

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join("/");
  const timeoutMs = path.endsWith("analytics/historical") || path.includes("feedback-dataset")
    ? 60000
    : 20000;
  return proxyGet(request, pathTargets(params.path), timeoutMs);
}

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join("/");
  const timeoutMs = path.endsWith("analytics/historical/interpret") ? 90000
    : path.endsWith("/interpret") ? 60000
    : 20000;
  return proxyPost(request, pathTargets(params.path), timeoutMs);
}

export async function PATCH(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyWrite(request, pathTargets(params.path), "PATCH");
}

function pathTargets(path: string[]) {
  const normalizedPath = path[0] === "results" || path[0] === "summary" ? ["ai", ...path] : path;
  const suffix = normalizedPath.join("/");
  return [`${AI_INTERNAL_API_URL}/${suffix}`, `${AI_FALLBACK_API_URL}/${suffix}`];
}

async function proxyGet(request: NextRequest, targetUrls: string[], timeoutMs: number) {
  const url = new URL(request.url);
  let response: Response;
  try {
    response = await fetchFirst(
      targetUrls.map((targetUrl) => `${targetUrl}${url.search}`),
      {
        cache: "no-store",
        signal: request.signal,
      },
      timeoutMs,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "ai_unreachable",
        target: targetUrls[0],
        message: error instanceof Error ? error.message : "AI layer unreachable",
      },
      { status: 503 },
    );
  }
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
    },
  });
}

async function proxyPost(request: NextRequest, targetUrls: string[], timeoutMs = 20000) {
  return proxyWrite(request, targetUrls, "POST", timeoutMs);
}

async function proxyWrite(request: NextRequest, targetUrls: string[], method: "POST" | "PATCH", timeoutMs = 20000) {
  const url = new URL(request.url);
  const body = await request.text();
  let response: Response;
  try {
    response = await fetchFirst(
      targetUrls.map((targetUrl) => `${targetUrl}${url.search}`),
      {
        method,
        headers: {
          "content-type": request.headers.get("content-type") || "application/json",
        },
        body,
        cache: "no-store",
        signal: request.signal,
      },
      timeoutMs,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "ai_unreachable",
        target: targetUrls[0],
        message: error instanceof Error ? error.message : "AI layer unreachable",
      },
      { status: 503 },
    );
  }
  const responseBody = await response.text();

  return new NextResponse(responseBody, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
    },
  });
}

async function fetchFirst(urls: string[], init: RequestInit, timeoutMs: number) {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError" && !init.signal?.aborted) {
        throw new Error(`AI service timed out after ${Math.round(timeoutMs / 1000)} seconds`);
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI service unreachable");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortRequest = () => controller.abort();
  init.signal?.addEventListener("abort", abortRequest, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortRequest);
  }
}
