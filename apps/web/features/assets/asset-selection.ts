export function remainingAssetSelectionCapacity(limit: number, selectedCount: number) {
  return Math.max(0, limit - selectedCount);
}
