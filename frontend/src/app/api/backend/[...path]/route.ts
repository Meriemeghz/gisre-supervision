import { NextRequest, NextResponse } from "next/server";

const BACKEND_INTERNAL_API_URL =
  process.env.BACKEND_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production" ? "http://backend:3000" : "http://localhost:3000");
const BACKEND_FALLBACK_API_URL = process.env.BACKEND_FALLBACK_API_URL || "http://host.docker.internal:3000";

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyGet(request, [
    `${BACKEND_INTERNAL_API_URL}/${params.path.join("/")}`,
    `${BACKEND_FALLBACK_API_URL}/${params.path.join("/")}`,
  ]);
}

async function proxyGet(request: NextRequest, targetUrls: string[]) {
  const url = new URL(request.url);
  let response: Response;
  try {
    response = await fetchFirst(targetUrls.map((targetUrl) => `${targetUrl}${url.search}`), {
      cache: "no-store",
      signal: request.signal,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "backend_unreachable",
        target: targetUrls[0],
        message: error instanceof Error ? error.message : "Backend unreachable",
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

async function fetchFirst(urls: string[], init: RequestInit) {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      return await fetchWithTimeout(url, init, 10000);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Backend unreachable");
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
