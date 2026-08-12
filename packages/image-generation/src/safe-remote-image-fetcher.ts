import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import type { ReadableStream } from "node:stream/web";

import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

import type { Environment } from "@chaoren/contracts";

import { sanitizeProviderUrl } from "./generated-image-binary.js";
import { ImageProviderError } from "./image-generation.port.js";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export interface SafeRemoteImage {
  content: Buffer;
  contentType: string | null;
  finalUrl: string;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface SafeRemoteImageFetcherDependencies {
  fetch?: typeof undiciFetch;
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  createDispatcher?: (addresses: ResolvedAddress[]) => Dispatcher;
}

export class SafeRemoteImageFetcher {
  private readonly fetchImpl: typeof undiciFetch;
  private readonly resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  private readonly dispatcherFactory: ((addresses: ResolvedAddress[]) => Dispatcher) | undefined;

  public constructor(
    private readonly environment: Environment,
    dependencies: SafeRemoteImageFetcherDependencies = {}
  ) {
    this.fetchImpl = dependencies.fetch ?? undiciFetch;
    this.resolve = dependencies.resolve ?? resolveHostname;
    this.dispatcherFactory = dependencies.createDispatcher;
  }

  public async download(
    value: string,
    options: {
      signal?: AbortSignal;
      authorization?: string;
      authorizationOrigin?: string;
      allowedHosts?: string[];
    } = {}
  ): Promise<SafeRemoteImage> {
    let current = parseAndValidateUrl(value);
    const allowedHosts = normalizeAllowedHosts([
      ...configuredAllowedHosts(this.environment),
      ...(options.allowedHosts ?? [])
    ]);

    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      assertAllowedHost(current, allowedHosts);
      const addresses = await this.resolve(current.hostname).catch((error: unknown) => {
        throw new ImageProviderError(
          "IMAGE_DOWNLOAD_FAILED",
          `无法解析生图结果地址，url=${sanitizeProviderUrl(current.href)},reason=${errorMessage(error)}`,
          { stage: "download", retryable: true, cause: error }
        );
      });
      if (addresses.length === 0 || addresses.some((item) => !isPublicAddress(item.address))) {
        throw rejectedUrl(current, "hostname resolves to a non-public address");
      }

      const dispatcher = this.createDispatcher(addresses);
      try {
        let response: Awaited<ReturnType<typeof undiciFetch>>;
        try {
          response = await this.fetchImpl(current, {
            redirect: "manual",
            headers:
              options.authorization &&
              options.authorizationOrigin &&
              current.origin === options.authorizationOrigin
                ? { Authorization: options.authorization }
                : {},
            signal: combinedSignal(this.environment.IMAGE_DOWNLOAD_TIMEOUT_MS, options.signal),
            dispatcher
          });
        } catch (error) {
          throw new ImageProviderError(
            "IMAGE_DOWNLOAD_FAILED",
            `无法下载生图结果，url=${sanitizeProviderUrl(current.href)},reason=${errorMessage(error)}`,
            { stage: "download", retryable: isRetryableDownloadFailure(error), cause: error }
          );
        }

        if (redirectStatuses.has(response.status)) {
          if (redirectCount === 3) {
            throw new ImageProviderError(
              "IMAGE_DOWNLOAD_REDIRECT_LIMIT",
              "生图结果下载重定向次数过多",
              { stage: "download", retryable: false }
            );
          }
          const location = response.headers.get("location");
          if (!location) {
            throw new ImageProviderError("IMAGE_DOWNLOAD_FAILED", "生图结果重定向缺少目标地址", {
              stage: "download",
              retryable: false
            });
          }
          current = parseAndValidateUrl(new URL(location, current).href);
          continue;
        }
        if (!response.ok) {
          throw new ImageProviderError(
            "IMAGE_DOWNLOAD_FAILED",
            `无法下载生图结果，status=${response.status},url=${sanitizeProviderUrl(current.href)}`,
            { stage: "download", retryable: response.status === 429 || response.status >= 500 }
          );
        }
        return {
          content: await readBoundedBody(response, this.environment.MAX_GENERATED_IMAGE_BYTES),
          contentType: response.headers.get("content-type"),
          finalUrl: current.href
        };
      } finally {
        await dispatcher.close().catch(() => undefined);
      }
    }
    throw new ImageProviderError("IMAGE_DOWNLOAD_REDIRECT_LIMIT", "生图结果下载重定向次数过多", {
      stage: "download",
      retryable: false
    });
  }

  private createDispatcher(addresses: ResolvedAddress[]): Dispatcher {
    if (this.dispatcherFactory) return this.dispatcherFactory(addresses);
    if (this.environment.OUTBOUND_HTTP_PROXY_URL) {
      return new ProxyAgent(this.environment.OUTBOUND_HTTP_PROXY_URL);
    }
    return new Agent({
      connect: {
        lookup: createPinnedLookup(addresses)
      }
    });
  }
}

