import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import { assetFolders, mediaAssetLibraryEntries, type DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type {
  AssetFolderRecord,
  AssetLibraryMetadata,
  AssetLibraryRepository
} from "./asset-library.repository.js";

@Injectable()
export class DrizzleAssetLibraryRepository implements AssetLibraryRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async findMetadataByAssetIds(
    assetIds: string[],
    userId: string
  ): Promise<Record<string, AssetLibraryMetadata>> {
    if (assetIds.length === 0) return {};
    const rows = await this.connection.db
      .select({
        assetId: mediaAssetLibraryEntries.assetId,
        displayName: mediaAssetLibraryEntries.displayName,
        favoritedAt: mediaAssetLibraryEntries.favoritedAt
      })
      .from(mediaAssetLibraryEntries)
      .where(
        and(
          eq(mediaAssetLibraryEntries.userId, userId),
          inArray(mediaAssetLibraryEntries.assetId, assetIds)
        )
      );
    return Object.fromEntries(
      rows.map((row) => [
        row.assetId,
        { displayName: row.displayName, favorite: row.favoritedAt !== null }
      ])
    );
  }

  public async renameAsset(
    assetId: string,
    userId: string,
    name: string,
    updatedAt: string
  ): Promise<void> {
    await this.connection.db
      .insert(mediaAssetLibraryEntries)
      .values({ assetId, userId, displayName: name, updatedAt: new Date(updatedAt) })
      .onConflictDoUpdate({
        target: mediaAssetLibraryEntries.assetId,
        set: { displayName: name, updatedAt: new Date(updatedAt) }
      });
  }

  public async setFavorite(
    assetId: string,
    userId: string,
    folderId: string | null,
    updatedAt: string
  ): Promise<void> {
    const timestamp = new Date(updatedAt);
    await this.connection.db
      .insert(mediaAssetLibraryEntries)
      .values({ assetId, userId, folderId, favoritedAt: timestamp, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: mediaAssetLibraryEntries.assetId,
        set: { folderId, favoritedAt: timestamp, updatedAt: timestamp }
      });
  }

  public async clearFavorite(assetId: string, userId: string, updatedAt: string): Promise<void> {
    await this.connection.db
      .insert(mediaAssetLibraryEntries)
      .values({ assetId, userId, updatedAt: new Date(updatedAt) })
      .onConflictDoUpdate({
        target: mediaAssetLibraryEntries.assetId,
        set: { folderId: null, favoritedAt: null, updatedAt: new Date(updatedAt) }
      });
  }

  public async hideAsset(assetId: string, userId: string, updatedAt: string): Promise<void> {
    const timestamp = new Date(updatedAt);
    await this.connection.db
      .insert(mediaAssetLibraryEntries)
      .values({ assetId, userId, hiddenAt: timestamp, updatedAt: timestamp })
      .onConflictDoUpdate({
        target: mediaAssetLibraryEntries.assetId,
        set: { folderId: null, favoritedAt: null, hiddenAt: timestamp, updatedAt: timestamp }
      });
  }

  public async saveFolder(record: AssetFolderRecord): Promise<void> {
    await this.connection.db.insert(assetFolders).values({
      id: record.id,
      userId: record.userId,
      name: record.name,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt)
    });
  }

  public async findFolderById(id: string, userId: string): Promise<AssetFolderRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(assetFolders)
      .where(and(eq(assetFolders.id, id), eq(assetFolders.userId, userId)))
      .limit(1);
    if (!row) return undefined;
    const assetCount = await this.countFavorites(userId, id);
    return this.toFolderRecord(row, assetCount);
  }

  public async listFolders(userId: string) {
    const rows = await this.connection.db
      .select({
        folder: assetFolders,
        assetCount: count(mediaAssetLibraryEntries.assetId)
      })
      .from(assetFolders)
      .leftJoin(
        mediaAssetLibraryEntries,
        and(
          eq(mediaAssetLibraryEntries.folderId, assetFolders.id),
          eq(mediaAssetLibraryEntries.userId, userId),
          isNotNull(mediaAssetLibraryEntries.favoritedAt),
          isNull(mediaAssetLibraryEntries.hiddenAt)
        )
      )
      .where(eq(assetFolders.userId, userId))
      .groupBy(assetFolders.id)
      .orderBy(desc(assetFolders.updatedAt));
    return {
      defaultAssetCount: await this.countFavorites(userId, null),
      items: rows.map(({ folder, assetCount }) => this.toFolderRecord(folder, assetCount))
    };
  }

  public async folderNameExists(
    userId: string,
    name: string,
    excludingId?: string
  ): Promise<boolean> {
    const [row] = await this.connection.db
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(
        and(
          eq(assetFolders.userId, userId),
          eq(assetFolders.name, name),
          ...(excludingId ? [ne(assetFolders.id, excludingId)] : [])
        )
      )
      .limit(1);
    return Boolean(row);
  }

  public async renameFolder(
    id: string,
    userId: string,
    name: string,
    updatedAt: string
  ): Promise<boolean> {
    const rows = await this.connection.db
      .update(assetFolders)
      .set({ name, updatedAt: new Date(updatedAt) })
      .where(and(eq(assetFolders.id, id), eq(assetFolders.userId, userId)))
      .returning({ id: assetFolders.id });
    return rows.length > 0;
  }

  public async deleteFolder(id: string, userId: string): Promise<boolean> {
    return this.connection.db.transaction(async (transaction) => {
      const [folder] = await transaction
        .select({ id: assetFolders.id })
        .from(assetFolders)
        .where(and(eq(assetFolders.id, id), eq(assetFolders.userId, userId)))
        .limit(1);
      if (!folder) return false;
      await transaction
        .update(mediaAssetLibraryEntries)
        .set({ folderId: null, updatedAt: new Date() })
        .where(
          and(
            eq(mediaAssetLibraryEntries.userId, userId),
            eq(mediaAssetLibraryEntries.folderId, id)
          )
        );
      await transaction.delete(assetFolders).where(eq(assetFolders.id, id));
      return true;
    });
  }

  private async countFavorites(userId: string, folderId: string | null): Promise<number> {
    const [row] = await this.connection.db
      .select({ value: count() })
      .from(mediaAssetLibraryEntries)
      .where(
        and(
          eq(mediaAssetLibraryEntries.userId, userId),
          isNotNull(mediaAssetLibraryEntries.favoritedAt),
          isNull(mediaAssetLibraryEntries.hiddenAt),
          folderId
            ? eq(mediaAssetLibraryEntries.folderId, folderId)
            : isNull(mediaAssetLibraryEntries.folderId)
        )
      );
    return row?.value ?? 0;
  }

  private toFolderRecord(
    row: typeof assetFolders.$inferSelect,
    assetCount: number
  ): AssetFolderRecord {
    return {
      ...row,
      assetCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
