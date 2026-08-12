import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const assetId = "1993b74b-e11a-4018-b81b-ebe5748ae3d0";

describe("media content proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("streams media through the same-origin route and forwards safe headers", async () => {
    vi.stubEnv("INTERNAL_API_BASE_URL", "http://api.internal/api/v1/");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: {
          "accept-ranges": "bytes",
          "cache-control": "private, max-age=3600",
          "content-type": "image/png",
          "cross-origin-resource-policy": "same-origin",
          "x-internal-header": "secret"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(`http://web.local/api/media-assets/${assetId}/content`, {
        headers: { range: "bytes=0-2" }
      }),
      { params: Promise.resolve({ assetId }) }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.internal/api/v1/media-assets/${assetId}/content`,
      expect.objectContaining({ cache: "no-store" })
    );
    const upstreamOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(upstreamOptions.headers).get("range")).toBe("bytes=0-2");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.has("cross-origin-resource-policy")).toBe(false);
    expect(response.headers.has("x-internal-header")).toBe(false);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("passes through an upstream not-found response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ code: "MEDIA_ASSET_NOT_FOUND" }, { status: 404 }))
    );

    const response = await GET(new Request("http://web.local"), {
      params: Promise.resolve({ assetId })
    });

    expect(response.status).toBe(404);
  });

  it("rejects an invalid asset id without contacting the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://web.local"), {
      params: Promise.resolve({ assetId: "../../health" })
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the media API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const response = await GET(new Request("http://web.local"), {
      params: Promise.resolve({ assetId })
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "MEDIA_PROXY_UNAVAILABLE" });
  });
});
