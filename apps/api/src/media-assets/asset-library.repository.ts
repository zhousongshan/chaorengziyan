export const ASSET_LIBRARY_REPOSITORY = Symbol("ASSET_LIBRARY_REPOSITORY");

export interface AssetFolderRecord {
  id: string;
  userId: string;
  name: string;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetLibraryMetadata {
  displayName: string | null;
  favorite: boolean;
}

export interface AssetLibraryRepository {
  findMetadataByAssetIds(
    assetIds: string[],
    userId: string
  ): Promise<Record<string, AssetLibraryMetadata>>;
  renameAsset(assetId: string, userId: string, name: string, updatedAt: string): Promise<void>;
  setFavorite(
    assetId: string,
    userId: string,
    folderId: string | null,
    updatedAt: string
  ): Promise<void>;
  clearFavorite(assetId: string, userId: string, updatedAt: string): Promise<void>;
  hideAsset(assetId: string, userId: string, updatedAt: string): Promise<void>;
  saveFolder(record: AssetFolderRecord): Promise<void>;
  findFolderById(id: string, userId: string): Promise<AssetFolderRecord | undefined>;
  listFolders(userId: string): Promise<{ defaultAssetCount: number; items: AssetFolderRecord[] }>;
  folderNameExists(userId: string, name: string, excludingId?: string): Promise<boolean>;
  renameFolder(id: string, userId: string, name: string, updatedAt: string): Promise<boolean>;
  deleteFolder(id: string, userId: string): Promise<boolean>;
}
