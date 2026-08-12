import { describe, expect, it } from "vitest";

import { environmentSchema } from "@chaoren/contracts";

import { InMemoryAssetLibraryRepository } from "../src/media-assets/in-memory-asset-library.repository.js";
import { InMemoryMediaAssetRepository } from "../src/media-assets/in-memory-media-asset.repository.js";
import { MediaAssetService } from "../src/media-assets/media-asset.service.js";
import type { ProjectService } from "../src/projects/project.service.js";

const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379"
});

function createService(
  repository: InMemoryMediaAssetRepository,
  library = new InMemoryAssetLibraryRepository()
) {
  return new MediaAssetService(
    environment,
    { assertAccess: () => Promise.resolve() },
    {} as never,
    repository,
    library,
    {} as ProjectService
  );
}

const projectId = "00000000-0000-4000-8000-000000000021";
const assetId = "00000000-0000-4000-8000-000000000031";

async function saveOwnedImage(repository: InMemoryMediaAssetRepository, id = assetId) {
  await repository.save({
    id,
    userId: environment.LOCAL_USER_ID,
    projectId,
    kind: "image",
    storageKey: `source/${id}.png`,
    mimeType: "image/png",
    byteSize: 10,
    originalFileName: "原始商品图.png",
    createdAt: "2026-08-07T08:00:00.000Z"
  });
}