export function createPinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const requestedFamily =
      options.family === 4 || options.family === 6 ? options.family : undefined;
    const matching = requestedFamily
      ? addresses.filter((address) => address.family === requestedFamily)
      : addresses;
    if (matching.length === 0) {
      const error = Object.assign(new Error("No validated address matches the requested family"), {
        code: "ENOTFOUND"
      });
      callback(error, options.all ? [] : "", 0);
      return;
    }
    if (options.all) {
      callback(
        null,
        matching.map(({ address, family }) => ({ address, family }))
      );
      return;
    }
    const selected = matching[0]!;
    callback(null, selected.address, selected.family);
  };
}

export function configuredAllowedHosts(environment: Environment): string[] {
  return [
    new URL(environment.OPENAI_IMAGE_BASE_URL).hostname,
    new URL(environment.BYTEDANCE_IMAGE_BASE_URL).hostname,
    ...environment.IMAGE_DOWNLOAD_ALLOWED_HOSTS.split(",")
  ]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isPublicAddress(value: string): boolean {
  if (!ipaddr.isValid(value)) return false;
  const parsed = ipaddr.parse(value);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    return parsed.toIPv4Address().range() === "unicast";
  }
  return parsed.range() === "unicast";
}

async function resolveHostname(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((item) =>
    item.family === 4 || item.family === 6 ? [{ address: item.address, family: item.family }] : []
  );
}

function parseAndValidateUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ImageProviderError("IMAGE_DOWNLOAD_URL_REJECTED", "生图结果地址无效", {
      stage: "download",
      retryable: false
    });
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw rejectedUrl(url, "only HTTPS on port 443 without URL credentials is allowed");
  }
  return url;
}

function assertAllowedHost(url: URL, allowedHosts: Set<string>): void {
  const hostname = url.hostname.toLowerCase();
  const allowed = [...allowedHosts].some(
    (candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`)
  );
  if (!allowed) throw rejectedUrl(url, "hostname is not in the configured download allowlist");
}

function normalizeAllowedHosts(hosts: string[]): Set<string> {
  return new Set(hosts.map((item) => item.trim().toLowerCase()).filter(Boolean));
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ImageProviderError("INVALID_GENERATED_IMAGE_SIZE", "生图结果超过允许大小", {
      stage: "validation",
      retryable: true
    });
  }
  if (!response.body) {
    throw new ImageProviderError("IMAGE_DOWNLOAD_FAILED", "生图结果响应为空", {
      stage: "download",
      retryable: true
    });
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = (response.body as unknown as ReadableStream<Uint8Array>).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ImageProviderError("INVALID_GENERATED_IMAGE_SIZE", "生图结果超过允许大小", {
          stage: "validation",
          retryable: true
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function rejectedUrl(url: URL, reason: string): ImageProviderError {
  return new ImageProviderError(
    "IMAGE_DOWNLOAD_URL_REJECTED",
    `生图结果地址被安全策略拒绝，url=${sanitizeProviderUrl(url.href)},reason=${reason}`,
    { stage: "download", retryable: false }
  );
}

function combinedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return error.message;
  const causeCode = "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
  const causeMessage =
    "message" in cause && typeof cause.message === "string" ? cause.message : undefined;
  return [error.message, causeCode, causeMessage].filter(Boolean).join(": ");
}

const deterministicNetworkErrorCodes = new Set([
  "ERR_INVALID_ARG_TYPE",
  "ERR_INVALID_IP_ADDRESS",
  "UND_ERR_INVALID_ARG",
  "UND_ERR_INVALID_RETURN_VALUE"
]);

export function isRetryableDownloadFailure(error: unknown): boolean {
  for (const candidate of errorChain(error)) {
    const code = errorCode(candidate);
    if (code && deterministicNetworkErrorCodes.has(code)) return false;
  }
  return true;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return chain;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
