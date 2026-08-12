export const maximumAssetUploadBytes = 20 * 1024 * 1024;
export const assetUploadConcurrency = 3;

const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export type AssetUploadTask = {
  id: string;
  file: File;
};

export type AssetUploadUpdate<T> =
  | { id: string; status: "uploading" }
  | { id: string; status: "succeeded"; value: T }
  | { id: string; status: "failed"; error: unknown };

export class AssetUploadValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AssetUploadValidationError";
  }
}

export function validateAssetUploadFile(file: File) {
  if (!supportedImageTypes.has(file.type)) {
    throw new AssetUploadValidationError("仅支持 PNG、JPG 或 WEBP 图片");
  }
  if (file.size === 0) {
    throw new AssetUploadValidationError("图片内容不能为空");
  }
  if (file.size > maximumAssetUploadBytes) {
    throw new AssetUploadValidationError("图片不能超过 20MB");
  }
}

export async function runAssetUploadQueue<T>(input: {
  tasks: AssetUploadTask[];
  upload: (file: File) => Promise<T>;
  onUpdate: (update: AssetUploadUpdate<T>) => void;
  concurrency?: number;
}) {
  const concurrency = Math.max(
    1,
    Math.min(Math.floor(input.concurrency ?? assetUploadConcurrency), input.tasks.length)
  );
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < input.tasks.length) {
      const task = input.tasks[nextIndex++];
      if (!task) return;
      input.onUpdate({ id: task.id, status: "uploading" });
      try {
        const value = await input.upload(task.file);
        input.onUpdate({ id: task.id, status: "succeeded", value });
      } catch (error) {
        input.onUpdate({ id: task.id, status: "failed", error });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
}
