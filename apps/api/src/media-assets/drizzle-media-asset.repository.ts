import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL
} from "drizzle-orm";

import type {
  MediaAssetCalendarQuery,
  MediaAssetCalendarResponse,
  MediaAssetListItem,
  MediaAssetListQuery
} from "@chaoren/contracts";
import { mediaAssetLibraryEntries, mediaAssets, type DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import { assetIsProductAvailable } from "./media-asset-eligibility.js";
import { formatShanghaiDate, listDateRange, shanghaiMonthRange } from "./media-asset-date.js";
import type { MediaAssetRecord, MediaAssetRepository } from "./media-asset.repository.js";

type AssetFilters = Pick<
  MediaAssetListQuery,
  "folderId" | "keyword" | "projectId" | "scope" | "source"
>;

@Injectable()
export class DrizzleMediaAssetRepository implements MediaAssetRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async save(record: MediaAssetRecord): Promise<void> {
    await this.connection.db.insert(mediaAssets).values({
      id: record.id,
      userId: record.userId,
      projectId: record.projectId,
      kind: record.kind,
      origin: record.origin,
      contentSha256: record.contentSha256,
      storageKey: record.storageKey,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      originalFileName: record.originalFileName,
      createdAt: new Date(record.createdAt)
    });
  }

  public async createUploadedIfAbsent(
    record: MediaAssetRecord & { origin: "uploaded"; contentSha256: string }
  ): Promise<{ record: MediaAssetRecord; created: boolean }> {
    const [created] = await this.connection.db
      .insert(mediaAssets)
      .values({
        id: record.id,
        userId: record.userId,
        projectId: record.projectId,
        kind: record.kind,
        origin: record.origin,
        contentSha256: record.contentSha256,
        storageKey: record.storageKey,
        mimeType: record.mimeType,
        byteSize: record.byteSize,
        originalFileName: record.originalFileName,
        createdAt: new Date(record.createdAt)
      })
      .onConflictDoNothing({
        target: [
          mediaAssets.userId,
          mediaAssets.projectId,
          mediaAssets.kind,
          mediaAssets.contentSha256
        ],
        where: sql`${mediaAssets.origin} = 'uploaded' and ${mediaAssets.contentSha256} is not null`
      })
      .returning();
    if (created) return { record, created: true };

    const [existing] = await this.connection.db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.userId, record.userId),
          eq(mediaAssets.projectId, record.projectId),
          eq(mediaAssets.kind, record.kind),
          eq(mediaAssets.origin, "uploaded"),
          eq(mediaAssets.contentSha256, record.contentSha256)
        )
      )
      .limit(1);
    if (!existing) throw new Error("相同上传图片的并发写入未生成可复用资产");
    return { record: toMediaAssetRecord(existing), created: false };
  }

  public async findUploadedByContentHash(
    userId: string,
    projectId: string,
    kind: MediaAssetRecord["kind"],
    contentSha256: string
  ): Promise<MediaAssetRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.userId, userId),
          eq(mediaAssets.projectId, projectId),
          eq(mediaAssets.kind, kind),
          eq(mediaAssets.origin, "uploaded"),
          eq(mediaAssets.contentSha256, contentSha256)
        )
      )
      .limit(1);
    return row ? toMediaAssetRecord(row) : undefined;
  }

  public async findById(id: string): Promise<MediaAssetRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .limit(1);
    return row ? toMediaAssetRecord(row) : undefined;
  }

  public async isProductAvailable(id: string, userId: string): Promise<boolean> {
    const [row] = await this.connection.db
      .select({
        available: assetIsProductAvailable(this.connection.db, mediaAssets.id)
      })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.userId, userId)))
      .limit(1);
    return row?.available ?? false;
  }

  public async listByOwner(
    userId: string,
    query: MediaAssetListQuery
  ): Promise<{ items: MediaAssetListItem[]; total: number }> {
    const { conditions, displayName } = this.filterContext(userId, query);
    const dateRange = listDateRange(query);
    if (dateRange.start) conditions.push(gte(mediaAssets.createdAt, dateRange.start));
    if (dateRange.end) conditions.push(lt(mediaAssets.createdAt, dateRange.end));

    const where = and(...conditions);
    const [countRow] = await this.connection.db
      .select({ total: count() })
      .from(mediaAssets)
      .leftJoin(
        mediaAssetLibraryEntries,
        and(
          eq(mediaAssetLibraryEntries.assetId, mediaAssets.id),
          eq(mediaAssetLibraryEntries.userId, userId)
        )
      )
      .where(where);
    const total = countRow?.total ?? 0;
    const rows = await this.connection.db
      .select({
        id: mediaAssets.id,
        projectId: mediaAssets.projectId,
        kind: mediaAssets.kind,
        mimeType: mediaAssets.mimeType,
        byteSize: mediaAssets.byteSize,
        createdAt: mediaAssets.createdAt,
        name: displayName,
        favoritedAt: mediaAssetLibraryEntries.favoritedAt,
        folderId: mediaAssetLibraryEntries.folderId,
        origin: mediaAssets.origin
      })
      .from(mediaAssets)
      .leftJoin(
        mediaAssetLibraryEntries,
        and(
          eq(mediaAssetLibraryEntries.assetId, mediaAssets.id),
          eq(mediaAssetLibraryEntries.userId, userId)
        )
      )
      .where(where)
      .orderBy(query.sort === "oldest" ? asc(mediaAssets.createdAt) : desc(mediaAssets.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      items: rows.map(({ origin, favoritedAt, ...row }) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        source: origin,
        favorite: favoritedAt !== null
      })),
      total
    };
  }

  public async calendarByOwner(
    userId: string,
    query: MediaAssetCalendarQuery
  ): Promise<MediaAssetCalendarResponse> {
    const { conditions } = this.filterContext(userId, query);
    const where = and(...conditions);
    const monthRange = shanghaiMonthRange(query.month);
    const shanghaiDay = sql<string>`to_char(${mediaAssets.createdAt} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')`;

    const [bounds, days] = await Promise.all([
      this.connection.db
        .select({
          earliest: sql<Date | null>`min(${mediaAssets.createdAt})`,
          latest: sql<Date | null>`max(${mediaAssets.createdAt})`
        })
        .from(mediaAssets)
        .leftJoin(
          mediaAssetLibraryEntries,
          and(
            eq(mediaAssetLibraryEntries.assetId, mediaAssets.id),
            eq(mediaAssetLibraryEntries.userId, userId)
          )
        )
        .where(where),
      this.connection.db
        .select({ date: shanghaiDay, count: count() })
        .from(mediaAssets)
        .leftJoin(
          mediaAssetLibraryEntries,
          and(
            eq(mediaAssetLibraryEntries.assetId, mediaAssets.id),
            eq(mediaAssetLibraryEntries.userId, userId)
          )
        )
        .where(
          and(
            ...conditions,
            gte(mediaAssets.createdAt, monthRange.start),
            lt(mediaAssets.createdAt, monthRange.end)
          )
        )
        .groupBy(shanghaiDay)
        .orderBy(shanghaiDay)
    ]);

    const range = bounds[0];
    return {
      month: query.month,
      days,
      minDate: range?.earliest ? formatShanghaiDate(range.earliest) : null,
      maxDate: range?.latest ? formatShanghaiDate(range.latest) : null
    };
  }

  private filterContext(userId: string, query: AssetFilters) {
    const displayName = sql<string>`coalesce(${mediaAssetLibraryEntries.displayName}, ${mediaAssets.originalFileName})`;
    const conditions: SQL[] = [
      eq(mediaAssets.userId, userId),
      eq(mediaAssets.kind, "image"),
      assetIsProductAvailable(this.connection.db, mediaAssets.id),
      isNull(mediaAssetLibraryEntries.hiddenAt)
    ];
    if (query.projectId) conditions.push(eq(mediaAssets.projectId, query.projectId));
    if (query.keyword) conditions.push(ilike(displayName, `%${query.keyword}%`));
    if (query.source === "generated") conditions.push(eq(mediaAssets.origin, "generated"));
    if (query.source === "uploaded") conditions.push(eq(mediaAssets.origin, "uploaded"));
    if (query.scope === "favorites") {
      conditions.push(isNotNull(mediaAssetLibraryEntries.favoritedAt));
      if (query.folderId === "default") conditions.push(isNull(mediaAssetLibraryEntries.folderId));
      else if (query.folderId)
        conditions.push(eq(mediaAssetLibraryEntries.folderId, query.folderId));
    }
    return { conditions, displayName };
  }
}

function toMediaAssetRecord(row: typeof mediaAssets.$inferSelect): MediaAssetRecord {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    kind: row.kind,
    origin: row.origin,
    contentSha256: row.contentSha256,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    originalFileName: row.originalFileName,
    createdAt: row.createdAt.toISOString()
  };
}
