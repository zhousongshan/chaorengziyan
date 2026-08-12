import { describe, expect, it, vi } from "vitest";
import { MockAgent, Response as UndiciResponse, type Dispatcher } from "undici";

import { environmentSchema } from "@chaoren/contracts";

import { ImageProviderError } from "../src/image-generation.port.js";
import {
  createPinnedLookup,
  isRetryableDownloadFailure,
  SafeRemoteImageFetcher,
  isPublicAddress
} from "../src/safe-remote-image-fetcher.js";

const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379",
  IMAGE_DOWNLOAD_ALLOWED_HOSTS: "images.example.com,cdn.example.com",
  MAX_GENERATED_IMAGE_BYTES: 16
});

describe("safe remote image fetcher", () => {
  it("uses a fetch implementation compatible with the configured Undici dispatcher", async () => {
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    mockAgent
      .get("https://images.example.com")
      .intercept({ path: "/result.png", method: "GET" })
      .reply(200, Buffer.from("image"), { headers: { "content-type": "image/png" } });
    const fetcher = new SafeRemoteImageFetcher(environment, {
      resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }]),
      createDispatcher: () => mockAgent
    });

    const downloaded = await fetcher.download("https://images.example.com/result.png");

    expect(downloaded.content).toEqual(Buffer.from("image"));
    expect(downloaded.contentType).toBe("image/png");
  });

  it("implements both scalar and all-address Node lookup callback contracts", async () => {
    const pinnedLookup = createPinnedLookup([
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 }
    ]);

    const all = await callLookup(pinnedLookup, { all: true });
    expect(all.address).toEqual([
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 }
    ]);
    const ipv6 = await callLookup(pinnedLookup, { all: false, family: 6 });
    expect(ipv6).toEqual({ address: "2001:4860:4860::8888", family: 6 });
  });

  it("rejects private, loopback, link-local and mapped private addresses", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("10.0.0.1")).toBe(false);
    expect(isPublicAddress("169.254.169.254")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
  });

  it("rejects a public redirect that resolves to a private address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new UndiciResponse(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/private.png" }
      })
    );
    const fetcher = new SafeRemoteImageFetcher(environment, {
      fetch: fetchMock,
      resolve: (hostname) =>
        Promise.resolve([
          hostname === "images.example.com"
            ? { address: "8.8.8.8", family: 4 }
            : { address: "127.0.0.1", family: 4 }
        ])
    });

    await expect(fetcher.download("https://images.example.com/result.png")).rejects.toMatchObject({
      code: "IMAGE_DOWNLOAD_URL_REJECTED"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not forward provider authorization to another redirect origin", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new UndiciResponse(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/result.png" }
        })
      )
      .mockResolvedValueOnce(
        new UndiciResponse(Buffer.from("image"), {
          status: 200,
          headers: { "content-type": "image/png" }
        })
      );
    const fetcher = new SafeRemoteImageFetcher(environment, {
      fetch: fetchMock,
      resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }])
    });

    await fetcher.download("https://images.example.com/result.png", {
      authorization: "Bearer secret",
      authorizationOrigin: "https://images.example.com"
    });

    const firstHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers;
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers;
    expect(firstHeaders).toEqual({ Authorization: "Bearer secret" });
    expect(secondHeaders).toEqual({});
  });

  it("rejects a streamed response that exceeds the byte limit", async () => {
    const fetcher = new SafeRemoteImageFetcher(environment, {
      fetch: vi.fn().mockResolvedValue(new UndiciResponse(Buffer.alloc(17), { status: 200 })),
      resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }])
    });
    await expect(fetcher.download("https://images.example.com/result.png")).rejects.toMatchObject({
      code: "INVALID_GENERATED_IMAGE_SIZE"
    });
  });

  it("closes its dispatcher and preserves the underlying network error", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const networkError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Invalid IP address: undefined"), {
        code: "ERR_INVALID_IP_ADDRESS"
      })
    });
    const fetcher = new SafeRemoteImageFetcher(environment, {
      fetch: vi.fn().mockRejectedValue(networkError),
      resolve: () => Promise.resolve([{ address: "8.8.8.8", family: 4 }]),
      createDispatcher: () => ({ close }) as unknown as Dispatcher
    });

    const error: unknown = await fetcher
      .download("https://images.example.com/result.png")
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ImageProviderError);
    if (!(error instanceof ImageProviderError)) throw new Error("expected ImageProviderError");
    expect(error.code).toBe("IMAGE_DOWNLOAD_FAILED");
    expect(error.message).toContain("ERR_INVALID_IP_ADDRESS");
    expect(error.cause).toBe(networkError);
    expect(error.details.retryable).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not retry deterministic dispatcher contract errors", () => {
    const invalidDispatcher = new TypeError("fetch failed", {
      cause: Object.assign(new Error("invalid onRequestStart method"), {
        code: "UND_ERR_INVALID_ARG"
      })
    });
    expect(isRetryableDownloadFailure(invalidDispatcher)).toBe(false);
    expect(
      isRetryableDownloadFailure(Object.assign(new Error("socket reset"), { code: "ECONNRESET" }))
    ).toBe(true);
  });
});

function callLookup(
  lookup: ReturnType<typeof createPinnedLookup>,
  options: { all: boolean; family?: number }
): Promise<{ address: string | Array<{ address: string; family: number }>; family?: number }> {
  return new Promise((resolve, reject) => {
    lookup("images.example.com", options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, ...(family === undefined ? {} : { family }) });
    });
  });
}
