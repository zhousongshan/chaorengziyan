import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  creationRuns,
  createDatabase,
  generationTaskOutputs,
  generationTaskUnits,
  generationTasks,
  mediaAssets,
  projects,
  requirementRuns
} from "@chaoren/database";
import { DrizzleAssetLibraryRepository } from "../src/media-assets/drizzle-asset-library.repository.js";
import { DrizzleMediaAssetRepository } from "../src/media-assets/drizzle-media-asset.repository.js";
import { databaseTestUrl } from "./database-test-url.js";

const enabled = process.env.RUN_DATABASE_TESTS === "1";

describe.skipIf(!enabled)("Asset library PostgreSQL repositories", () => {
  it("persists library metadata while preserving the underlying media asset", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const ids = {
      project: randomUUID(),
      asset: randomUUID(),
      beforeBoundaryAsset: randomUUID(),
      afterBoundaryAsset: randomUUID(),
      deliverableAsset: randomUUID(),
      candidateAsset: randomUUID(),
      rejectedAsset: randomUUID(),
      supersededAsset: randomUUID(),
      requirement: randomUUID(),
      task: randomUUID(),
      folder: randomUUID()
    };
    const userId = "00000000-0000-4000-8000-000000000301";
    const now = new Date().toISOString();
    const shanghaiDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(now));
    const assets = new DrizzleMediaAssetRepository(connection);
    const library = new DrizzleAssetLibraryRepository(connection);

    try {
      await connection.db.insert(projects).values({
        id: ids.project,
        ownerUserId: userId,
        name: "资产库集成测试",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await assets.save({
        id: ids.asset,
        userId,
        projectId: ids.project,
        kind: "image",
        storageKey: `integration/${ids.asset}.png`,
        mimeType: "image/png",
        byteSize: 128,
        originalFileName: "原始名称.png",
        createdAt: now
      });
      await assets.save({
        id: ids.beforeBoundaryAsset,
        userId,
        projectId: ids.project,
        kind: "image",
        storageKey: `integration/${ids.beforeBoundaryAsset}.png`,
        mimeType: "image/png",
        byteSize: 128,
        originalFileName: "边界前.png",
        createdAt: "2026-08-07T15:59:59.000Z"
      });
      await assets.save({
        id: ids.afterBoundaryAsset,
        userId,
        projectId: ids.project,
        kind: "image",
        storageKey: `integration/${ids.afterBoundaryAsset}.png`,
        mimeType: "image/png",
        byteSize: 128,
        originalFileName: "边界后.png",
        createdAt: "2026-08-07T16:00:00.000Z"
      });
      const generatedAssets = [
        [ids.deliverableAsset, "交付图.png"],
        [ids.candidateAsset, "候选图.png"],
        [ids.rejectedAsset, "已拒绝图.png"],
        [ids.supersededAsset, "已替换图.png"]
      ] as const;
      for (const [id, originalFileName] of generatedAssets) {
        await assets.save({
          id,
          userId,
          projectId: ids.project,
          kind: "image",
          storageKey: `integration/${id}.png`,
          mimeType: "image/png",
          byteSize: 128,
          originalFileName,
          createdAt: now
        });
      }
      await connection.db.insert(requirementRuns).values({
        id: ids.requirement,
        userId,
        projectId: ids.project,
        request: {},
        result: {},
        aiModel: "integration-test",
        promptVersion: "integration-test",
        createdAt: new Date(now)
      });
      await connection.db.insert(creationRuns).values({
        id: ids.task,
        userId,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        status: "terminal",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      await connection.db.insert(generationTasks).values({
        id: ids.task,
        creationRunId: ids.task,
        userId,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        idempotencyKey: randomUUID(),
        kind: "image",
        modelId: "integration-test",
        instruction: "素材资格测试",
        instructionVersion: "integration-test",
        status: "succeeded",
        createdAt: new Date(now),
        updatedAt: new Date(now)
      });
      const unitIds = generatedAssets.map(() => randomUUID());
      await connection.db.insert(generationTaskUnits).values(
        unitIds.map((id, position) => ({
          id,
          taskId: ids.task,
          position,
          groupPosition: position,
          variantPosition: 0,
          outputLayout: "separate_image",
          status: "succeeded" as const,
          createdAt: new Date(now),
          updatedAt: new Date(now)
        }))
      );
      await connection.db.insert(generationTaskOutputs).values([
        {
          taskId: ids.task,
          unitId: unitIds[0],
          assetId: ids.deliverableAsset,
          position: 0,
          status: "deliverable",
          deliverableAssetId: ids.deliverableAsset
        },
        {
          taskId: ids.task,
          unitId: unitIds[1],
          assetId: ids.candidateAsset,
          position: 1,
          status: "candidate"
        },
        {
          taskId: ids.task,
          unitId: unitIds[2],
          assetId: ids.rejectedAsset,
          position: 2,
          status: "rejected",
          rejectionCode: "INTEGRATION_TEST"
        },
        {
          taskId: ids.task,
          unitId: unitIds[3],
          assetId: ids.supersededAsset,
          position: 3,
          status: "superseded",
          supersededByAssetId: ids.deliverableAsset
        }
      ]);
      await library.saveFolder({
        id: ids.folder,
        userId,
        name: "商品主图",
        assetCount: 0,
        createdAt: now,
        updatedAt: now
      });
      await library.renameAsset(ids.asset, userId, "白底商品图.png", now);
      await library.setFavorite(ids.asset, userId, ids.folder, now);

      await expect(
        assets.listByOwner(userId, {
          keyword: "",
          scope: "favorites",
          folderId: ids.folder,
          date: shanghaiDate,
          source: "all",
          sort: "newest",
          page: 1,
          pageSize: 20
        })
      ).resolves.toMatchObject({
        items: [
          {
            id: ids.asset,
            name: "白底商品图.png",
            favorite: true,
            folderId: ids.folder
          }
        ],
        total: 1
      });

      await expect(library.deleteFolder(ids.folder, userId)).resolves.toBe(true);

      await expect(
        assets.listByOwner(userId, {
          keyword: "边界",
          scope: "all",
          dateFrom: "2026-08-08",
          dateTo: "2026-08-08",
          source: "all",
          sort: "newest",
          page: 1,
          pageSize: 20
        })
      ).resolves.toMatchObject({
        items: [{ id: ids.afterBoundaryAsset }],
        total: 1
      });
      await expect(
        assets.calendarByOwner(userId, {
          month: "2026-08",
          keyword: "边界",
          scope: "all",
          source: "all"
        })
      ).resolves.toEqual({
        month: "2026-08",
        days: [
          { date: "2026-08-07", count: 1 },
          { date: "2026-08-08", count: 1 }
        ],
        minDate: "2026-08-07",
        maxDate: "2026-08-08"
      });

      await expect(
        assets.listByOwner(userId, {
          keyword: "白底",
          scope: "favorites",
          folderId: "default",
          source: "all",
          sort: "newest",
          page: 1,
          pageSize: 20
        })
      ).resolves.toMatchObject({
        items: [{ id: ids.asset, favorite: true, folderId: null }],
        total: 1
      });

      await library.hideAsset(ids.asset, userId, now);
      await expect(
        assets.listByOwner(userId, {
          keyword: "白底",
          scope: "all",
          source: "all",
          sort: "newest",
          page: 1,
          pageSize: 20
        })
      ).resolves.toEqual({ items: [], total: 0 });
      await expect(assets.findById(ids.asset)).resolves.toMatchObject({ id: ids.asset });

      const sourceQuery = {
        keyword: "",
        scope: "all" as const,
        sort: "newest" as const,
        page: 1,
        pageSize: 20
      };
      await expect(
        assets.listByOwner(userId, { ...sourceQuery, source: "generated" })
      ).resolves.toMatchObject({
        total: 1,
        items: [{ id: ids.deliverableAsset, source: "generated" }]
      });
      await expect(
        assets.listByOwner(userId, { ...sourceQuery, source: "uploaded" })
      ).resolves.toMatchObject({
        total: 2,
        items: expect.arrayContaining([
          expect.objectContaining({ id: ids.beforeBoundaryAsset, source: "uploaded" }),
          expect.objectContaining({ id: ids.afterBoundaryAsset, source: "uploaded" })
        ])
      });
      await expect(
        assets.listByOwner(userId, { ...sourceQuery, source: "all" })
      ).resolves.toMatchObject({ total: 3 });
      for (const unavailableId of [ids.candidateAsset, ids.rejectedAsset, ids.supersededAsset]) {
        await expect(assets.isProductAvailable(unavailableId, userId)).resolves.toBe(false);
      }
      await expect(assets.isProductAvailable(ids.deliverableAsset, userId)).resolves.toBe(true);
    } finally {
      await connection.db.delete(generationTasks).where(eq(generationTasks.id, ids.task));
      await connection.db.delete(creationRuns).where(eq(creationRuns.id, ids.task));
      await connection.db.delete(requirementRuns).where(eq(requirementRuns.id, ids.requirement));
      await connection.db.delete(mediaAssets).where(eq(mediaAssets.projectId, ids.project));
      await connection.db.delete(projects).where(eq(projects.id, ids.project));
      await connection.close();
    }
  });
});
