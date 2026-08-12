import type { Environment, ImageModelDefinition } from "@chaoren/contracts";

const knownModels = [
  { id: "bytedance-image", name: "字节生图", provider: "bytedance" },
  { id: "openai-image", name: "GPT 生图", provider: "openai" }
] as const;

export class ImageModelNotAvailableError extends Error {
  public constructor(modelId: string) {
    super(`生图模型不可用: ${modelId}`);
    this.name = "ImageModelNotAvailableError";
  }
}

export function createImageModelDefinitions(environment: Environment): ImageModelDefinition[] {
  const enabledIds = new Set(
    environment.ENABLED_IMAGE_MODELS.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const supportedAspectRatios = environment.ALLOWED_ASPECT_RATIOS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return knownModels.map((model) => ({
    ...model,
    enabled: enabledIds.has(model.id),
    maxImageCount: environment.MAX_IMAGE_COUNT,
    supportedAspectRatios
  }));
}

export function getEnabledImageModel(
  environment: Environment,
  modelId: string
): ImageModelDefinition {
  const model = createImageModelDefinitions(environment).find(
    (candidate) => candidate.id === modelId && candidate.enabled
  );
  if (!model) throw new ImageModelNotAvailableError(modelId);
  return structuredClone(model);
}
