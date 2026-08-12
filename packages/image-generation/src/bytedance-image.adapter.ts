import type { Environment } from "@chaoren/contracts";

import {
  ImageProviderError,
  type GeneratedImage,
  type ImageGenerationInput,
  type ImageProviderAdapter
} from "./image-generation.port.js";
import { parseProviderImages } from "./provider-response.js";

const sizeByRatio: Record<string, string> = {
  "1:1": "2048x2048",
  "3:4": "1728x2304",
  "4:3": "2304x1728",
  "9:16": "1152x2048",
  "16:9": "2048x1152"
};

export class ByteDanceImageAdapter implements ImageProviderAdapter {
  public readonly provider = "bytedance" as const;

  public constructor(private readonly environment: Environment) {}

  public async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    if (!this.environment.BYTEDANCE_IMAGE_API_KEY || !this.environment.BYTEDANCE_IMAGE_MODEL) {
      throw new ImageProviderError(
        "IMAGE_PROVIDER_NOT_CONFIGURED",
        "尚未配置 BYTEDANCE_IMAGE_API_KEY 和 BYTEDANCE_IMAGE_MODEL"
      );
    }

    const prompt = input.instruction;
    const images: GeneratedImage[] = [];
    const imageData = input.sources.map(
      (source) => `data:${source.mimeType};base64,${source.content.toString("base64")}`
    );

    // 方舟图片接口每次请求一张，避免不同模型对批量字段的支持不一致。
    for (let index = 0; index < input.requirement.imageCount; index += 1) {
      const response = await fetch(
        `${this.environment.BYTEDANCE_IMAGE_BASE_URL.replace(/\/$/, "")}/images/generations`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.environment.BYTEDANCE_IMAGE_API_KEY}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: this.environment.BYTEDANCE_IMAGE_MODEL,
            prompt,
            ...(imageData.length === 0
              ? {}
              : { image: imageData.length === 1 ? imageData[0] : imageData }),
            size: sizeByRatio[input.requirement.aspectRatio] ?? "2048x2048",
            response_format: "url",
            stream: false,
            watermark: false
          }),
          signal: combinedSignal(this.environment.IMAGE_GENERATION_TIMEOUT_MS, input.signal)
        }
      );
      const providerRequestId = response.headers.get("x-request-id");
      if (providerRequestId && input.onProviderRequestId) {
        await input.onProviderRequestId(providerRequestId);
      }
      const generated = await parseProviderImages(response, this.environment, input.signal);
      const first = generated[0];
      if (!first) {
        throw new ImageProviderError("INVALID_IMAGE_PROVIDER_RESPONSE", "字节生图未返回图片");
      }
      images.push(first);
    }
    return images;
  }
}

function combinedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
