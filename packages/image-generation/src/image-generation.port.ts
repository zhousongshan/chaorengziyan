import type {
  FinalRequirement,
  ImageModelDefinition,
  ImageProvider,
  ImageRenderSettings
} from "@chaoren/contracts";

export type SourceImageRole = "edit_base" | "product" | "reference" | "brand_logo";

export interface ImageGenerationSource {
  assetId: string;
  role: SourceImageRole;
  mimeType: string;
  content: Buffer;
}

export interface ImageGenerationInput {
  requestId: string;
  model: ImageModelDefinition;
  requirement: FinalRequirement;
  renderSettings: ImageRenderSettings;
  instruction: string;
  sources: ImageGenerationSource[];
  signal?: AbortSignal;
  onProviderRequestId?: (providerRequestId: string) => Promise<void>;
  resume?: {
    providerRequestId: string;
    failedStage: "polling" | "download";
  };
}

export interface GeneratedImage {
  content: Buffer;
  mimeType: string;
  providerRequestId?: string;
}

export interface ImageGenerationPort {
  generate(input: ImageGenerationInput): Promise<GeneratedImage[]>;
}

export interface ImageProviderAdapter extends ImageGenerationPort {
  readonly provider: ImageProvider;
}

export class ImageProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: {
      stage?: "submission" | "polling" | "download" | "validation";
      retryable?: boolean;
      cause?: unknown;
    } = {}
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ImageProviderError";
  }
}
