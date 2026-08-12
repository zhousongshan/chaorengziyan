import type { ImageInputDraft } from "@/stores/image-creation-draft.store";

export async function resolveImageAssetIds(input: {
  images: ImageInputDraft[];
  upload: (file: File) => Promise<{ id: string }>;
  onUploaded: (clientId: string, assetId: string) => void;
}): Promise<string[]> {
  const assetIds: string[] = [];
  for (const image of input.images) {
    if (image.assetId) {
      assetIds.push(image.assetId);
      continue;
    }
    if (image.kind !== "local") {
      throw new Error(`资产 ${image.name} 缺少可复用的 assetId`);
    }
    const uploaded = await input.upload(image.file);
    input.onUploaded(image.clientId, uploaded.id);
    assetIds.push(uploaded.id);
  }
  return assetIds;
}
