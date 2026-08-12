import { ImageProviderError } from "./image-generation.port.js";

export const generatedImageMimeTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export type GeneratedImageMimeType = (typeof generatedImageMimeTypes)[number];

const generatedImageMimeTypeSet = new Set<string>(generatedImageMimeTypes);

export interface GeneratedImageBinaryValidationInput {
  content: Buffer;
  maxBytes: number;
  responseMimeType?: string | null | undefined;
  declaredMimeType?: string | null | undefined;
  diagnostics?: string | undefined;
}

export function validateGeneratedImageBinary(
  input: GeneratedImageBinaryValidationInput
): GeneratedImageMimeType {
  if (input.content.length === 0 || input.content.length > input.maxBytes) {
    throw providerImageError(
      "INVALID_GENERATED_IMAGE_SIZE",
      `生图结果文件大小无效，bytes=${input.content.length}`,
      input.diagnostics
    );
  }

  const responseMimeType = normalizeMimeType(input.responseMimeType);
  if (responseMimeType && !generatedImageMimeTypeSet.has(responseMimeType)) {
    throw providerImageError(
      "IMAGE_DOWNLOAD_RETURNED_NON_IMAGE",
      `生图下载返回了非图片内容，contentType=${responseMimeType}`,
      input.diagnostics
    );
  }

  const detectedMimeType = detectGeneratedImageMimeType(input.content);
  if (!detectedMimeType) {
    throw providerImageError(
      "IMAGE_BINARY_SIGNATURE_INVALID",
      `生图结果不是受支持的 PNG、JPEG 或 WebP 图片，bytes=${input.content.length}`,
      input.diagnostics
    );
  }

  const declaredMimeType = normalizeMimeType(input.declaredMimeType);
  for (const [source, mimeType] of [
    ["response", responseMimeType],
    ["declared", declaredMimeType]
  ] as const) {
    if (mimeType && generatedImageMimeTypeSet.has(mimeType) && mimeType !== detectedMimeType) {
      throw providerImageError(
        "IMAGE_MIME_TYPE_MISMATCH",
        `生图结果类型不一致，${source}=${mimeType}，detected=${detectedMimeType}`,
        input.diagnostics
      );
    }
  }
  return detectedMimeType;
}

export function detectGeneratedImageMimeType(
  content: Uint8Array
): GeneratedImageMimeType | undefined {
  if (
    content.length >= 8 &&
    content[0] === 0x89 &&
    content[1] === 0x50 &&
    content[2] === 0x4e &&
    content[3] === 0x47 &&
    content[4] === 0x0d &&
    content[5] === 0x0a &&
    content[6] === 0x1a &&
    content[7] === 0x0a
  ) {
    return "image/png";
  }
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }
  if (content.length >= 12 && ascii(content, 0, 4) === "RIFF" && ascii(content, 8, 12) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

export function sanitizeProviderUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function normalizeMimeType(value: string | null | undefined): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase() || undefined;
}

function ascii(content: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...content.subarray(start, end));
}

function providerImageError(
  code: string,
  message: string,
  diagnostics?: string
): ImageProviderError {
  return new ImageProviderError(code, diagnostics ? `${message}；${diagnostics}` : message);
}
