import { describe, expect, it, vi } from "vitest";

import type { ImageInputDraft } from "@/stores/image-creation-draft.store";

import { resolveImageAssetIds } from "./resolve-image-assets";

describe("resolveImageAssetIds", () => {
  it("preserves mixed asset order and uploads only unresolved local files", async () => {
    const localFile = new File(["local"], "local.png", { type: "image/png" });
    const images: ImageInputDraft[] = [
      {
        clientId: "existing",
        kind: "asset",
        assetId: "00000000-0000-4000-8000-000000000011",
        name: "existing.png",
        byteSize: 10,
        previewUrl: "/existing"
      },
      {
        clientId: "local",
        kind: "local",
        file: localFile,
        name: localFile.name,
        byteSize: localFile.size,
        previewUrl: "blob:local"
      }
    ];
    const upload = vi.fn(() => Promise.resolve({ id: "00000000-0000-4000-8000-000000000012" }));
    const onUploaded = vi.fn();

    await expect(resolveImageAssetIds({ images, upload, onUploaded })).resolves.toEqual([
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012"
    ]);
    expect(upload).toHaveBeenCalledExactlyOnceWith(localFile);
    expect(onUploaded).toHaveBeenCalledWith("local", "00000000-0000-4000-8000-000000000012");
  });

  it("does not upload a local draft that already has an asset id", async () => {
    const file = new File(["cached"], "cached.png", { type: "image/png" });
    const upload = vi.fn();

    await expect(
      resolveImageAssetIds({
        images: [
          {
            clientId: "cached",
            kind: "local",
            file,
            assetId: "00000000-0000-4000-8000-000000000013",
            name: file.name,
            byteSize: file.size,
            previewUrl: "blob:cached"
          }
        ],
        upload,
        onUploaded: vi.fn()
      })
    ).resolves.toEqual(["00000000-0000-4000-8000-000000000013"]);
    expect(upload).not.toHaveBeenCalled();
  });
});
