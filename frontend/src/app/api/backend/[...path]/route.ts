import { NextRequest, NextResponse } from "next/server";

const BACKEND_INTERNAL_API_URL =
  process.env.BACKEND_INTERNAL_API_URL ||
  (process.env.NODE_ENV === "production" ? "http://backend:3000" : "http://localhost:3000");

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyGet(request, `${BACKEND_INTERNAL_API_URL}/${params.path.join("/")}`);
}

async function proxyGet(request: NextRequest, targetUrl: string) {
  const url = new URL(request.url);
  let response: Response;
  try {
    response = await fetch(`${targetUrl}${url.search}`, { cache: "no-store" });
  } catch (error) {
    return NextResponse.json(
      {
        error: "backend_unreachable",
        target: targetUrl,
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
