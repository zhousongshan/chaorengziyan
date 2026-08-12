import type {
  MediaAsset,
  MediaAssetCalendarQuery,
  MediaAssetCalendarResponse,
  MediaAssetListItem,
  MediaAssetListQuery
} from "@chaoren/contracts";

export const MEDIA_ASSET_REPOSITORY = Symbol("MEDIA_ASSET_REPOSITORY");

export interface MediaAssetRecord extends MediaAsset {
  userId: string;
  originalFileName: string;
  origin: "uploaded" | "generated";
  contentSha256: string | null;
}

export interface MediaAssetRepository {
  save(record: MediaAssetRecord): Promise<void>;
  createUploadedIfAbsent(
    record: MediaAssetRecord & { origin: "uploaded"; contentSha256: string }
  ): Promise<{ record: MediaAssetRecord; created: boolean }>;
  findUploadedByContentHash(
    userId: string,
    projectId: string,
    kind: MediaAsset["kind"],
    contentSha256: string
  ): Promise<MediaAssetRecord | undefined>;
  findById(id: string): Promise<MediaAssetRecord | undefined>;
  isProductAvailable(id: string, userId: string): Promise<boolean>;
  listByOwner(
    userId: string,
    query: MediaAssetListQuery
  ): Promise<{ items: MediaAssetListItem[]; total: number }>;
  calendarByOwner(
    userId: string,
    query: MediaAssetCalendarQuery
  ): Promise<MediaAssetCalendarResponse>;
}
