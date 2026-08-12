import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";

import {
  detectGeneratedImageMimeType,
  type GeneratedImageMimeType
} from "@chaoren/image-generation";

const extensionByMimeType: Record<GeneratedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export interface ValidatedImageUpload {
  mimeType: GeneratedImageMimeType;
  extension: string;
  width: number;
  height: number;
}

export async function validateImageUpload(input: {
  content: Buffer;
  declaredMimeType: string;
  maxBytes: number;
  maxPixels: number;
}): Promise<ValidatedImageUpload> {
  if (input.content.length === 0 || input.content.length > input.maxBytes) {
    throw invalidUpload("INVALID_IMAGE_FILE_SIZE", `图片大小必须在 1-${input.maxBytes} 字节之间`);
  }

  const declaredMimeType = normalizeMimeType(input.declaredMimeType);
  const detectedMimeType = detectGeneratedImageMimeType(input.content);
  if (!detectedMimeType) {
    throw invalidUpload("INVALID_IMAGE_SIGNATURE", "图片文件签名不是受支持的 JPEG、PNG 或 WebP");
  }
  if (declaredMimeType !== detectedMimeType) {
    throw invalidUpload("IMAGE_MIME_TYPE_MISMATCH", "图片声明格式与真实文件格式不一致");
  }

  try {
    const decoder = sharp(input.content, {
      animated: true,
      failOn: "error",
      limitInputPixels: input.maxPixels
    });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height) {
      throw invalidUpload("INVALID_IMAGE_DIMENSIONS", "无法读取图片宽高");
    }
    if (metadata.width * metadata.height > input.maxPixels) {
      throw invalidUpload("IMAGE_PIXEL_LIMIT_EXCEEDED", "图片总像素超过允许上限");
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw invalidUpload("ANIMATED_IMAGE_NOT_SUPPORTED", "暂不支持动图或多页图片");
    }
    const decodedFormat = formatToMimeType(metadata.format);
    if (decodedFormat !== detectedMimeType) {
      throw invalidUpload("IMAGE_MIME_TYPE_MISMATCH", "图片解码格式与文件签名不一致");
    }

    // Force libvips to decode pixel data; metadata parsing alone does not detect every truncated file.
    await decoder.clone().resize({ width: 1, height: 1, fit: "inside" }).toBuffer();
    return {
      mimeType: detectedMimeType,
      extension: extensionByMimeType[detectedMimeType],
      width: metadata.width,
      height: metadata.height
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw invalidUpload("IMAGE_DECODE_FAILED", "图片损坏或无法完整解码");
  }
}

function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function formatToMimeType(format: string | undefined): GeneratedImageMimeType | undefined {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  return undefined;
}

function invalidUpload(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}
