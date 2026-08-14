import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { Queue, Worker } from "bullmq";
import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";

import {
  environmentSchema,
  IMAGE_GENERATION_UNIT_JOB_NAME,
  imageGenerationUnitJobId,
  type ImageGenerationUnitJobData,
  type RequirementResult,
  type ResolveRequirementRequest
} from "@chaoren/contracts";
import {
  createDatabase,
  creationRuns,
  generationTaskUnitQualitySources,
  generationTaskUnits,
  generationTaskUnitSources,
  generationUnitSubjectEntities,
  generationUnitSubjectEntitySources,
  generationTaskOutputs,
  generationTasks,
  generationUnitAttempts,
  mediaAssets,
  projects,
  requirementRuns,
  subjectConsistencyChecks,
  subjectConsistencyCheckSources
} from "@chaoren/database";
import { ImageProviderError, type ImageGenerationPort } from "@chaoren/image-generation";
import { LocalStorageAdapter, resolveWorkspacePath } from "@chaoren/storage";

import { ImageGenerationJobHandler } from "../src/image-generation-job.handler.js";
import { ImageGenerationProcessor } from "../src/image-generation.processor.js";
import { DrizzleImageGenerationTaskStore } from "../src/image-generation-task.store.js";
import { CreationRunCoordinator } from "../src/creation-run.coordinator.js";

