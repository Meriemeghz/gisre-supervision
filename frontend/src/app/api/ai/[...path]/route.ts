import { NextRequest, NextResponse } from "next/server";

const AI_INTERNAL_API_URL =
  process.env.AI_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production" ? "http://ai-layer:8000" : "http://localhost:8000");

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyGet(request, `${AI_INTERNAL_API_URL}/${params.path.join("/")}`);
}

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyPost(request, `${AI_INTERNAL_API_URL}/${params.path.join("/")}`);
}

async function proxyGet(request: NextRequest, targetUrl: string) {
  const url = new URL(request.url);
  const response = await fetch(`${targetUrl}${url.search}`, { cache: "no-store" });
  const body = await response.text();

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
    },
  });
}

async function proxyPost(request: NextRequest, targetUrl: string) {
  const url = new URL(request.url);
  const body = await request.text();
  const response = await fetch(`${targetUrl}${url.search}`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") || "application/json",
    },
    body,
    cache: "no-store",
  });
  const responseBody = await response.text();

  return new NextResponse(responseBody, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
    },
  });
}
