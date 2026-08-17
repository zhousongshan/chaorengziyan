import { z } from "zod";

import type { Environment } from "@chaoren/contracts";

import { sanitizeProviderUrl, validateGeneratedImageBinary } from "./generated-image-binary.js";
import { ImageProviderError, type GeneratedImage } from "./image-generation.port.js";
import { SafeRemoteImageFetcher } from "./safe-remote-image-fetcher.js";

const providerResponseSchema = z.object({
  data: z.array(
    z.object({
      b64_json: z.string().optional(),
      url: z.url().optional()
    })
  )
});

export async function parseProviderImages(
  response: Response,
  environment: Environment,
  signal?: AbortSignal,
  remoteImages = new SafeRemoteImageFetcher(environment)
): Promise<GeneratedImage[]> {
  const providerRequestId = response.headers.get("x-request-id") ?? undefined;
  const responseBody = await response.text().catch(() => "");
  if (!response.ok) {
    const details = {
      stage: "submission" as const,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500
    };
    if (responseBody) {
      throw new ImageProviderError(
        providerHttpErrorCode(response.status, responseBody),
        `生图服务请求失败，状态码 ${response.status}${providerRequestId ? `，请求ID ${providerRequestId}` : ""}`,
        { ...details, diagnostics: { responseBody: responseBody.slice(0, 2_000) } }
      );
    }
    throw new ImageProviderError(
      providerHttpErrorCode(response.status, responseBody),
      `生图服务请求失败，状态码 ${response.status}${providerRequestId ? `，请求ID ${providerRequestId}` : ""}`,
      details
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(responseBody);
  } catch {
    json = undefined;
  }
  const parsed = providerResponseSchema.safeParse(json);
  if (!parsed.success || parsed.data.data.length === 0) {
    throw new ImageProviderError("INVALID_IMAGE_PROVIDER_RESPONSE", "生图服务没有返回有效图片");
  }

  return Promise.all(
    parsed.data.data.map(async (item) => {
      if (item.b64_json) {
        const content = Buffer.from(item.b64_json, "base64");
        const mimeType = validateGeneratedImageBinary({
          content,
          maxBytes: environment.MAX_GENERATED_IMAGE_BYTES,
          declaredMimeType: "image/png",
          diagnostics: providerRequestId ? `providerRequestId=${providerRequestId}` : undefined
        });
        return withRequestId({ content, mimeType }, providerRequestId);
      }
      if (item.url) {
        return downloadProviderImage(
          item.url,
          environment,
          providerRequestId,
          signal,
          remoteImages
        );
      }
      throw new ImageProviderError("INVALID_IMAGE_PROVIDER_RESPONSE", "生图结果缺少图片数据");
    })
  );
}

function providerHttpErrorCode(status: number, responseBody: string): string {
  if (hasQuotaCode(responseBody)) return "IMAGE_PROVIDER_QUOTA_EXHAUSTED";
  if (status === 401) return "IMAGE_PROVIDER_AUTH_FAILED";
  if (status === 403) return "IMAGE_PROVIDER_ACCESS_DENIED";
  if (status === 408) return "IMAGE_PROVIDER_TIMEOUT";
  if (status === 429) return "IMAGE_PROVIDER_RATE_LIMITED";
  if (status >= 500) return "IMAGE_PROVIDER_UNAVAILABLE";
  return "IMAGE_PROVIDER_REQUEST_FAILED";
}

function hasQuotaCode(responseBody: string): boolean {
  try {
    const body = JSON.parse(responseBody) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const record = body as Record<string, unknown>;
    const nestedError =
      record.error && typeof record.error === "object" && !Array.isArray(record.error)
        ? (record.error as Record<string, unknown>)
        : undefined;
    const code = typeof record.code === "string" ? record.code : nestedError?.code;
    return (
      typeof code === "string" &&
      new Set(["insufficient_user_quota", "insufficient_quota", "billing_hard_limit_reached"]).has(
        code.toLowerCase()
      )
    );
  } catch {
    return false;
  }
}

async function downloadProviderImage(
  url: string,
  environment: Environment,
  providerRequestId: string | undefined,
  signal: AbortSignal | undefined,
  remoteImages: SafeRemoteImageFetcher
): Promise<GeneratedImage> {
  const downloaded = await remoteImages.download(url, signal ? { signal } : {});
  const { content } = downloaded;
  const mimeType = validateGeneratedImageBinary({
    content,
    maxBytes: environment.MAX_GENERATED_IMAGE_BYTES,
    responseMimeType: downloaded.contentType,
    diagnostics: `downloadAttempt=1,url=${sanitizeProviderUrl(downloaded.finalUrl)},bytes=${content.length}${providerRequestId ? `,providerRequestId=${providerRequestId}` : ""}`
  });
  return withRequestId({ content, mimeType }, providerRequestId);
}

function withRequestId(
  image: Omit<GeneratedImage, "providerRequestId">,
  providerRequestId: string | undefined
): GeneratedImage {
  return providerRequestId ? { ...image, providerRequestId } : image;
}