const enabled = process.env.RUN_WORKER_INTEGRATION_TESTS === "1";
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe.skipIf(!enabled)("BullMQ image generation flow", () => {
  it("runs independent units, retries one failure once, preserves partial success and quality lineage", async () => {
    config({ path: await resolveWorkspacePath(".env"), quiet: true });
    const environment = environmentSchema.parse({
      ...process.env,
      DATABASE_URL: testDatabaseUrl(process.env)
    });
    const queueName = `${environment.TASK_QUEUE_NAME}-integration-${randomUUID()}`;
    const queueConnection = new Redis(environment.REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1
    });
    const workerConnection = new Redis(environment.REDIS_URL, {
      enableReadyCheck: false,
      maxRetriesPerRequest: null
    });
    const queue = new Queue<ImageGenerationUnitJobData>(queueName, {
      connection: queueConnection
    });
    const database = createDatabase(environment.DATABASE_URL);
    const storageRoot = await mkdtemp(path.join(tmpdir(), "chaoren-worker-integration-"));
    const storage = new LocalStorageAdapter(storageRoot);
    const store = new DrizzleImageGenerationTaskStore(database);
    const ids = {
      project: randomUUID(),
      requirement: randomUUID(),
      source: randomUUID(),
      task: randomUUID(),
      successfulUnit: randomUUID(),
      failedUnit: randomUUID(),
      cancelledTask: randomUUID(),
      cancelledUnit: randomUUID(),
      successfulEntity: randomUUID(),
      failedEntity: randomUUID()
    };
    let failedUnitPaidSubmissions = 0;
    const failedUnitResumes: Array<string | undefined> = [];
    const generator: ImageGenerationPort = {
      generate: async (input) => {
        if (input.requestId.includes(ids.failedUnit)) {
          failedUnitResumes.push(input.resume?.providerRequestId);
          if (!input.resume) failedUnitPaidSubmissions += 1;
          const providerRequestId = input.resume?.providerRequestId ?? `provider-${ids.failedUnit}`;
          await input.onProviderRequestId?.(providerRequestId);
          throw new ImageProviderError("ASYNC_IMAGE_TIMEOUT", "供应商任务等待结果超时", {
            stage: "polling",
            retryable: true
          });
        }
        await input.onProviderRequestId?.(`provider-${input.requestId}`);
        if (input.requestId.includes(ids.cancelledUnit)) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        return [{ content: validPng, mimeType: "image/png" }];
      }
    };
    const processor = new ImageGenerationProcessor(environment, store, storage, generator);
    const handler = new ImageGenerationJobHandler(processor);
    const worker = new Worker<ImageGenerationUnitJobData>(queueName, (job) => handler.handle(job), {
      connection: workerConnection,
      concurrency: 2
    });
    worker.on("error", (error) => console.error("Worker integration runtime error", error));

    try {
      const now = new Date();
      const userId = environment.LOCAL_USER_ID;
      const sourceKey = `source/${ids.project}/${ids.source}.png`;
      const storedSource = await storage.put(
        sourceKey,
        Readable.from([Buffer.from("source-image")])
      );
      const request: ResolveRequirementRequest = {
        projectId: ids.project,
        modelId: "openai-image",
        userText: "生成一张白底商品图",
        imageSettings: { imageCount: 1, aspectRatio: "1:1" },
        renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
        deliverySettings: {
          outputFormat: "png",
          watermark: { enabled: false, assetId: null, position: "bottom_right" }
        },
        agentInstruction: "",
        productImageIds: [ids.source],
        referenceImageIds: [],
        editBaseImageId: null,
        referenceGuidance: []
      };
      const result: RequirementResult = {
        schemaVersion: "1.0",
        status: "ready",
        finalRequirement: {
          imageCount: 1,
          aspectRatio: "1:1",
          intent: "生成一张白底商品图",
          scene: null,
          background: "纯白",
          composition: null,
          lighting: null,
          style: null,
          mustKeep: [],
          mustAvoid: [],
          subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
        },
        conflictDecisions: []
      };

      await database.db.insert(projects).values({
        id: ids.project,
        ownerUserId: userId,
        name: "Worker integration",
        description: null,
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(mediaAssets).values({
        id: ids.source,
        userId,
        projectId: ids.project,
        kind: "image",
        origin: "uploaded",
        contentSha256: null,
        storageKey: storedSource.key,
        mimeType: "image/png",
        byteSize: storedSource.byteSize,
        originalFileName: "source.png",
        createdAt: now
      });
      await database.db.insert(requirementRuns).values({
        id: ids.requirement,
        userId,
        projectId: ids.project,
        request,
        result,
        aiModel: "integration-test",
        promptVersion: "integration-test",
        createdAt: now
      });
      await database.db.insert(creationRuns).values({
        id: ids.task,
        userId,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(generationTasks).values({
        id: ids.task,
        creationRunId: ids.task,
        userId,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        idempotencyKey: randomUUID(),
        kind: "image",
        modelId: "openai-image",
        instruction: "生成一张白底商品图并保持商品主体不变",
        instructionVersion: "integration-test",
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(generationTaskUnits).values([
        {
          id: ids.successfulUnit,
          taskId: ids.task,
          position: 0,
          groupPosition: 0,
          variantPosition: 0,
          outputLayout: "separate_image",
          instruction: "生成第一张",
          status: "queued",
          createdAt: now,
          updatedAt: now
        },
        {
          id: ids.failedUnit,
          taskId: ids.task,
          position: 1,
          groupPosition: 1,
          variantPosition: 0,
          outputLayout: "separate_image",
          instruction: "生成第二张",
          status: "queued",
          createdAt: now,
          updatedAt: now
        }
      ]);
      await database.db.insert(generationTaskUnitSources).values([
        {
          unitId: ids.successfulUnit,
          assetId: ids.source,
          position: 0,
          sourceRole: "product_source",
          usage: "subject_fact"
        },
        {
          unitId: ids.failedUnit,
          assetId: ids.source,
          position: 0,
          sourceRole: "product_source",
          usage: "subject_fact"
        }
      ]);
      await database.db.insert(generationTaskUnitQualitySources).values([
        { unitId: ids.successfulUnit, assetId: ids.source, position: 0 },
        { unitId: ids.failedUnit, assetId: ids.source, position: 0 }
      ]);
      await database.db.insert(generationUnitSubjectEntities).values([
        {
          id: ids.successfulEntity,
          unitId: ids.successfulUnit,
          entityKey: "cauliflower_chicken",
          label: "菜花鸡",
          position: 0
        },
        {
          id: ids.failedEntity,
          unitId: ids.failedUnit,
          entityKey: "drumstick_chicken",
          label: "鸡腿鸡",
          position: 0
        }
      ]);
      await database.db.insert(generationUnitSubjectEntitySources).values([
        { entityId: ids.successfulEntity, assetId: ids.source, position: 0 },
        { entityId: ids.failedEntity, assetId: ids.source, position: 0 }
      ]);

      await worker.waitUntilReady();
      await Promise.all(
        [ids.successfulUnit, ids.failedUnit].map((unitId) =>
          queue.add(
            IMAGE_GENERATION_UNIT_JOB_NAME,
            { schemaVersion: "2.0", taskId: ids.task, unitId },
            {
              jobId: imageGenerationUnitJobId(ids.task, unitId),
              attempts: 2,
              backoff: { type: "fixed", delay: 1 }
            }
          )
        )
      );
      await waitForStatus(store, ids.task, "succeeded");

      const [output] = await database.db
        .select({ id: mediaAssets.id, storageKey: mediaAssets.storageKey })
        .from(generationTaskOutputs)
        .innerJoin(mediaAssets, eq(generationTaskOutputs.assetId, mediaAssets.id))
        .where(eq(generationTaskOutputs.taskId, ids.task));
      expect(output).toBeDefined();
      expect(output && (await storage.exists(output.storageKey))).toBe(true);
      const unitRows = await database.db
        .select({ id: generationTaskUnits.id, status: generationTaskUnits.status })
        .from(generationTaskUnits)
        .where(eq(generationTaskUnits.taskId, ids.task));
      expect(unitRows).toEqual(
        expect.arrayContaining([
          { id: ids.successfulUnit, status: "succeeded" },
          { id: ids.failedUnit, status: "failed" }
        ])
      );
      const attempts = await database.db
        .select({
          unitId: generationUnitAttempts.unitId,
          status: generationUnitAttempts.status,
          providerRequestId: generationUnitAttempts.providerRequestId,
          failureStage: generationUnitAttempts.failureStage,
          errorDetails: generationUnitAttempts.errorDetails
        })
        .from(generationUnitAttempts)
        .where(inArray(generationUnitAttempts.unitId, [ids.successfulUnit, ids.failedUnit]));
      expect(attempts.filter((attempt) => attempt.unitId === ids.successfulUnit)).toHaveLength(1);
      const failedAttempts = attempts.filter((attempt) => attempt.unitId === ids.failedUnit);
      expect(failedAttempts).toHaveLength(2);
      expect(failedUnitPaidSubmissions).toBe(1);
      expect(failedUnitResumes).toEqual([undefined, `provider-${ids.failedUnit}`]);
      expect(
        failedAttempts.every(
          (attempt) =>
            attempt.providerRequestId === `provider-${ids.failedUnit}` &&
            attempt.failureStage === "polling" &&
            attempt.errorDetails?.stage === "polling" &&
            attempt.errorDetails.retryable === true
        )
      ).toBe(true);
      expect(
        attempts.find((attempt) => attempt.unitId === ids.successfulUnit)?.providerRequestId
      ).toContain("provider-");
      const [check] = await database.db
        .select({
          id: subjectConsistencyChecks.id,
          unitId: subjectConsistencyChecks.generationUnitId
        })
        .from(subjectConsistencyChecks)
        .where(eq(subjectConsistencyChecks.generationUnitId, ids.successfulUnit));
      expect(check?.unitId).toBe(ids.successfulUnit);
      const runCoordinator = new CreationRunCoordinator(database);
      await expect(runCoordinator.finalizeOrphanedRuns()).resolves.toBe(0);
      await database.db
        .update(subjectConsistencyChecks)
        .set({ status: "completed", verdict: "passed", updatedAt: new Date() })
        .where(eq(subjectConsistencyChecks.id, check!.id));
      await expect(runCoordinator.finalizeOrphanedRuns()).resolves.toBe(1);
      const [finalizedRun] = await database.db
        .select({ status: creationRuns.status })
        .from(creationRuns)
        .where(eq(creationRuns.id, ids.task));
      expect(finalizedRun?.status).toBe("terminal");
      const qualitySources = check
        ? await database.db
            .select({ assetId: subjectConsistencyCheckSources.assetId })
            .from(subjectConsistencyCheckSources)
            .where(eq(subjectConsistencyCheckSources.checkId, check.id))
        : [];
      expect(qualitySources).toEqual([{ assetId: ids.source }]);
      const entitySources = await database.db
        .select({
          entityKey: generationUnitSubjectEntities.entityKey,
          assetId: generationUnitSubjectEntitySources.assetId
        })
        .from(generationUnitSubjectEntities)
        .innerJoin(
          generationUnitSubjectEntitySources,
          eq(generationUnitSubjectEntitySources.entityId, generationUnitSubjectEntities.id)
        )
        .where(eq(generationUnitSubjectEntities.unitId, ids.successfulUnit));
      expect(entitySources).toEqual([{ entityKey: "cauliflower_chicken", assetId: ids.source }]);

      await database.db.insert(creationRuns).values({
        id: ids.cancelledTask,
        userId,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(generationTasks).values({
        id: ids.cancelledTask,
        creationRunId: ids.cancelledTask,
        userId,
        projectId: ids.project,
        requirementRunId: ids.requirement,
        idempotencyKey: randomUUID(),
        kind: "image",
        modelId: "openai-image",
        instruction: "等待后取消",
        instructionVersion: "integration-test",
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await database.db.insert(generationTaskUnits).values({
        id: ids.cancelledUnit,
        taskId: ids.cancelledTask,
        position: 0,
        groupPosition: 0,
        variantPosition: 0,
        outputLayout: "separate_image",
        instruction: "等待后取消",
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await queue.add(
        IMAGE_GENERATION_UNIT_JOB_NAME,
        { schemaVersion: "2.0", taskId: ids.cancelledTask, unitId: ids.cancelledUnit },
        {
          jobId: imageGenerationUnitJobId(ids.cancelledTask, ids.cancelledUnit),
          attempts: 2
        }
      );
      await waitForUnitStatus(database, ids.cancelledUnit, "running");
      const cancelledAt = new Date();
      await database.db
        .update(generationTasks)
        .set({ status: "cancelled", updatedAt: cancelledAt })
        .where(eq(generationTasks.id, ids.cancelledTask));
      await database.db
        .update(generationTaskUnits)
        .set({ status: "cancelled", updatedAt: cancelledAt })
        .where(eq(generationTaskUnits.id, ids.cancelledUnit));
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const cancelledOutputs = await database.db
        .select({ assetId: generationTaskOutputs.assetId })
        .from(generationTaskOutputs)
        .where(eq(generationTaskOutputs.taskId, ids.cancelledTask));
      expect(cancelledOutputs).toEqual([]);
    } finally {
      await worker.close(true);
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
      workerConnection.disconnect();
      queueConnection.disconnect();
      await database.db
        .delete(generationTaskOutputs)
        .where(inArray(generationTaskOutputs.taskId, [ids.task, ids.cancelledTask]))
        .catch(() => undefined);
      await database.db
        .delete(generationTasks)
        .where(inArray(generationTasks.id, [ids.task, ids.cancelledTask]))
        .catch(() => undefined);
      await database.db
        .delete(creationRuns)
        .where(inArray(creationRuns.id, [ids.task, ids.cancelledTask]))
        .catch(() => undefined);
      await database.db
        .delete(requirementRuns)
        .where(eq(requirementRuns.id, ids.requirement))
        .catch(() => undefined);
      await database.db
        .delete(mediaAssets)
        .where(eq(mediaAssets.projectId, ids.project))
        .catch(() => undefined);
      await database.db
        .delete(projects)
        .where(eq(projects.id, ids.project))
        .catch(() => undefined);
      await database.close();
      await rm(storageRoot, { recursive: true, force: true });
    }
  }, 15_000);
});

function testDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  const testUrl = environment.TEST_DATABASE_URL?.trim();
  if (!testUrl) throw new Error("TEST_DATABASE_URL 未配置，Worker 集成测试已拒绝运行");
  const developmentUrl = environment.DATABASE_URL?.trim();
  if (developmentUrl && normalizeDatabaseUrl(testUrl) === normalizeDatabaseUrl(developmentUrl)) {
    throw new Error("TEST_DATABASE_URL 不能与 DATABASE_URL 相同");
  }
  const databaseName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ""));
  if (!/(^|[_-])test($|[_-])/.test(databaseName)) {
    throw new Error(`测试数据库名称必须包含独立的 test 标识，当前为 ${databaseName}`);
  }
  return testUrl;
}

function normalizeDatabaseUrl(value: string): string {
  const url = new URL(value);
  url.password = "";
  return url.toString().replace(/\/$/, "");
}

async function waitForStatus(
  store: DrizzleImageGenerationTaskStore,
  taskId: string,
  status: "succeeded" | "failed"
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await store.load(taskId);
    if (task?.status === status) return;
    if (task?.status === "failed") throw new Error("Worker integration task failed");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for task status ${status}`);
}

async function waitForUnitStatus(
  database: ReturnType<typeof createDatabase>,
  unitId: string,
  status: "running"
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [unit] = await database.db
      .select({ status: generationTaskUnits.status })
      .from(generationTaskUnits)
      .where(eq(generationTaskUnits.id, unitId));
    if (unit?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for unit status ${status}`);
}
