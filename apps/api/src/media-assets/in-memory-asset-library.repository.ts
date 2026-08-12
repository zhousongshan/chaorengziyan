import type {
  AssetFolderRecord,
  AssetLibraryMetadata,
  AssetLibraryRepository
} from "./asset-library.repository.js";

type Metadata = {
  userId: string;
  displayName?: string;
  folderId: string | null;
  favorite: boolean;
  hidden: boolean;
};

export class InMemoryAssetLibraryRepository implements AssetLibraryRepository {
  public readonly metadata = new Map<string, Metadata>();
  private readonly folders = new Map<string, AssetFolderRecord>();

  public findMetadataByAssetIds(
    assetIds: string[],
    userId: string
  ): Promise<Record<string, AssetLibraryMetadata>> {
    const metadata: Record<string, AssetLibraryMetadata> = {};
    for (const assetId of assetIds) {
      const entry = this.metadata.get(assetId);
      if (entry?.userId === userId) {
        metadata[assetId] = {
          displayName: entry.displayName ?? null,
          favorite: entry.favorite
        };
      }
    }
    return Promise.resolve(metadata);
  }

  public renameAsset(assetId: string, userId: string, name: string): Promise<void> {
    this.updateMetadata(assetId, userId, { displayName: name });
    return Promise.resolve();
  }

  public setFavorite(assetId: string, userId: string, folderId: string | null): Promise<void> {
    this.updateMetadata(assetId, userId, { favorite: true, folderId });
    return Promise.resolve();
  }

  public clearFavorite(assetId: string, userId: string): Promise<void> {
    this.updateMetadata(assetId, userId, { favorite: false, folderId: null });
    return Promise.resolve();
  }

  public hideAsset(assetId: string, userId: string): Promise<void> {
    this.updateMetadata(assetId, userId, { hidden: true, favorite: false, folderId: null });
    return Promise.resolve();
  }

  public saveFolder(record: AssetFolderRecord): Promise<void> {
    this.folders.set(record.id, structuredClone(record));
    return Promise.resolve();
  }

  public findFolderById(id: string, userId: string): Promise<AssetFolderRecord | undefined> {
    const folder = this.folders.get(id);
    return Promise.resolve(
      folder?.userId === userId ? this.withAssetCount(structuredClone(folder)) : undefined
    );
  }

  public listFolders(userId: string) {
    const items = [...this.folders.values()]
      .filter((folder) => folder.userId === userId)
      .map((folder) => this.withAssetCount(structuredClone(folder)));
    const defaultAssetCount = [...this.metadata.values()].filter(
      (entry) => entry.userId === userId && entry.favorite && !entry.hidden && !entry.folderId
    ).length;
    return Promise.resolve({ defaultAssetCount, items });
  }

  public folderNameExists(userId: string, name: string, excludingId?: string): Promise<boolean> {
    return Promise.resolve(
      [...this.folders.values()].some(
        (folder) => folder.userId === userId && folder.id !== excludingId && folder.name === name
      )
    );
  }

  public renameFolder(
    id: string,
    userId: string,
    name: string,
    updatedAt: string
  ): Promise<boolean> {
    const folder = this.folders.get(id);
    if (!folder || folder.userId !== userId) return Promise.resolve(false);
    this.folders.set(id, { ...folder, name, updatedAt });
    return Promise.resolve(true);
  }

  public deleteFolder(id: string, userId: string): Promise<boolean> {
    const folder = this.folders.get(id);
    if (!folder || folder.userId !== userId) return Promise.resolve(false);
    for (const [assetId, metadata] of this.metadata) {
      if (metadata.folderId === id) this.metadata.set(assetId, { ...metadata, folderId: null });
    }
    return Promise.resolve(this.folders.delete(id));
  }

  private updateMetadata(assetId: string, userId: string, update: Partial<Metadata>) {
    const current = this.metadata.get(assetId) ?? {
      userId,
      folderId: null,
      favorite: false,
      hidden: false
    };
    this.metadata.set(assetId, { ...current, ...update });
  }

  private withAssetCount(folder: AssetFolderRecord): AssetFolderRecord {
    return {
      ...folder,
      assetCount: [...this.metadata.values()].filter(
        (entry) =>
          entry.userId === folder.userId &&
          entry.favorite &&
          !entry.hidden &&
          entry.folderId === folder.id
      ).length
    };
  }
}
