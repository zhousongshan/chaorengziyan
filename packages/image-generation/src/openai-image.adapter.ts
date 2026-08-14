import { z } from "zod";

import type { Environment } from "@chaoren/contracts";

import { sanitizeProviderUrl, validateGeneratedImageBinary } from "./generated-image-binary.js";
import {
  ImageProviderError,
  type GeneratedImage,
  type ImageGenerationInput,
  type ImageProviderAdapter
} from "./image-generation.port.js";
import { parseProviderImages } from "./provider-response.js";
import { SafeRemoteImageFetcher } from "./safe-remote-image-fetcher.js";

const officialSizeByRatio: Record<string, string> = {
  "1:1": "1024x1024",
  "3:4": "1024x1360",
  "4:3": "1360x1024",
  "9:16": "864x1536",
  "16:9": "1536x864"
};

const relaySizeByPreset: Record<string, Record<string, string>> = {
  "1k": {
    "1:1": "1024x1024",
    "3:4": "768x1024",
    "4:3": "1024x768",
    "9:16": "576x1024",
    "16:9": "1024x576"
  },
  "2k": {
    "1:1": "2048x2048",
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "9:16": "1152x2048",
    "16:9": "2048x1152"
  },
  "3k": {
    "1:1": "3072x3072",
    "3:4": "2304x3072",
    "4:3": "3072x2304",
    "9:16": "1728x3072",
    "16:9": "3072x1728"
  },
  "4k": {
    "1:1": "3840x3840",
    "3:4": "2880x3840",
    "4:3": "3840x2880",
    "9:16": "2160x3840",
    "16:9": "3840x2160"
  }
};

const relaySubmissionSchema = z.object({
  code: z.number(),
  data: z.object({ taskId: z.string().min(1), status: z.string().optional() })
});

const relayResultSchema = z.object({
  code: z.number(),
  data: z.object({
    taskId: z.string().min(1),
    status: z.enum(["queued", "processing", "succeeded", "failed"]),
    images: z
      .array(
        z.object({
          contentUrl: z.url().optional(),
          url: z.url().optional(),
          contentType: z.string().optional()
        })
      )
      .optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional()
  })
});

export class OpenAiImageAdapter implements ImageProviderAdapter {
  public readonly provider = "openai" as const;

  public constructor(
    private readonly environment: Environment,
    private readonly remoteImages = new SafeRemoteImageFetcher(environment)
  ) {}

