import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createDatabase,
  generationStartRequests,
  projects,
  requirementRuns
} from "@chaoren/database";
import type { RequirementResult, ResolveRequirementRequest } from "@chaoren/contracts";

import { DrizzleGenerationStartRequestRepository } from "../src/image-generations/drizzle-generation-start-request.repository.js";
import { DrizzleRequirementRunRepository } from "../src/requirements/drizzle-requirement-run.repository.js";
import { databaseTestUrl } from "./database-test-url.js";

const enabled = process.env.RUN_DATABASE_TESTS === "1";
const userId = "00000000-0000-4000-8000-000000000001";

describe.skipIf(!enabled)("Generation start persistence", () => {
  it("reads an early v3 requirement as legacy context without rewriting its JSON", async () => {
    const connection = createDatabase(await databaseTestUrl());
    const repository = new DrizzleRequirementRunRepository(connection);
    const projectId = randomUUID();
    const requirementRunId = randomUUID();
    const productAssetId = randomUUID();
    const executionPlan = earlyV3Plan(productAssetId);

    try {
      await insertProject(connection, projectId);
      await connection.db.insert(requirementRuns).values({
        id: requirementRunId,
        userId,
        projectId,
        request: requirementRequest(projectId, productAssetId),
        result: readyResult(),
        executionPlan,
        aiModel: "integration-test",
        promptVersion: "early-v3",
        createdAt: new Date()
      });

      await expect(repository.findById(requirementRunId)).resolves.toMatchObject({
        id: requirementRunId,
        executionPlan: { schemaVersion: "2.0", summary: executionPlan.summary }
      });
      await expect(repository.findPresentationContextById(requirementRunId)).resolves.toEqual({
        parentRequirementRunId: null,
        productImageCount: 1
      });

      const [raw] = await connection.db
        .select({ executionPlan: requirementRuns.executionPlan })
        .from(requirementRuns)
        .where(eq(requirementRuns.id, requirementRunId));
      expect(raw?.executionPlan).toEqual(executionPlan);
    } finally {
      await connection.db.delete(requirementRuns).where(eq(requirementRuns.id, requirementRunId));
      await connection.db.delete(projects).where(eq(projects.id, projectId));
      await connection.close();
    }
  });

  it("allows only one concurrent claimant and recovers an expired retry", async () => {
    const databaseUrl = await databaseTestUrl();
    const firstConnection = createDatabase(databaseUrl);
    const secondConnection = createDatabase(databaseUrl);
    const firstRepository = new DrizzleGenerationStartRequestRepository(firstConnection);
    const secondRepository = new DrizzleGenerationStartRequestRepository(secondConnection);
    const projectId = randomUUID();
    const requirementRunId = randomUUID();
    const productAssetId = randomUUID();
    const idempotencyKey = requirementRunId;
    const now = new Date();

    try {
      await insertProject(firstConnection, projectId);
      await firstConnection.db.insert(requirementRuns).values({
        id: requirementRunId,
        userId,
        projectId,
        request: requirementRequest(projectId, productAssetId),
        result: readyResult(),
        executionPlan: earlyV3Plan(productAssetId),
        aiModel: "integration-test",
        promptVersion: "start-request",
        createdAt: now
      });
      await firstConnection.db.insert(generationStartRequests).values({
        requirementRunId,
        userId,
        idempotencyKey,
        status: "pending",
        availableAt: now,
        createdAt: now,
        updatedAt: now
      });

      const claims = await Promise.all([
        firstRepository.claimPending({ now, leaseDurationMs: 60_000, limit: 10 }),
        secondRepository.claimPending({ now, leaseDurationMs: 60_000, limit: 10 })
      ]);
      expect(claims.flat()).toHaveLength(1);
      const firstClaim = claims.flat()[0]!;
      expect(firstClaim).toMatchObject({ requirementRunId, idempotencyKey, attemptCount: 1 });

      await firstRepository.markRetry({
        requirementRunId,
        leaseToken: firstClaim.leaseToken,
        availableAt: new Date(0),
        errorCode: "IMAGE_GENERATION_QUEUE_UNAVAILABLE",
        errorMessage: "Redis unavailable"
      });
      const retried = await secondRepository.claimPending({
        now: new Date(),
        leaseDurationMs: 60_000,
        limit: 10
      });
      expect(retried).toHaveLength(1);
      expect(retried[0]).toMatchObject({ requirementRunId, attemptCount: 2 });
      expect(retried[0]!.leaseToken).not.toBe(firstClaim.leaseToken);

      await secondRepository.markDispatched(requirementRunId, retried[0]!.leaseToken);
      const [stored] = await firstConnection.db
        .select()
        .from(generationStartRequests)
        .where(eq(generationStartRequests.requirementRunId, requirementRunId));
      expect(stored).toMatchObject({
        status: "dispatched",
        attemptCount: 2,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null
      });
      expect(stored?.dispatchedAt).toBeInstanceOf(Date);
    } finally {
      await firstConnection.db
        .delete(generationStartRequests)
        .where(eq(generationStartRequests.requirementRunId, requirementRunId));
      await firstConnection.db
        .delete(requirementRuns)
        .where(eq(requirementRuns.id, requirementRunId));
      await firstConnection.db.delete(projects).where(eq(projects.id, projectId));
      await Promise.all([firstConnection.close(), secondConnection.close()]);
    }
  });
});

async function insertProject(
  connection: ReturnType<typeof createDatabase>,
  projectId: string
): Promise<void> {
  const now = new Date();
  await connection.db.insert(projects).values({
    id: projectId,
    ownerUserId: userId,
    name: "生成启动持久化测试",
    createdAt: now,
    updatedAt: now
  });
}

function requirementRequest(projectId: string, productAssetId: string): ResolveRequirementRequest {
  return {
    projectId,
    modelId: "openai-image",
    userText: "生成一张白底商品图",
    imageSettings: { imageCount: 1, aspectRatio: "1:1" },
    renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
    deliverySettings: {
      outputFormat: "png",
      watermark: { enabled: false, assetId: null, position: "bottom_right" }
    },
    agentInstruction: "",
    productImageIds: [productAssetId],
    referenceImageIds: [],
    editBaseImageId: null,
    referenceGuidance: []
  };
}

function readyResult(): RequirementResult {
  return {
    schemaVersion: "1.0",
    status: "ready",
    finalRequirement: {
      imageCount: 1,
      aspectRatio: "1:1",
      intent: "生成一张白底商品图",
      scene: null,
      background: "白色",
      composition: null,
      lighting: null,
      style: null,
      mustKeep: ["保持商品外观"],
      mustAvoid: [],
      subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
    },
    conflictDecisions: []
  };
}

function earlyV3Plan(productAssetId: string) {
  return {
    schemaVersion: "3.0",
    summary: "早期 v3 计划",
    groups: [
      {
        sourceImages: [
          {
            assetId: productAssetId,
            sourceRole: "product_source",
            usage: "subject_fact",
            position: 0
          }
        ],
        subjectEntities: [],
        subjectPolicy: { defaultAction: "preserve", allowedChanges: [] },
        referenceAnalyses: [],
        outputCount: 1,
        outputLayout: "separate_image",
        instruction: "保持当前商品事实并生成一张图片"
      }
    ]
  };
}
