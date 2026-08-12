import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExistingAssetDraft, LocalImageDraft } from "./image-creation-draft.store";
import { useImageCreationDraftStore } from "./image-creation-draft.store";

describe("image creation draft store", () => {
  beforeEach(() => useImageCreationDraftStore.getState().reset());

  it("keeps uploaded ids attached to stable image identities after removal", () => {
    const first = localDraft("first");
    const second = localDraft("second");
    const store = useImageCreationDraftStore.getState();
    store.addProductImages([first, second]);
    store.markProductImageUploaded(first.clientId, "00000000-0000-4000-8000-000000000021");
    store.markProductImageUploaded(second.clientId, "00000000-0000-4000-8000-000000000022");
    useImageCreationDraftStore.getState().removeProductImage(0);

    expect(useImageCreationDraftStore.getState().productImages).toEqual([
      expect.objectContaining({
        clientId: "second",
        assetId: "00000000-0000-4000-8000-000000000022"
      })
    ]);
  });

  it("accepts existing assets without manufacturing local files", () => {
    const existing: ExistingAssetDraft = {
      clientId: "asset-1",
      kind: "asset",
      assetId: "00000000-0000-4000-8000-000000000023",
      name: "资产库商品图.png",
      byteSize: 128,
      previewUrl: "/api/media-assets/00000000-0000-4000-8000-000000000023/content"
    };

    useImageCreationDraftStore.getState().addProductImages([existing]);

    expect(useImageCreationDraftStore.getState().productImages).toEqual([existing]);
  });

  it("does not add the same existing asset twice", () => {
    const existing: ExistingAssetDraft = {
      clientId: "asset-first",
      kind: "asset",
      assetId: "00000000-0000-4000-8000-000000000023",
      name: "资产库商品图.png",
      byteSize: 128,
      previewUrl: "/api/media-assets/00000000-0000-4000-8000-000000000023/content"
    };

    useImageCreationDraftStore.getState().addProductImages([existing]);
    useImageCreationDraftStore
      .getState()
      .addProductImages([{ ...existing, clientId: "asset-second" }]);

    expect(useImageCreationDraftStore.getState().productImages).toEqual([existing]);
  });

  it("preserves asset selection order when one selected image is removed", () => {
    const first = existingDraft("1");
    const second = existingDraft("2");
    const third = existingDraft("3");

    useImageCreationDraftStore.getState().addProductImages([first, second, third]);
    useImageCreationDraftStore.getState().removeProductImage(1);

    expect(useImageCreationDraftStore.getState().productImages).toEqual([first, third]);
  });

  it("keeps independent in-memory drafts when switching conversations", () => {
    const store = useImageCreationDraftStore.getState();
    store.activateDraftScope("session:first");
    store.updateDraft({ userText: "第一个会话的草稿" });
    store.addProductImages([existingDraft("1")]);

    useImageCreationDraftStore.getState().activateDraftScope("session:second");
    expect(useImageCreationDraftStore.getState().userText).toBe("");
    expect(useImageCreationDraftStore.getState().productImages).toEqual([]);
    useImageCreationDraftStore.getState().updateDraft({ userText: "第二个会话的草稿" });

    useImageCreationDraftStore.getState().activateDraftScope("session:first");
    expect(useImageCreationDraftStore.getState().userText).toBe("第一个会话的草稿");
    expect(useImageCreationDraftStore.getState().productImages).toHaveLength(1);
  });

  it("debounces browser persistence while typing", () => {
    vi.useFakeTimers();
    const storage = trackedStorage();
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: vi.fn()
    });

    try {
      const store = useImageCreationDraftStore.getState();
      store.reset();
      useImageCreationDraftStore.getState().activateDraftScope("session:debounced");
      useImageCreationDraftStore.getState().updateDraft({ userText: "第" });
      useImageCreationDraftStore.getState().updateDraft({ userText: "第二次输入" });

      expect(storage.setItem).not.toHaveBeenCalled();
      vi.advanceTimersByTime(299);
      expect(storage.setItem).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(storage.setItem).toHaveBeenCalledTimes(1);
      expect(storage.getItem("chaoren:image-creation-drafts:v2")).toContain("第二次输入");
    } finally {
      useImageCreationDraftStore.getState().reset();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

function trackedStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void values.set(key, value)),
    removeItem: vi.fn((key: string) => void values.delete(key))
  };
}

function existingDraft(index: string): ExistingAssetDraft {
  const assetId = `00000000-0000-4000-8000-${index.padStart(12, "0")}`;
  return {
    clientId: `asset-${index}`,
    kind: "asset",
    assetId,
    name: `${index}.png`,
    byteSize: 128,
    previewUrl: `/api/media-assets/${assetId}/content`
  };
}

function localDraft(clientId: string): LocalImageDraft {
  const file = new File([clientId], `${clientId}.png`, { type: "image/png" });
  return {
    clientId,
    kind: "local",
    file,
    name: file.name,
    byteSize: file.size,
    previewUrl: `blob:${clientId}`
  };
}