describe("MediaAssetService list", () => {
  it("lists only owned images with search, ordering and pagination", async () => {
    const repository = new InMemoryMediaAssetRepository();
    await repository.save({
      id: "00000000-0000-4000-8000-000000000031",
      userId: environment.LOCAL_USER_ID,
      projectId,
      kind: "image",
      storageKey: "source/old.png",
      mimeType: "image/png",
      byteSize: 10,
      originalFileName: "旧商品图.png",
      createdAt: "2026-08-07T08:00:00.000Z"
    });
    await repository.save({
      id: "00000000-0000-4000-8000-000000000032",
      userId: environment.LOCAL_USER_ID,
      projectId,
      kind: "image",
      storageKey: "source/new.png",
      mimeType: "image/png",
      byteSize: 20,
      originalFileName: "新商品图.png",
      createdAt: "2026-08-08T08:00:00.000Z"
    });
    await repository.save({
      id: "00000000-0000-4000-8000-000000000033",
      userId: "00000000-0000-4000-8000-000000000099",
      projectId,
      kind: "image",
      storageKey: "source/other.png",
      mimeType: "image/png",
      byteSize: 30,
      originalFileName: "其他用户商品图.png",
      createdAt: "2026-08-09T08:00:00.000Z"
    });

    const service = createService(repository);
    await expect(service.list({ keyword: "商品", page: "1", pageSize: "1" })).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000032",
          name: "新商品图.png",
          source: "uploaded"
        })
      ],
      pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 }
    });
  });

  it("rejects unsupported filters instead of silently broadening the query", async () => {
    const service = createService(new InMemoryMediaAssetRepository());

    await expect(service.list({ source: "external" })).rejects.toMatchObject({
      response: { code: "INVALID_MEDIA_ASSET_LIST_QUERY" }
    });
  });

  it("limits picker queries to the requested project", async () => {
    const repository = new InMemoryMediaAssetRepository();
    await saveOwnedImage(repository);
    await saveOwnedImage(repository, "00000000-0000-4000-8000-000000000034");
    const other = await repository.findById("00000000-0000-4000-8000-000000000034");
    if (!other) throw new Error("测试素材未创建");
    await repository.save({
      ...other,
      projectId: "00000000-0000-4000-8000-000000000022"
    });

    await expect(createService(repository).list({ projectId })).resolves.toMatchObject({
      items: [{ id: assetId }],
      pagination: { total: 1 }
    });
  });

  it("filters assets by the Shanghai calendar date", async () => {
    const repository = new InMemoryMediaAssetRepository();
    await saveOwnedImage(repository);

    await expect(createService(repository).list({ date: "2026-08-07" })).resolves.toMatchObject({
      items: [{ id: assetId }],
      pagination: { total: 1 }
    });
    await expect(createService(repository).list({ date: "2026-08-08" })).resolves.toMatchObject({
      items: [],
      pagination: { total: 0 }
    });
  });

  it("filters an inclusive Shanghai date range across the UTC day boundary", async () => {
    const repository = new InMemoryMediaAssetRepository();
    await repository.save({
      id: "00000000-0000-4000-8000-000000000035",
      userId: environment.LOCAL_USER_ID,
      projectId,
      kind: "image",
      storageKey: "source/before-boundary.png",
      mimeType: "image/png",
      byteSize: 10,
      originalFileName: "上海七号.png",
      createdAt: "2026-08-07T15:59:59.000Z"
    });
    await repository.save({
      id: "00000000-0000-4000-8000-000000000036",
      userId: environment.LOCAL_USER_ID,
      projectId,
      kind: "image",
      storageKey: "source/after-boundary.png",
      mimeType: "image/png",
      byteSize: 10,
      originalFileName: "上海八号.png",
      createdAt: "2026-08-07T16:00:00.000Z"
    });

    await expect(
      createService(repository).list({ dateFrom: "2026-08-08", dateTo: "2026-08-08" })
    ).resolves.toMatchObject({
      items: [{ id: "00000000-0000-4000-8000-000000000036" }],
      pagination: { total: 1 }
    });
  });

  it("returns monthly day counts and the full available date bounds", async () => {
    const repository = new InMemoryMediaAssetRepository();
    await saveOwnedImage(repository);
    await repository.save({
      ...(await repository.findById(assetId))!,
      id: "00000000-0000-4000-8000-000000000037",
      storageKey: "source/same-day.png"
    });
    await repository.save({
      ...(await repository.findById(assetId))!,
      id: "00000000-0000-4000-8000-000000000038",
      storageKey: "source/next-month.png",
      createdAt: "2026-09-02T08:00:00.000Z"
    });

    await expect(createService(repository).calendar({ month: "2026-08" })).resolves.toEqual({
      month: "2026-08",
      days: [{ date: "2026-08-07", count: 2 }],
      minDate: "2026-08-07",
      maxDate: "2026-09-02"
    });
  });

  it("renames, favorites and filters an asset through shared library metadata", async () => {
    const library = new InMemoryAssetLibraryRepository();
    const repository = new InMemoryMediaAssetRepository(library);
    const service = createService(repository, library);
    await saveOwnedImage(repository);

    const folder = await service.createFolder({ name: "夏季主图" });
    await service.rename(assetId, { name: "白底鸡模型.png" });
    await service.favorite(assetId, { folderId: folder.id });

    await expect(
      service.list({ scope: "favorites", folderId: folder.id, keyword: "白底" })
    ).resolves.toMatchObject({
      items: [{ id: assetId, name: "白底鸡模型.png", favorite: true, folderId: folder.id }],
      pagination: { total: 1 }
    });
    await expect(service.listFolders()).resolves.toMatchObject({
      items: [
        { id: "default", assetCount: 0 },
        { id: folder.id, name: "夏季主图", assetCount: 1 }
      ]
    });
  });

  it("moves favorites to the default folder when a custom folder is deleted", async () => {
    const library = new InMemoryAssetLibraryRepository();
    const repository = new InMemoryMediaAssetRepository(library);
    const service = createService(repository, library);
    await saveOwnedImage(repository);

    const folder = await service.createFolder({ name: "待归档" });
    await service.favorite(assetId, { folderId: folder.id });
    await service.deleteFolder(folder.id);

    await expect(service.list({ scope: "favorites", folderId: "default" })).resolves.toMatchObject({
      items: [{ id: assetId, favorite: true, folderId: null }],
      pagination: { total: 1 }
    });
  });

  it("hides an asset from the library without deleting its binary record", async () => {
    const library = new InMemoryAssetLibraryRepository();
    const repository = new InMemoryMediaAssetRepository(library);
    const service = createService(repository, library);
    await saveOwnedImage(repository);

    await service.hide(assetId);

    await expect(service.list({})).resolves.toMatchObject({
      items: [],
      pagination: { total: 0 }
    });
    await expect(repository.findById(assetId)).resolves.toMatchObject({ id: assetId });
  });

  it("rejects a favorite folder owned by another user", async () => {
    const library = new InMemoryAssetLibraryRepository();
    const repository = new InMemoryMediaAssetRepository(library);
    const service = createService(repository, library);
    await saveOwnedImage(repository);
    await library.saveFolder({
      id: "00000000-0000-4000-8000-000000000041",
      userId: "00000000-0000-4000-8000-000000000099",
      name: "其他用户目录",
      assetCount: 0,
      createdAt: "2026-08-07T08:00:00.000Z",
      updatedAt: "2026-08-07T08:00:00.000Z"
    });

    await expect(
      service.favorite(assetId, { folderId: "00000000-0000-4000-8000-000000000041" })
    ).rejects.toMatchObject({ response: { code: "ASSET_FOLDER_NOT_FOUND" } });
  });
});
