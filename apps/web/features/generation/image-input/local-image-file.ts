import type { LocalImageDraft } from "@/stores/image-creation-draft.store";

export const maximumLocalImageBytes = 20 * 1024 * 1024;

const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const extensionByType: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};

export type LocalImageInputSource = "file-picker" | "drop" | "clipboard";
export type LocalImageTarget = "product" | "reference" | "watermark";
export type LocalImageFileErrorCode = "unsupported_type" | "too_large";

export class LocalImageFileError extends Error {
  constructor(readonly code: LocalImageFileErrorCode) {
    super(code === "unsupported_type" ? "仅支持上传 PNG、JPG 或 WEBP 图片" : "图片不能超过20MB");
    this.name = "LocalImageFileError";
  }
}

export function createLocalImageDraft(
  file: File,
  input: {
    source: LocalImageInputSource;
    target: LocalImageTarget;
    now?: Date;
    createObjectUrl?: (file: File) => string;
  }
): LocalImageDraft {
  if (!supportedImageTypes.has(file.type)) {
    throw new LocalImageFileError("unsupported_type");
  }
  if (file.size > maximumLocalImageBytes) {
    throw new LocalImageFileError("too_large");
  }

  const normalizedFile =
    input.source === "clipboard" && isClipboardGeneratedName(file.name)
      ? renameClipboardFile(file, input.target, input.now ?? new Date())
      : file;
  const createObjectUrl = input.createObjectUrl ?? ((image: File) => URL.createObjectURL(image));

  return {
    clientId: crypto.randomUUID(),
    kind: "local",
    file: normalizedFile,
    name: normalizedFile.name,
    byteSize: normalizedFile.size,
    previewUrl: createObjectUrl(normalizedFile)
  };
}

function isClipboardGeneratedName(name: string) {
  const normalized = name.trim().toLowerCase();
  return !normalized || /^(image|blob)(\.[a-z0-9]+)?$/.test(normalized);
}

function renameClipboardFile(file: File, target: LocalImageTarget, now: Date) {
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
  const extension = extensionByType[file.type] ?? "png";
  return new File([file], `clipboard-${target}-${timestamp}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified
  });
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
