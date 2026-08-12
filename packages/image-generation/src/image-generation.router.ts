import type { ImageGenerationInput, ImageProviderAdapter } from "./image-generation.port.js";
import { ImageProviderError } from "./image-generation.port.js";

export class ImageGenerationRouter {
  public constructor(private readonly adapters: ImageProviderAdapter[]) {}

  public generate(input: ImageGenerationInput) {
    const adapter = this.adapters.find((candidate) => candidate.provider === input.model.provider);
    if (!adapter) {
      throw new ImageProviderError(
        "IMAGE_PROVIDER_NOT_SUPPORTED",
        `暂不支持生图服务商: ${input.model.provider}`
      );
    }
    return adapter.generate(input);
  }
}
