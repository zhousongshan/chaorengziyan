import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
  createAssetFolderRequestSchema,
  favoriteMediaAssetRequestSchema,
  mediaAssetCalendarQuerySchema,
  mediaAssetListQuerySchema,
  renameAssetFolderRequestSchema,
  renameMediaAssetRequestSchema,
  type AssetFolder,
  type AssetFolderListResponse,
  type Environment,
  type MediaAssetCalendarResponse,
  type MediaAssetListResponse,
  type MediaAssetResponse
} from "@chaoren/contracts";
import type { StoragePort } from "@chaoren/storage";

import { AUTHORIZATION_PORT, type AuthorizationPort } from "../authorization/authorization.port.js";
import { ENVIRONMENT } from "../environment.js";
import { ProjectService } from "../projects/project.service.js";
import { STORAGE } from "../storage/storage.constants.js";
import {
  MEDIA_ASSET_REPOSITORY,
  type MediaAssetRecord,
  type MediaAssetRepository
} from "./media-asset.repository.js";
import { validateImageUpload } from "./image-upload.validator.js";
import {
  ASSET_LIBRARY_REPOSITORY,
  type AssetFolderRecord,
  type AssetLibraryMetadata,
  type AssetLibraryRepository
} from "./asset-library.repository.js";

@Injectable()
export class MediaAssetService {
  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(MEDIA_ASSET_REPOSITORY) private readonly assets: MediaAssetRepository,
    @Inject(ASSET_LIBRARY_REPOSITORY) private readonly library: AssetLibraryRepository,
    private readonly projects: ProjectService
  ) {}

  public async uploadImage(input: {
    projectId: string;
    originalFileName: string;
    mimeType: string;
    content: Buffer;
  }): Promise<MediaAssetResponse> {
    await this.projects.assertOwned(input.projectId);
    await this.authorization.assertAccess({
      userId: this.environment.LOCAL_USER_ID,
      projectId: input.projectId,
      assetIds: []
    });

    const validated = await validateImageUpload({
      content: input.content,
      declaredMimeType: input.mimeType,
      maxBytes: this.environment.MAX_UPLOAD_BYTES,
      maxPixels: this.environment.MAX_UPLOAD_IMAGE_PIXELS
    });

    const contentSha256 = createHash("sha256").update(input.content).digest("hex");
    const existing = await this.assets.findUploadedByContentHash(
      this.environment.LOCAL_USER_ID,
      input.projectId,
      "image",
      contentSha256
    );
    if (existing) return this.toResponse(existing);

    const id = randomUUID();
    const storageKey = `source/${input.projectId}/${id}.${validated.extension}`;
    const stored = await this.storage.put(storageKey, Readable.from([input.content]));
    const record: MediaAssetRecord & { origin: "uploaded"; contentSha256: string } = {
      id,
      userId: this.environment.LOCAL_USER_ID,
      projectId: input.projectId,
      kind: "image",
      origin: "uploaded",
      contentSha256,
      storageKey: stored.key,
      mimeType: validated.mimeType,
      byteSize: stored.byteSize,
      originalFileName: input.originalFileName,
      createdAt: new Date().toISOString()
    };
    try {
      const result = await this.assets.createUploadedIfAbsent(record);
      if (!result.created) {
        await this.storage.delete(record.storageKey).catch(() => undefined);
      }
      return this.toResponse(result.record);
    } catch (error) {
      await this.storage.delete(record.storageKey).catch(() => undefined);
      throw error;
    }
  }

  public async getOwnedImages(ids: string[], projectId: string): Promise<MediaAssetRecord[]> {
    const records = await Promise.all(ids.map((id) => this.assets.findById(id)));
    if (
      records.some(
        (record) =>
          !record ||
          record.userId !== this.environment.LOCAL_USER_ID ||
          record.projectId !== projectId ||
          record.kind !== "image"
      )
    ) {
      throw new BadRequestException({
        code: "SOURCE_IMAGE_NOT_AVAILABLE",
        message: "部分商品图或参考图不存在，或不属于当前项目"
      });
    }
    return records as MediaAssetRecord[];
  }

  public async list(rawQuery: unknown): Promise<MediaAssetListResponse> {
    const parsed = mediaAssetListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_MEDIA_ASSET_LIST_QUERY",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "$",
          message: issue.message
        }))
      });
    }
    const result = await this.assets.listByOwner(this.environment.LOCAL_USER_ID, parsed.data);
    return {
      items: result.items,
      pagination: {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        total: result.total,
        totalPages: result.total === 0 ? 0 : Math.ceil(result.total / parsed.data.pageSize)
      }
    };
  }

  public async calendar(rawQuery: unknown): Promise<MediaAssetCalendarResponse> {
    const parsed = mediaAssetCalendarQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_MEDIA_ASSET_CALENDAR_QUERY",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "$",
          message: issue.message
        }))
      });
    }
    return this.assets.calendarByOwner(this.environment.LOCAL_USER_ID, parsed.data);
  }

  public async getOwnedImage(id: string): Promise<MediaAssetRecord> {
    const record = await this.assets.findById(id);
    if (!record || record.userId !== this.environment.LOCAL_USER_ID || record.kind !== "image") {
      throw new NotFoundException({ code: "MEDIA_ASSET_NOT_FOUND" });
    }
    await this.authorization.assertAccess({
      userId: this.environment.LOCAL_USER_ID,
      projectId: record.projectId,
      assetIds: [record.id]
    });
    if (!(await this.assets.isProductAvailable(id, this.environment.LOCAL_USER_ID))) {
      throw new NotFoundException({ code: "MEDIA_ASSET_NOT_FOUND" });
    }
    return record;
  }

  public getPresentationMetadata(
    assetIds: string[]
  ): Promise<Record<string, AssetLibraryMetadata>> {
    return this.library.findMetadataByAssetIds(assetIds, this.environment.LOCAL_USER_ID);
  }

  public async filterProductAvailableIds(ids: string[]): Promise<string[]> {
    const uniqueIds = [...new Set(ids)];
    const eligibility = await Promise.all(
      uniqueIds.map(async (id) => ({
        id,
        available: await this.assets.isProductAvailable(id, this.environment.LOCAL_USER_ID)
      }))
    );
    return eligibility.filter((item) => item.available).map((item) => item.id);
  }

  public async assertProductAvailableIds(ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    const availableIds = await this.filterProductAvailableIds(uniqueIds);
    if (availableIds.length !== uniqueIds.length) {
      throw new BadRequestException({
        code: "GENERATION_SOURCE_NOT_DELIVERABLE",
        message: "部分生成图片尚未通过检查或已被拒绝，不能继续用于创作"
      });
    }
  }

  public async rename(id: string, rawRequest: unknown): Promise<void> {
    const parsed = renameMediaAssetRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw this.invalidLibraryRequest("INVALID_MEDIA_ASSET_RENAME", parsed.error.issues);
    }
    await this.getOwnedImage(id);
    await this.library.renameAsset(
      id,
      this.environment.LOCAL_USER_ID,
      parsed.data.name,
      new Date().toISOString()
    );
  }

  public async favorite(id: string, rawRequest: unknown): Promise<void> {
    const parsed = favoriteMediaAssetRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw this.invalidLibraryRequest("INVALID_MEDIA_ASSET_FAVORITE", parsed.error.issues);
    }
    await this.getOwnedImage(id);
    if (parsed.data.folderId) await this.assertOwnedFolder(parsed.data.folderId);
    await this.library.setFavorite(
      id,
      this.environment.LOCAL_USER_ID,
      parsed.data.folderId,
      new Date().toISOString()
    );
  }

  public async unfavorite(id: string): Promise<void> {
    await this.getOwnedImage(id);
    await this.library.clearFavorite(id, this.environment.LOCAL_USER_ID, new Date().toISOString());
  }

  public async hide(id: string): Promise<void> {
    await this.getOwnedImage(id);
    await this.library.hideAsset(id, this.environment.LOCAL_USER_ID, new Date().toISOString());
  }

  public async listFolders(): Promise<AssetFolderListResponse> {
    const result = await this.library.listFolders(this.environment.LOCAL_USER_ID);
    const defaultTimestamp = "1970-01-01T00:00:00.000Z";
    return {
      items: [
        {
          id: "default",
          name: "默认文件夹",
          system: true,
          assetCount: result.defaultAssetCount,
          createdAt: defaultTimestamp,
          updatedAt: defaultTimestamp
        },
        ...result.items.map((folder) => this.toFolderResponse(folder))
      ]
    };
  }

  public async createFolder(rawRequest: unknown): Promise<AssetFolder> {
    const parsed = createAssetFolderRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw this.invalidLibraryRequest("INVALID_ASSET_FOLDER_CREATE", parsed.error.issues);
    }
    await this.assertFolderNameAvailable(parsed.data.name);
    const now = new Date().toISOString();
    const record: AssetFolderRecord = {
      id: randomUUID(),
      userId: this.environment.LOCAL_USER_ID,
      name: parsed.data.name,
      assetCount: 0,
      createdAt: now,
      updatedAt: now
    };
    await this.library.saveFolder(record);
    return this.toFolderResponse(record);
  }

  public async renameFolder(id: string, rawRequest: unknown): Promise<AssetFolder> {
    const parsed = renameAssetFolderRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw this.invalidLibraryRequest("INVALID_ASSET_FOLDER_RENAME", parsed.error.issues);
    }
    const folder = await this.assertOwnedFolder(id);
    await this.assertFolderNameAvailable(parsed.data.name, id);
    const updatedAt = new Date().toISOString();
    const updated = await this.library.renameFolder(
      id,
      this.environment.LOCAL_USER_ID,
      parsed.data.name,
      updatedAt
    );
    if (!updated) throw new NotFoundException({ code: "ASSET_FOLDER_NOT_FOUND" });
    return this.toFolderResponse({ ...folder, name: parsed.data.name, updatedAt });
  }

  public async deleteFolder(id: string): Promise<void> {
    await this.assertOwnedFolder(id);
    const deleted = await this.library.deleteFolder(id, this.environment.LOCAL_USER_ID);
    if (!deleted) throw new NotFoundException({ code: "ASSET_FOLDER_NOT_FOUND" });
  }

  public read(record: MediaAssetRecord) {
    return this.storage.read(record.storageKey);
  }

  private toResponse(record: MediaAssetRecord): MediaAssetResponse {
    return {
      id: record.id,
      projectId: record.projectId,
      kind: record.kind,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      createdAt: record.createdAt
    };
  }

  private async assertOwnedFolder(id: string): Promise<AssetFolderRecord> {
    const folder = await this.library.findFolderById(id, this.environment.LOCAL_USER_ID);
    if (!folder) throw new NotFoundException({ code: "ASSET_FOLDER_NOT_FOUND" });
    return folder;
  }

  private async assertFolderNameAvailable(name: string, excludingId?: string): Promise<void> {
    if (
      name === "默认文件夹" ||
      (await this.library.folderNameExists(this.environment.LOCAL_USER_ID, name, excludingId))
    ) {
      throw new BadRequestException({
        code: "ASSET_FOLDER_NAME_EXISTS",
        message: "同名文件夹已经存在"
      });
    }
  }

  private invalidLibraryRequest(code: string, issues: { path: PropertyKey[]; message: string }[]) {
    return new BadRequestException({
      code,
      issues: issues.map((issue) => ({
        field: issue.path.join(".") || "$",
        message: issue.message
      }))
    });
  }

  private toFolderResponse(record: AssetFolderRecord): AssetFolder {
    return {
      id: record.id,
      name: record.name,
      system: false,
      assetCount: record.assetCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }
}
