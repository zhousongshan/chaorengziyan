import { z } from "zod";

export const runtime = "nodejs";

const assetIdSchema = z.uuid();
const upstreamResponseHeaders = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified"
] as const;

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const parsedAssetId = assetIdSchema.safeParse((await params).assetId);
  if (!parsedAssetId.success) {
    return Response.json(
      { code: "INVALID_MEDIA_ASSET_ID", message: "媒体资产 ID 格式不正确" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const upstreamUrl = `${internalApiBaseUrl()}/media-assets/${parsedAssetId.data}/content`;
  const requestHeaders = new Headers();
  for (const header of ["if-modified-since", "if-none-match", "range"] as const) {
    const value = request.headers.get(header);
    if (value) requestHeaders.set(header, value);
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: requestHeaders,
      signal: AbortSignal.timeout(30_000)
    });
    const responseHeaders = new Headers();
    for (const header of upstreamResponseHeaders) {
      const value = upstream.headers.get(header);
      if (value) responseHeaders.set(header, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch {
    return Response.json(
      { code: "MEDIA_PROXY_UNAVAILABLE", message: "媒体服务暂时不可用" },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}

function internalApiBaseUrl() {
  return (
    process.env.INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:3001/api/v1"
  ).replace(/\/+$/, "");
}
