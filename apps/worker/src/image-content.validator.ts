import sharp, { type Metadata } from "sharp";

import {
  detectGeneratedImageMimeType,
  type GeneratedImageMimeType
} from "@chaoren/image-generation";

const mimeTypeBySharpFormat = new Map<string, GeneratedImageMimeType>([
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"]
]);

export class ImageContentValidationError extends Error {
  public constructor(
    public readonly code: "IMAGE_DECODE_FAILED" | "IMAGE_MIME_TYPE_MISMATCH",
    message: string
  ) {
    super(message);
    this.name = "ImageContentValidationError";
  }
}

export interface ValidatedImageContent {
  mimeType: GeneratedImageMimeType;
  width: number;
  height: number;
}

export async function validateImageContent(input: {
  content: Buffer;
  declaredMimeType: string;
}): Promise<ValidatedImageContent> {
  const signatureMimeType = detectGeneratedImageMimeType(input.content);
  if (!signatureMimeType) {
    throw new ImageContentValidationError(
      "IMAGE_DECODE_FAILED",
      "图片文件头无效，不是受支持的 PNG、JPEG 或 WebP"
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input.content, {
      failOn: "error",
      limitInputPixels: 100_000_000
    }).metadata();
  } catch (error) {
    throw new ImageContentValidationError(
      "IMAGE_DECODE_FAILED",
      `图片无法解码：${error instanceof Error ? error.message : "unknown"}`
    );
  }

  const decodedMimeType = metadata.format ? mimeTypeBySharpFormat.get(metadata.format) : undefined;
  if (!decodedMimeType || !metadata.width || !metadata.height) {
    throw new ImageContentValidationError("IMAGE_DECODE_FAILED", "图片缺少可用的格式或尺寸信息");
  }

  const declaredMimeType = input.declaredMimeType.split(";")[0]?.trim().toLowerCase();
  if (declaredMimeType !== signatureMimeType || decodedMimeType !== signatureMimeType) {
    throw new ImageContentValidationError(
      "IMAGE_MIME_TYPE_MISMATCH",
      `图片类型不一致，declared=${declaredMimeType ?? "missing"},signature=${signatureMimeType},decoded=${decodedMimeType}`
    );
  }

  return {
    mimeType: decodedMimeType,
    width: metadata.width,
    height: metadata.height
  };
}
