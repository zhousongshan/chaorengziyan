import { describe, expect, it } from "vitest";

import { remainingAssetSelectionCapacity } from "./asset-selection";

describe("remainingAssetSelectionCapacity", () => {
  it("subtracts assets selected in the current picker session", () => {
    expect(remainingAssetSelectionCapacity(4, 2)).toBe(2);
  });

  it("never returns a negative capacity", () => {
    expect(remainingAssetSelectionCapacity(0, 0)).toBe(0);
    expect(remainingAssetSelectionCapacity(2, 3)).toBe(0);
  });
});
