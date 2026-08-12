import { Injectable } from "@nestjs/common";

import type {
  MediaAssetCalendarQuery,
  MediaAssetCalendarResponse,
  MediaAssetListItem,
  MediaAssetListQuery
} from "@chaoren/contracts";

import { InMemoryAssetLibraryRepository } from "./in-memory-asset-library.repository.js";
import { formatShanghaiDate } from "./media-asset-date.js";
import type { MediaAssetRecord, MediaAssetRepository } from "./media-asset.repository.js";

type AssetFilters = Pick<
  MediaAssetListQuery,
  "folderId" | "keyword" | "projectId" | "scope" | "source"
>;

@Injectable()
export class InMemoryMediaAssetRepository implements MediaAssetRepository {
  private readonly records = new Map<string, MediaAssetRecord>();

  public constructor(
    private readonly library: InMemoryAssetLibraryRepository = new InMemoryAssetLibraryRepository()
  ) {}

  public save(record: MediaAssetRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
    return Promise.resolve();
  }

  public createUploadedIfAbsent(
    record: MediaAssetRecord & { origin: "uploaded"; contentSha256: string }
  ): Promise<{ record: MediaAssetRecord; created: boolean }> {
    const existing = [...this.records.values()].find(
      (candidate) =>
        candidate.userId === record.userId &&
        candidate.projectId === record.projectId &&
        candidate.kind === record.kind &&
        candidate.origin === "uploaded" &&
        candidate.contentSha256 === record.contentSha256
    );
    if (existing) {
      return Promise.resolve({ record: structuredClone(existing), created: false });
    }
    this.records.set(record.id, structuredClone(record));
    return Promise.resolve({ record: structuredClone(record), created: true });
  }

  public findUploadedByContentHash(
    userId: string,
    projectId: string,
    kind: MediaAssetRecord["kind"],
    contentSha256: string
  ): Promise<MediaAssetRecord | undefined> {
    const record = [...this.records.values()].find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.projectId === projectId &&
        candidate.kind === kind &&
        candidate.origin === "uploaded" &&
        candidate.contentSha256 === contentSha256
    );
    return Promise.resolve(record ? structuredClone(record) : undefined);
  }

  public findById(id: string): Promise<MediaAssetRecord | undefined> {
    const record = this.records.get(id);
    return Promise.resolve(record ? structuredClone(record) : undefined);
  }

  public isProductAvailable(id: string, userId: string): Promise<boolean> {
    const record = this.records.get(id);
    return Promise.resolve(Boolean(record && record.userId === userId));
  }

  public listByOwner(
    userId: string,
    query: MediaAssetListQuery
  ): Promise<{ items: MediaAssetListItem[]; total: number }> {
    const filtered = this.filteredRecords(userId, query)
      .filter((record) => {
        const day = formatShanghaiDate(record.createdAt);
        if (query.date) return day === query.date;
        return (!query.dateFrom || day >= query.dateFrom) && (!query.dateTo || day <= query.dateTo);
      })
      .sort((left, right) => {
        const difference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
        return query.sort === "oldest" ? difference : -difference;
      });
    const offset = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: filtered
        .slice(offset, offset + query.pageSize)
        .map((record) => this.toUploadedListItem(record)),
      total: filtered.length
    });
  }

  public calendarByOwner(
    userId: string,
    query: MediaAssetCalendarQuery
  ): Promise<MediaAssetCalendarResponse> {
    const dates = this.filteredRecords(userId, query).map((record) =>
      formatShanghaiDate(record.createdAt)
    );
    const counts = new Map<string, number>();
    for (const date of dates) {
      if (date.startsWith(`${query.month}-`)) counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    return Promise.resolve({
      month: query.month,
      days: [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, count]) => ({ date, count })),
      minDate:
        dates.length > 0 ? dates.reduce((left, right) => (left < right ? left : right)) : null,
      maxDate:
        dates.length > 0 ? dates.reduce((left, right) => (left > right ? left : right)) : null
    });
  }

  private filteredRecords(userId: string, query: AssetFilters): MediaAssetRecord[] {
    const keyword = query.keyword.toLocaleLowerCase();
    return [...this.records.values()]
      .filter((record) => record.userId === userId && record.kind === "image")
      .filter((record) => !query.projectId || record.projectId === query.projectId)
      .filter((record) => !this.library.metadata.get(record.id)?.hidden)
      .filter((record) => {
        const metadata = this.library.metadata.get(record.id);
        const name = metadata?.displayName ?? record.originalFileName;
        return !keyword || name.toLocaleLowerCase().includes(keyword);
      })
      .filter((record) => {
        if (query.scope !== "favorites") return true;
        const metadata = this.library.metadata.get(record.id);
        if (!metadata?.favorite) return false;
        if (query.folderId === "default") return metadata.folderId === null;
        return !query.folderId || metadata.folderId === query.folderId;
      })
      .filter((record) => query.source === "all" || record.origin === query.source);
  }

  private toUploadedListItem(record: MediaAssetRecord): MediaAssetListItem {
    const metadata = this.library.metadata.get(record.id);
    return {
      id: record.id,
      projectId: record.projectId,
      kind: record.kind,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      createdAt: record.createdAt,
      name: metadata?.displayName ?? record.originalFileName,
      source: record.origin,
      favorite: metadata?.favorite ?? false,
      folderId: metadata?.folderId ?? null
    };
  }
}
