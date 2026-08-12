import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { LocalStorageAdapter } from "../src/local-storage-adapter.js";

describe("LocalStorageAdapter", () => {
  it("streams content into a storage key", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chaoren-storage-"));
    const storage = new LocalStorageAdapter(root);

    const stored = await storage.put("projects/p1/source.txt", Readable.from("product"));

    expect(stored).toEqual({ key: "projects/p1/source.txt", byteSize: 7 });
    expect(await readFile(path.join(root, stored.key), "utf8")).toBe("product");
    expect(await storage.exists(stored.key)).toBe(true);
  });

  it.each(["../secret", "/tmp/secret", "a/../../secret"])("rejects unsafe key %s", async (key) => {
    const root = await mkdtemp(path.join(tmpdir(), "chaoren-storage-"));
    const storage = new LocalStorageAdapter(root);
    await expect(storage.put(key, Readable.from("x"))).rejects.toThrow();
  });
});
