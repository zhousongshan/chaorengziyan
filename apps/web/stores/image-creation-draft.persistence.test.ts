import { describe, expect, it } from "vitest";

import {
  initialPersistedImageCreationDraft,
  loadPersistedImageCreationDrafts,
  MAX_PERSISTED_DRAFT_SCOPES,
  PERSISTED_DRAFT_MAX_AGE_MS,
  savePersistedImageCreationDraft
} from "./image-creation-draft.persistence";

describe("image creation draft persistence", () => {
  it("stores serializable drafts by conversation scope", () => {
    const storage = memoryStorage();
    savePersistedImageCreationDraft(
      "session:one",
      { ...initialPersistedImageCreationDraft, userText: "未发送的详情图需求" },
      storage,
      1_000
    );

    expect(loadPersistedImageCreationDrafts(storage, 1_000)["session:one"]?.userText).toBe(
      "未发送的详情图需求"
    );
  });

  it("migrates version 1 drafts without losing content", () => {
    const storage = memoryStorage();
    storage.setItem(
      "chaoren:image-creation-drafts:v1",
      JSON.stringify({
        version: 1,
        drafts: {
          "session:legacy": {
            ...initialPersistedImageCreationDraft,
            userText: "旧版草稿"
          }
        }
      })
    );

    expect(loadPersistedImageCreationDrafts(storage, 5_000)["session:legacy"]?.userText).toBe(
      "旧版草稿"
    );
    expect(storage.getItem("chaoren:image-creation-drafts:v1")).toBeNull();
    expect(storage.getItem("chaoren:image-creation-drafts:v2")).toContain('"version":2');
  });

  it("keeps only the 20 most recently updated scopes", () => {
    const storage = memoryStorage();
    for (let index = 0; index < MAX_PERSISTED_DRAFT_SCOPES + 3; index += 1) {
      savePersistedImageCreationDraft(
        `session:${index}`,
        { ...initialPersistedImageCreationDraft, userText: `draft-${index}` },
        storage,
        10_000 + index
      );
    }

    const drafts = loadPersistedImageCreationDrafts(storage, 11_000);
    expect(Object.keys(drafts)).toHaveLength(MAX_PERSISTED_DRAFT_SCOPES);
    expect(drafts["session:0"]).toBeUndefined();
    expect(drafts["session:22"]?.userText).toBe("draft-22");
  });

  it("expires scopes that have not been updated for 30 days", () => {
    const storage = memoryStorage();
    savePersistedImageCreationDraft(
      "session:expired",
      initialPersistedImageCreationDraft,
      storage,
      1_000
    );

    expect(
      loadPersistedImageCreationDrafts(storage, 1_000 + PERSISTED_DRAFT_MAX_AGE_MS + 1)
    ).toEqual({});
  });

  it("drops malformed cached data instead of breaking the composer", () => {
    const storage = memoryStorage();
    storage.setItem("chaoren:image-creation-drafts:v2", "{broken");

    expect(loadPersistedImageCreationDrafts(storage)).toEqual({});
  });
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => void values.delete(key)
  };
}
