import { describe, expect, it } from "vitest";

import { formatAssetBytes, formatAssetDate } from "./asset-formatters";

describe("asset formatters", () => {
  it("uses compact binary file sizes", () => {
    expect(formatAssetBytes(512)).toBe("512 B");
    expect(formatAssetBytes(1536)).toBe("1.5 KB");
    expect(formatAssetBytes(2.25 * 1024 * 1024)).toBe("2.3 MB");
  });

  it("formats valid timestamps for the Chinese workspace", () => {
    expect(formatAssetDate("2026-08-08T08:15:00.000Z")).toBe("2026-08-08");
  });
});
