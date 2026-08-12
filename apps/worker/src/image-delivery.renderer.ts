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
  return settings.watermark.enabled || sourceMimeType !== mimeTypeByFormat[settings.outputFormat];
}

export async function renderDeliveryImage(input: {
  source: DeliveryImageInput;
  settings: ImageDeliverySettings;
  watermark?: DeliveryImageInput | null;
}): Promise<DeliveryImageOutput> {
  try {
    let pipeline = sharp(input.source.content, { failOn: "error" }).rotate();
    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height) {
      throw new ImageDeliveryRenderError("生成图缺少可用的宽高信息");
    }

    if (input.settings.watermark.enabled) {
      if (!input.watermark) {
        throw new ImageDeliveryRenderError("水印 Logo 图片不存在");
      }
      const maxWidth = Math.max(48, Math.round(metadata.width * 0.18));
      const maxHeight = Math.max(24, Math.round(metadata.height * 0.12));
      const watermark = await sharp(input.watermark.content, { failOn: "error" })
        .rotate()
        .resize({
          width: maxWidth,
          height: maxHeight,
          fit: "inside",
          withoutEnlargement: true
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      const margin = Math.max(16, Math.round(Math.min(metadata.width, metadata.height) * 0.025));
      const position = resolvePosition({
        canvasWidth: metadata.width,
        canvasHeight: metadata.height,
        overlayWidth: watermark.info.width,
        overlayHeight: watermark.info.height,
        margin,
        position: input.settings.watermark.position
      });
      pipeline = pipeline.composite([{ input: watermark.data, ...position }]);
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

function resolvePosition(input: {
  canvasWidth: number;
  canvasHeight: number;
  overlayWidth: number;
  overlayHeight: number;
  margin: number;
  position: ImageDeliverySettings["watermark"]["position"];
}) {
  const left = {
    top_left: input.margin,
    bottom_left: input.margin,
    top_right: input.canvasWidth - input.overlayWidth - input.margin,
    bottom_right: input.canvasWidth - input.overlayWidth - input.margin,
    center: Math.round((input.canvasWidth - input.overlayWidth) / 2)
  }[input.position];
  const top = {
    top_left: input.margin,
    top_right: input.margin,
    bottom_left: input.canvasHeight - input.overlayHeight - input.margin,
    bottom_right: input.canvasHeight - input.overlayHeight - input.margin,
    center: Math.round((input.canvasHeight - input.overlayHeight) / 2)
  }[input.position];
  return { left: Math.max(0, left), top: Math.max(0, top) };
}
