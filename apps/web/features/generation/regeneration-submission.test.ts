import { describe, expect, it } from "vitest";

import {
  RegenerationSubmissionStore,
  shouldRetainRegenerationSubmission,
  type RegenerationSubmissionIdentity
} from "./regeneration-submission";

const identity: RegenerationSubmissionIdentity = {
  taskId: "00000000-0000-4000-8000-000000000101",
  unitId: "00000000-0000-4000-8000-000000000102",
  sourceAssetId: "00000000-0000-4000-8000-000000000103"
};

class MemoryStorage {
  public readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("RegenerationSubmissionStore", () => {
  it("reuses one idempotency key for the same unresolved submission", () => {
    const storage = new MemoryStorage();
    const store = new RegenerationSubmissionStore(storage, () => "key-1");

    expect(store.getOrCreate(identity)).toBe("key-1");
    expect(store.getOrCreate(identity)).toBe("key-1");
  });

  it("restores an unresolved key after the page store is recreated", () => {
    const storage = new MemoryStorage();
    const firstPage = new RegenerationSubmissionStore(storage, () => "key-1");
    expect(firstPage.getOrCreate(identity)).toBe("key-1");

    const restoredPage = new RegenerationSubmissionStore(storage, () => "key-2");
    expect(restoredPage.getOrCreate(identity)).toBe("key-1");
  });

  it("creates a new key after the confirmed submission is cleared", () => {
    const keys = ["key-1", "key-2"];
    const store = new RegenerationSubmissionStore(new MemoryStorage(), () => keys.shift()!);

    expect(store.getOrCreate(identity)).toBe("key-1");
    store.clear(identity);
    expect(store.getOrCreate(identity)).toBe("key-2");
  });

  it("does not share keys between different clicked assets", () => {
    const keys = ["key-1", "key-2"];
    const store = new RegenerationSubmissionStore(new MemoryStorage(), () => keys.shift()!);

    expect(store.getOrCreate(identity)).toBe("key-1");
    expect(store.getOrCreate({ ...identity, sourceAssetId: crypto.randomUUID() })).toBe("key-2");
  });
});

describe("shouldRetainRegenerationSubmission", () => {
  it.each([400, 404, 409, 422])("clears a key after a confirmed %s response", (status) => {
    expect(shouldRetainRegenerationSubmission({ status })).toBe(false);
  });

  it.each([500, 502, 503])("retains a key after an ambiguous %s response", (status) => {
    expect(shouldRetainRegenerationSubmission({ status })).toBe(true);
  });

  it("retains a key after a network failure", () => {
    expect(shouldRetainRegenerationSubmission(new TypeError("Failed to fetch"))).toBe(true);
  });
});
