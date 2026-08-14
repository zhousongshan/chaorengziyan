import sharp from "sharp";

import type { ImageDeliverySettings } from "@chaoren/contracts";

const mimeTypeByFormat = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp"
} as const;

const extensionByFormat = {
  png: "png",
  jpeg: "jpg",
  webp: "webp"
} as const;

export interface DeliveryImageInput {
  content: Buffer;
  mimeType: string;
}

export interface DeliveryImageOutput {
  content: Buffer;
  mimeType: string;
  extension: string;
}

export class ImageDeliveryRenderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ImageDeliveryRenderError";
  }
}

export function deliveryRequiresDerivedAsset(
  sourceMimeType: string,
  settings: ImageDeliverySettings
): boolean {
  return sourceMimeType !== mimeTypeByFormat[settings.outputFormat];
}

export async function renderDeliveryImage(input: {
  source: DeliveryImageInput;
  settings: ImageDeliverySettings;
  watermark?: DeliveryImageInput | null;
}): Promise<DeliveryImageOutput> {
  try {
    const pipeline = sharp(input.source.content, { failOn: "error" }).rotate();
    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height) {
      throw new ImageDeliveryRenderError("生成图缺少可用的宽高信息");
    }

    const outputFormat = input.settings.outputFormat;
    const content =
      outputFormat === "jpeg"
        ? await pipeline
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer()
        : outputFormat === "webp"
          ? await pipeline.webp({ quality: 95, smartSubsample: true }).toBuffer()
          : await pipeline.png({ compressionLevel: 9, quality: 100 }).toBuffer();

    return {
      content,
      mimeType: mimeTypeByFormat[outputFormat],
      extension: extensionByFormat[outputFormat]
    };
  } catch (error) {
    if (error instanceof ImageDeliveryRenderError) throw error;
    throw new ImageDeliveryRenderError(
      error instanceof Error ? `交付图处理失败：${error.message}` : "交付图处理失败"
    );
  }
}