  public async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    if (!this.environment.OPENAI_IMAGE_API_KEY) {
      throw new ImageProviderError(
        "IMAGE_PROVIDER_NOT_CONFIGURED",
        "尚未配置 OPENAI_IMAGE_API_KEY"
      );
    }
    return this.environment.OPENAI_IMAGE_API_MODE === "async-relay"
      ? this.generateWithAsyncRelay(input)
      : this.generateWithOfficialApi(input);
  }

  private async generateWithOfficialApi(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    const prompt = input.instruction;
    const endpoint = input.sources.length > 0 ? "images/edits" : "images/generations";
    const url = `${this.baseUrl}/${endpoint}`;
    const size = officialSizeByRatio[input.requirement.aspectRatio] ?? "auto";
    const headers = { Authorization: `Bearer ${this.apiKey}` };
    const response =
      input.sources.length > 0
        ? await this.edit(url, headers, input, prompt, size)
        : await fetch(url, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({
              model: this.environment.OPENAI_IMAGE_MODEL,
              prompt,
              n: input.requirement.imageCount,
              size,
              quality: input.renderSettings.providerQuality
            }),
            signal: combinedSignal(this.environment.IMAGE_GENERATION_TIMEOUT_MS, input.signal)
          });

    const providerRequestId = response.headers.get("x-request-id");
    if (providerRequestId && input.onProviderRequestId) {
      await input.onProviderRequestId(providerRequestId);
    }
    const images = await parseProviderImages(
      response,
      this.environment,
      input.signal,
      this.remoteImages
    );
    if (images.length < input.requirement.imageCount) {
      throw new ImageProviderError(
        "INCOMPLETE_IMAGE_PROVIDER_RESPONSE",
        `要求生成 ${input.requirement.imageCount} 张，实际返回 ${images.length} 张`
      );
    }
    return images.slice(0, input.requirement.imageCount);
  }

  private async generateWithAsyncRelay(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    if (input.resume) {
      if (input.requirement.imageCount !== 1) {
        throw new ImageProviderError(
          "INVALID_IMAGE_RESUME_REQUEST",
          "恢复已有生图任务时只能处理一个输出单元",
          { stage: "validation", retryable: false }
        );
      }
      if (input.onProviderRequestId) {
        await input.onProviderRequestId(input.resume.providerRequestId);
      }
      return [await this.pollRelayResult(input.resume.providerRequestId, input.signal)];
    }

    const generated: GeneratedImage[] = [];
    const sourceImages = input.sources.map((source) => ({
      image_url: `data:${source.mimeType};base64,${source.content.toString("base64")}`
    }));

    for (let index = 0; index < input.requirement.imageCount; index += 1) {
      generated.push(await this.generateRelayImage(input, sourceImages, index));
    }
    return generated;
  }

  private async generateRelayImage(
    input: ImageGenerationInput,
    sourceImages: Array<{ image_url: string }>,
    imageIndex: number
  ): Promise<GeneratedImage> {
    const clientTaskId = `${input.requestId}-image-${imageIndex + 1}`;
    const submission = await this.requestJson(
      `${this.baseUrl}/images/generations/async`,
      {
        method: "POST",
        headers: this.jsonHeaders,
        body: JSON.stringify({
          model: this.environment.OPENAI_IMAGE_MODEL,
          prompt: input.instruction,
          n: 1,
          size:
            relaySizeByPreset[input.renderSettings.resolutionPreset]?.[
              input.requirement.aspectRatio
            ] ?? "2048x2048",
          quality: input.renderSettings.providerQuality,
          ...(sourceImages.length > 0 ? { images: sourceImages } : {}),
          clientTaskId,
          idempotencyKey: clientTaskId
        })
      },
      relaySubmissionSchema,
      "ASYNC_IMAGE_SUBMISSION_FAILED",
      "submission",
      input.signal
    );
    if (submission.code !== 0) {
      throw new ImageProviderError(
        "ASYNC_IMAGE_SUBMISSION_FAILED",
        `中转生图服务拒绝任务，业务码 ${submission.code}`,
        { stage: "submission", retryable: false }
      );
    }
    if (input.onProviderRequestId) await input.onProviderRequestId(submission.data.taskId);
    return this.pollRelayResult(submission.data.taskId, input.signal);
  }

  private async pollRelayResult(taskId: string, signal?: AbortSignal): Promise<GeneratedImage> {
    const deadline = Date.now() + this.environment.IMAGE_GENERATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await this.requestJson(
        `${this.baseUrl}/images/generations/result?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
        relayResultSchema,
        "ASYNC_IMAGE_RESULT_FAILED",
        "polling",
        signal
      );
      if (result.code !== 0) {
        throw new ImageProviderError(
          "ASYNC_IMAGE_RESULT_FAILED",
          `中转生图服务查询失败，业务码 ${result.code}`,
          { stage: "polling", retryable: true }
        );
      }
      if (result.data.status === "failed") {
        throw new ImageProviderError(
          result.data.error?.code || "ASYNC_IMAGE_GENERATION_FAILED",
          result.data.error?.message || "中转生图任务失败",
          { stage: "polling", retryable: false }
        );
      }
      if (result.data.status === "succeeded") {
        const image = result.data.images?.[0];
        const imageUrl = image?.contentUrl ?? image?.url;
        if (!imageUrl) {
          throw new ImageProviderError(
            "INVALID_IMAGE_PROVIDER_RESPONSE",
            "中转生图任务成功但没有返回图片地址",
            { stage: "polling", retryable: true }
          );
        }
        return this.downloadRelayImage(imageUrl, image?.contentType, taskId, signal);
      }
      await delay(Math.min(2_500, Math.max(1, deadline - Date.now())), signal);
    }
    throw new ImageProviderError("ASYNC_IMAGE_TIMEOUT", "中转生图任务等待结果超时", {
      stage: "polling",
      retryable: true
    });
  }

  private async downloadRelayImage(
    imageUrl: string,
    declaredMimeType: string | undefined,
    taskId: string,
    signal?: AbortSignal
  ): Promise<GeneratedImage> {
    return this.downloadRelayImageOnce(imageUrl, declaredMimeType, taskId, 1, signal);
  }

  private async downloadRelayImageOnce(
    imageUrl: string,
    declaredMimeType: string | undefined,
    taskId: string,
    downloadAttempt: number,
    signal?: AbortSignal
  ): Promise<GeneratedImage> {
    const baseOrigin = new URL(this.baseUrl).origin;
    let downloaded;
    try {
      downloaded = await this.remoteImages.download(imageUrl, {
        ...(signal ? { signal } : {}),
        authorization: `Bearer ${this.apiKey}`,
        authorizationOrigin: baseOrigin,
        allowedHosts: [new URL(this.baseUrl).hostname]
      });
    } catch (error) {
      if (error instanceof ImageProviderError) {
        throw new ImageProviderError(
          error.code,
          `无法下载中转生图结果，providerTaskId=${taskId},downloadAttempt=${downloadAttempt},url=${sanitizeProviderUrl(imageUrl)},reason=${error.message}`,
          {
            stage: error.details.stage ?? "download",
            retryable: error.details.retryable ?? true,
            cause: error
          }
        );
      }
      throw new ImageProviderError(
        "IMAGE_DOWNLOAD_FAILED",
        `无法下载中转生图结果，providerTaskId=${taskId},downloadAttempt=${downloadAttempt},url=${sanitizeProviderUrl(imageUrl)},reason=${error instanceof Error ? error.message : "unknown"}`,
        {
          stage: "download",
          retryable: error instanceof ImageProviderError ? (error.details.retryable ?? true) : true,
          cause: error
        }
      );
    }
    const { content } = downloaded;
    const responseMimeType = downloaded.contentType;
    let mimeType: string;
    try {
      mimeType = validateGeneratedImageBinary({
        content,
        maxBytes: this.environment.MAX_GENERATED_IMAGE_BYTES,
        responseMimeType,
        declaredMimeType,
        diagnostics: `providerTaskId=${taskId},downloadAttempt=${downloadAttempt},url=${sanitizeProviderUrl(downloaded.finalUrl)},contentType=${responseMimeType ?? "missing"},bytes=${content.length}`
      });
    } catch (error) {
      if (!(error instanceof ImageProviderError)) throw error;
      throw new ImageProviderError(error.code, error.message, {
        stage: "validation",
        retryable: true,
        cause: error
      });
    }
    return {
      content,
      mimeType,
      providerRequestId: taskId
    };
  }

  private async requestJson<Schema extends z.ZodType>(
    url: string,
    init: RequestInit,
    schema: Schema,
    errorCode: string,
    stage: "submission" | "polling",
    signal?: AbortSignal
  ): Promise<z.output<Schema>> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: combinedSignal(this.environment.IMAGE_GENERATION_TIMEOUT_MS, signal)
      });
    } catch (error) {
      throw new ImageProviderError(
        errorCode,
        error instanceof Error ? error.message : "中转生图服务请求失败",
        { stage, retryable: true, cause: error }
      );
    }
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new ImageProviderError(
        imageProviderHttpErrorCode(response.status, errorCode),
        `中转生图服务请求失败，状态码 ${response.status}`,
        {
          stage,
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          diagnostics: {
            httpStatus: response.status,
            responseBody: responseBody.slice(0, 2_000)
          }
        }
      );
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new ImageProviderError("INVALID_IMAGE_PROVIDER_RESPONSE", "中转生图服务返回格式无效", {
        stage,
        retryable: true
      });
    }
    return parsed.data;
  }

  private edit(
    url: string,
    headers: { Authorization: string },
    input: ImageGenerationInput,
    prompt: string,
    size: string
  ): Promise<Response> {
    const body = new FormData();
    body.append("model", this.environment.OPENAI_IMAGE_MODEL);
    body.append("prompt", prompt);
    body.append("n", String(input.requirement.imageCount));
    body.append("size", size);
    body.append("quality", input.renderSettings.providerQuality);
    input.sources.forEach((source, index) => {
      body.append(
        "image[]",
        new Blob([new Uint8Array(source.content)], { type: source.mimeType }),
        `input-${index + 1}.${extensionFor(source.mimeType)}`
      );
    });
    return fetch(url, {
      method: "POST",
      headers,
      body,
      signal: combinedSignal(this.environment.IMAGE_GENERATION_TIMEOUT_MS, input.signal)
    });
  }

  private get baseUrl(): string {
    return this.environment.OPENAI_IMAGE_BASE_URL.replace(/\/$/, "");
  }

  private get apiKey(): string {
    return this.environment.OPENAI_IMAGE_API_KEY ?? "";
  }

  private get jsonHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" };
  }
}

function imageProviderHttpErrorCode(status: number, fallback: string): string {
  if (status === 401) return "IMAGE_PROVIDER_AUTH_FAILED";
  if (status === 403) return "IMAGE_PROVIDER_ACCESS_DENIED";
  if (status === 408) return "IMAGE_PROVIDER_TIMEOUT";
  if (status === 429) return "IMAGE_PROVIDER_RATE_LIMITED";
  if (status >= 500) return "IMAGE_PROVIDER_UNAVAILABLE";
  return fallback;
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error("生图请求已停止"));
      },
      { once: true }
    );
  });
}

function combinedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
