import { describe, expect, it, vi } from "vitest";

import {
  AssetUploadValidationError,
  maximumAssetUploadBytes,
  runAssetUploadQueue,
  validateAssetUploadFile,
  type AssetUploadUpdate
} from "./asset-upload";

describe("asset uploads", () => {
  it("rejects unsupported, empty, and oversized files before upload", () => {
    expect(() =>
      validateAssetUploadFile(new File(["text"], "note.txt", { type: "text/plain" }))
    ).toThrow(AssetUploadValidationError);
    expect(() => validateAssetUploadFile(new File([], "empty.png", { type: "image/png" }))).toThrow(
      "图片内容不能为空"
    );
    expect(() =>
      validateAssetUploadFile(
        new File([new Uint8Array(maximumAssetUploadBytes + 1)], "large.png", {
          type: "image/png"
        })
      )
    ).toThrow("图片不能超过 20MB");
  });

  it("limits concurrency and reports every file independently", async () => {
    const tasks = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      file: new File([String(index)], `${index}.png`, { type: "image/png" })
    }));
    let active = 0;
    let maximumActive = 0;
    const updates: AssetUploadUpdate<string>[] = [];
    const upload = vi.fn(async (file: File) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      if (file.name === "3.png") throw new Error("upstream failed");
      return file.name;
    });

    await runAssetUploadQueue({
      tasks,
      upload,
      concurrency: 2,
      onUpdate: (update) => updates.push(update)
    });

    expect(maximumActive).toBe(2);
    expect(upload).toHaveBeenCalledTimes(5);
    expect(updates.filter((update) => update.status === "succeeded")).toHaveLength(4);
    const failedUpdate = updates.find((update) => update.id === "3" && update.status === "failed");
    expect(failedUpdate?.status).toBe("failed");
    if (failedUpdate?.status === "failed") {
      expect(failedUpdate.error).toBeInstanceOf(Error);
    }
  });
});
