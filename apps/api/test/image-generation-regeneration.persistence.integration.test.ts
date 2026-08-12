import { createHash, randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  conversationSessions,
  creationRuns,
  createDatabase,
  generationTaskOutputs,
  generationTaskRegenerations,
  generationTaskUnitQualitySources,
  generationTaskUnits,
  generationTaskUnitSources,
  generationTasks,
  generationUnitSubjectEntities,
  generationUnitSubjectEntitySources,
  mediaAssets,
  productEntities,
  projects,
  requirementRuns,
  subjectConsistencyChecks,
  workflowEvents,
  type DatabaseConnection
} from "@chaoren/database";
import type { RequirementResult, ResolveRequirementRequest } from "@chaoren/contracts";

import { DrizzleImageGenerationTaskRepository } from "../src/image-generations/drizzle-image-generation-task.repository.js";
import {
  ActiveImageGenerationExistsError,
  ImageGenerationIdempotencyConflictError,
  ImageGenerationRegenerationSourceChangedError,
  type ImageGenerationRegenerationRecord
} from "../src/image-generations/image-generation-task.repository.js";
import { databaseTestUrl } from "./database-test-url.js";

const enabled = process.env.RUN_DATABASE_TESTS === "1";

describe.skipIf(!enabled)("Image regeneration PostgreSQL transaction", () => {
  it("persists the complete child graph and exactly one outbox event", async () => {
    const fixture = await createFixture();
    const input = buildInput(fixture);

    try {
      await expect(fixture.repository.createRegenerationOrFind(input)).resolves.toMatchObject({
        created: true,
        record: {
          taskId: input.task.taskId,
          requirementRunId: input.requirementRun.id,
          regeneratedFrom: input.task.regeneratedFrom
        }
      });

      const [childRun] = await fixture.connection.db
        .select()
        .from(requirementRuns)
        .where(eq(requirementRuns.id, input.requirementRun.id));
      expect(childRun).toMatchObject({
        parentRequirementRunId: fixture.ids.requirement,
        sessionId: fixture.ids.session,
        userId: fixture.ids.user,
        projectId: fixture.ids.project
      });
      expect(childRun?.request).toEqual(input.requirementRun.request);
      expect(childRun?.result).toEqual(input.requirementRun.result);
      expect(childRun?.executionPlan).toEqual(input.requirementRun.executionPlan);

      const [runRows, taskRows, unitRows, sourceRows, qualityRows, lineageRows, eventRows] =
        await Promise.all([
          fixture.connection.db
            .select()
            .from(creationRuns)
            .where(eq(creationRuns.id, input.task.taskId)),
          fixture.connection.db
            .select()
            .from(generationTasks)
            .where(eq(generationTasks.id, input.task.taskId)),
          fixture.connection.db
            .select()
            .from(generationTaskUnits)
            .where(eq(generationTaskUnits.taskId, input.task.taskId)),
          fixture.connection.db
            .select()
            .from(generationTaskUnitSources)
            .where(eq(generationTaskUnitSources.unitId, input.task.units[0]!.unitId)),
          fixture.connection.db
            .select()
            .from(generationTaskUnitQualitySources)
            .where(eq(generationTaskUnitQualitySources.unitId, input.task.units[0]!.unitId)),
          fixture.connection.db
            .select()
            .from(generationTaskRegenerations)
            .where(eq(generationTaskRegenerations.taskId, input.task.taskId)),
          fixture.connection.db
            .select()
            .from(workflowEvents)
            .where(eq(workflowEvents.runId, input.task.taskId))
        ]);
      expect(runRows).toHaveLength(1);
      expect(runRows[0]).toMatchObject({ status: "queued" });
      expect(taskRows).toHaveLength(1);
      expect(taskRows[0]).toMatchObject({
        status: "queued",
        idempotencyKey: input.task.idempotencyKey
      });
      expect(unitRows).toHaveLength(1);
      expect(unitRows[0]).toMatchObject({ status: "queued", position: 0 });
      expect(sourceRows).toMatchObject([
        {
          assetId: fixture.ids.productAsset,
          sourceRole: "product_source",
          usage: "edit_target",
          position: 0
        }
      ]);
      expect(qualityRows).toMatchObject([{ assetId: fixture.ids.productAsset, position: 0 }]);
      expect(lineageRows).toMatchObject([
        {
          taskId: input.task.taskId,
          sourceTaskId: fixture.ids.sourceTask,
          sourceUnitId: fixture.ids.sourceUnits[0],
          sourceAssetId: fixture.ids.sourceOutputs[0]
        }
      ]);
      expect(eventRows).toMatchObject([
        {
          sequence: 1,
          eventType: "generation.unit.enqueue",
          entityType: "generation_unit",
          entityId: input.task.units[0]!.unitId,
          payload: { taskId: input.task.taskId, unitId: input.task.units[0]!.unitId },
          publishedAt: null
        }
      ]);

      const entities = await fixture.connection.db
        .select()
        .from(generationUnitSubjectEntities)
        .where(eq(generationUnitSubjectEntities.unitId, input.task.units[0]!.unitId));
      expect(entities).toMatchObject([{ entityKey: "product", label: "商品主体", position: 0 }]);
      const entitySources = await fixture.connection.db
        .select()
        .from(generationUnitSubjectEntitySources)
        .where(eq(generationUnitSubjectEntitySources.entityId, entities[0]!.id));
      expect(entitySources).toMatchObject([{ assetId: fixture.ids.productAsset, position: 0 }]);

      await expect(fixture.repository.findById(input.task.taskId)).resolves.toMatchObject({
        taskId: input.task.taskId,
        lifecycleStatus: "queued",
        regeneratedFrom: input.task.regeneratedFrom,
        units: [
          {
            unitId: input.task.units[0]!.unitId,
            sources: input.task.units[0]!.sources,
            qualitySourceAssetIds: input.task.units[0]!.qualitySourceAssetIds,
            subjectEntities: [
              {
                entityKey: "product",
                label: "商品主体",
                productEntityId: input.task.units[0]!.subjectEntities![0]!.productEntityId,
                lineageKind: "inherited_product_entity",
                inheritedFromAssetId: null,
                sourceAssetIds: [fixture.ids.productAsset]
              }
            ]
          }
        ]
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rolls back every child row when a downstream insert fails", async () => {
    const fixture = await createFixture();
    const input = buildInput(fixture);
    input.task.units[0]!.sources[0]!.assetId = randomUUID();

    try {
      await expect(fixture.repository.createRegenerationOrFind(input)).rejects.toBeDefined();
      await expectChildRows(fixture.connection, input, 0);
      await expect(fixture.repository.findById(fixture.ids.sourceTask)).resolves.toMatchObject({
        taskId: fixture.ids.sourceTask,
        lifecycleStatus: "terminal"
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects an old output after a completed quality check changes the deliverable", async () => {
    const fixture = await createFixture();
    const input = buildInput(fixture);

    try {
      await fixture.connection.db
        .update(generationTaskOutputs)
        .set({ deliverableAssetId: fixture.ids.repairedAsset })
        .where(eq(generationTaskOutputs.unitId, fixture.ids.sourceUnits[0]));
      await fixture.connection.db.insert(subjectConsistencyChecks).values({
        id: randomUUID(),
        userId: fixture.ids.user,
        projectId: fixture.ids.project,
        generationTaskId: fixture.ids.sourceTask,
        generationUnitId: fixture.ids.sourceUnits[0],
        requirementRunId: fixture.ids.requirement,
        generatedAssetId: fixture.ids.sourceOutputs[0],
        deliverableAssetId: fixture.ids.repairedAsset,
        status: "completed",
        phase: "final_inspection",
        verdict: "passed",
        inspectionModel: "integration-test",
        requirementModel: "integration-test",
        workflowVersion: "integration-test"
      });

      await expect(fixture.repository.createRegenerationOrFind(input)).rejects.toBeInstanceOf(
        ImageGenerationRegenerationSourceChangedError
      );
      await expectChildRows(fixture.connection, input, 0);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("converges concurrent same-key same-source requests on one child", async () => {
    const fixture = await createFixture();
    const idempotencyKey = randomUUID();
    const left = buildInput(fixture, { idempotencyKey });
    const right = buildInput(fixture, { idempotencyKey });

    try {
      const results = await Promise.all([
        fixture.repository.createRegenerationOrFind(left),
        fixture.repository.createRegenerationOrFind(right)
      ]);

      expect(results.map((result) => result.created).sort()).toEqual([false, true]);
      expect(new Set(results.map((result) => result.record.taskId))).toHaveProperty("size", 1);
      const winnerTaskId = results[0]!.record.taskId;
      const winnerRequirementRunId = results[0]!.record.requirementRunId;
      expect([left.task.taskId, right.task.taskId]).toContain(winnerTaskId);
      expect([left.requirementRun.id, right.requirementRun.id]).toContain(winnerRequirementRunId);
      await expectConcurrentRows(fixture, [left, right], winnerTaskId, winnerRequirementRunId);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects concurrent same-key requests that target different sources", async () => {
    const fixture = await createFixture();
    const idempotencyKey = randomUUID();
    const left = buildInput(fixture, { idempotencyKey, sourcePosition: 0 });
    const right = buildInput(fixture, { idempotencyKey, sourcePosition: 1 });

    try {
      const results = await Promise.allSettled([
        fixture.repository.createRegenerationOrFind(left),
        fixture.repository.createRegenerationOrFind(right)
      ]);
      const fulfilled = results.find((result) => result.status === "fulfilled");
      const rejected = results.find((result) => result.status === "rejected");

      expect(fulfilled).toMatchObject({ status: "fulfilled", value: { created: true } });
      expect(rejected).toMatchObject({ status: "rejected" });
      if (rejected?.status === "rejected") {
        expect(rejected.reason).toBeInstanceOf(ImageGenerationIdempotencyConflictError);
      }
      if (fulfilled?.status !== "fulfilled") throw new Error("并发幂等测试缺少成功请求");
      const winner = fulfilled.value.record;
      const expectedInput = winner.taskId === left.task.taskId ? left : right;
      expect(winner.regeneratedFrom).toEqual(expectedInput.task.regeneratedFrom);
      await expectConcurrentRows(fixture, [left, right], winner.taskId, winner.requirementRunId);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("allows only one concurrent active child for different keys in one session", async () => {
    const fixture = await createFixture();
    const left = buildInput(fixture);
    const right = buildInput(fixture);

    try {
      const results = await Promise.allSettled([
        fixture.repository.createRegenerationOrFind(left),
        fixture.repository.createRegenerationOrFind(right)
      ]);
      const fulfilled = results.find((result) => result.status === "fulfilled");
      const rejected = results.find((result) => result.status === "rejected");

      expect(fulfilled).toMatchObject({ status: "fulfilled", value: { created: true } });
      if (rejected?.status === "rejected") {
        expect(rejected.reason).toBeInstanceOf(ActiveImageGenerationExistsError);
      } else {
        throw new Error("同会话并发测试缺少活跃任务冲突");
      }
      if (fulfilled?.status !== "fulfilled") throw new Error("同会话并发测试缺少成功请求");
      await expectConcurrentRows(
        fixture,
        [left, right],
        fulfilled.value.record.taskId,
        fulfilled.value.record.requirementRunId
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps direct lineage after a second regeneration and survives reconnect", async () => {
    const fixture = await createFixture();
    const first = buildInput(fixture);
    let activeConnection = fixture.connection;

    try {
      const firstStored = await fixture.repository.createRegenerationOrFind(first);
      const firstUnitId = first.task.units[0]!.unitId;
      const nextAssetId = randomUUID();
      fixture.ids.assets.push(nextAssetId);
      await activeConnection.db
        .insert(mediaAssets)
        .values(mediaAssetRow(fixture, nextAssetId, "first-regeneration.png", "generated"));
      await activeConnection.db
        .update(creationRuns)
        .set({ status: "terminal", updatedAt: new Date() })
        .where(eq(creationRuns.id, first.task.taskId));
      await activeConnection.db
        .update(generationTasks)
        .set({ status: "succeeded", updatedAt: new Date() })
        .where(eq(generationTasks.id, first.task.taskId));
      await activeConnection.db
        .update(generationTaskUnits)
        .set({ status: "succeeded", updatedAt: new Date() })
        .where(eq(generationTaskUnits.id, firstUnitId));
      await activeConnection.db.insert(generationTaskOutputs).values({
        taskId: first.task.taskId,
        unitId: firstUnitId,
        assetId: nextAssetId,
        position: 0,
        status: "deliverable",
        deliverableAssetId: nextAssetId
      });

      const second = buildInput(fixture, {
        source: {
          taskId: first.task.taskId,
          unitId: firstUnitId,
          assetId: nextAssetId,
          requirementRunId: first.requirementRun.id
        }
      });
      await fixture.repository.createRegenerationOrFind(second);

      await activeConnection.close();
      activeConnection = createDatabase(fixture.databaseUrl);
      fixture.connection = activeConnection;
      fixture.repository = new DrizzleImageGenerationTaskRepository(activeConnection);

      await expect(fixture.repository.findById(firstStored.record.taskId)).resolves.toMatchObject({
        regeneratedFrom: {
          taskId: fixture.ids.sourceTask,
          unitId: fixture.ids.sourceUnits[0],
          assetId: fixture.ids.sourceOutputs[0]
        }
      });
      await expect(fixture.repository.findById(second.task.taskId)).resolves.toMatchObject({
        requirementRunId: second.requirementRun.id,
        regeneratedFrom: {
          taskId: first.task.taskId,
          unitId: firstUnitId,
          assetId: nextAssetId
        },
        units: [{ sources: second.task.units[0]!.sources }]
      });
      const lineages = await activeConnection.db
        .select()
        .from(generationTaskRegenerations)
        .where(
          inArray(generationTaskRegenerations.taskId, [first.task.taskId, second.task.taskId])
        );
      expect(lineages).toHaveLength(2);
    } finally {
      fixture.connection = activeConnection;
      await cleanupFixture(fixture);
    }
  });
});

type Fixture = {
  databaseUrl: string;
  connection: DatabaseConnection;
  repository: DrizzleImageGenerationTaskRepository;
  ids: {
    user: string;
    project: string;
    session: string;
    requirement: string;
    sourceTask: string;
    sourceUnits: [string, string];
    productAsset: string;
    sourceOutputs: [string, string];
    repairedAsset: string;
    assets: string[];
    childTasks: string[];
    childUnits: string[];
    childRequirements: string[];
  };
};

async function createFixture(): Promise<Fixture> {
  const databaseUrl = await databaseTestUrl();
  const connection = createDatabase(databaseUrl);
  const ids = {
    user: randomUUID(),
    project: randomUUID(),
    session: randomUUID(),
    requirement: randomUUID(),
    sourceTask: randomUUID(),
    sourceUnits: [randomUUID(), randomUUID()] as [string, string],
    productAsset: randomUUID(),
    sourceOutputs: [randomUUID(), randomUUID()] as [string, string],
    repairedAsset: randomUUID(),
    assets: [] as string[],
    childTasks: [] as string[],
    childUnits: [] as string[],
    childRequirements: [] as string[]
  };
  ids.assets.push(ids.productAsset, ...ids.sourceOutputs, ids.repairedAsset);
  const fixture: Fixture = {
    databaseUrl,
    connection,
    repository: new DrizzleImageGenerationTaskRepository(connection),
    ids
  };
  const now = new Date("2026-08-11T02:00:00.000Z");

  try {
    await connection.db.insert(projects).values({
      id: ids.project,
      ownerUserId: ids.user,
      name: "再次生成事务测试",
      createdAt: now,
      updatedAt: now
    });
    await connection.db.insert(conversationSessions).values({
      id: ids.session,
      userId: ids.user,
      projectId: ids.project,
      title: "再次生成事务测试",
      mode: "image",
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now
    });
    await connection.db
      .insert(mediaAssets)
      .values([
        mediaAssetRow(fixture, ids.productAsset, "product.png", "uploaded"),
        mediaAssetRow(fixture, ids.sourceOutputs[0], "output-1.png", "generated"),
        mediaAssetRow(fixture, ids.sourceOutputs[1], "output-2.png", "generated"),
        mediaAssetRow(fixture, ids.repairedAsset, "repaired.png", "generated")
      ]);
    await connection.db.insert(requirementRuns).values({
      id: ids.requirement,
      parentRequirementRunId: null,
      userId: ids.user,
      projectId: ids.project,
      sessionId: ids.session,
      request: sourceRequest(ids.project, ids.productAsset),
      result: sourceResult(),
      aiModel: "integration-test",
      promptVersion: "integration-test",
      createdAt: now
    });
    await connection.db.insert(creationRuns).values({
      id: ids.sourceTask,
      userId: ids.user,
      projectId: ids.project,
      sessionId: ids.session,
      requirementRunId: ids.requirement,
      status: "terminal",
      createdAt: now,
      updatedAt: now
    });
    await connection.db.insert(generationTasks).values({
      id: ids.sourceTask,
      creationRunId: ids.sourceTask,
      userId: ids.user,
      projectId: ids.project,
      requirementRunId: ids.requirement,
      sessionId: ids.session,
      idempotencyKey: randomUUID(),
      kind: "image",
      modelId: "openai-image",
      instruction: "来源任务",
      instructionVersion: "image-instruction-v3",
      status: "succeeded",
      createdAt: now,
      updatedAt: now
    });
    await connection.db.insert(generationTaskUnits).values(
      ids.sourceUnits.map((id, position) => ({
        id,
        taskId: ids.sourceTask,
        position,
        groupPosition: position,
        variantPosition: 0,
        outputLayout: "separate_image",
        instruction: `来源单元 ${position + 1}`,
        status: "succeeded" as const,
        createdAt: now,
        updatedAt: now
      }))
    );
    await connection.db.insert(generationTaskOutputs).values(
      ids.sourceUnits.map((unitId, position) => ({
        taskId: ids.sourceTask,
        unitId,
        assetId: ids.sourceOutputs[position]!,
        position,
        status: "deliverable" as const,
        deliverableAssetId: ids.sourceOutputs[position]!
      }))
    );
    return fixture;
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

function buildInput(
  fixture: Fixture,
  options?: {
    idempotencyKey?: string;
    sourcePosition?: 0 | 1;
    source?: { taskId: string; unitId: string; assetId: string; requirementRunId: string };
  }
): ImageGenerationRegenerationRecord {
  const sourcePosition = options?.sourcePosition ?? 0;
  const source =
    options?.source ??
    ({
      taskId: fixture.ids.sourceTask,
      unitId: fixture.ids.sourceUnits[sourcePosition],
      assetId: fixture.ids.sourceOutputs[sourcePosition],
      requirementRunId: fixture.ids.requirement
    } satisfies NonNullable<ImageGenerationRegenerationRecord["task"]["regeneratedFrom"]> & {
      requirementRunId: string;
    });
  const requirementRunId = randomUUID();
  const taskId = randomUUID();
  const unitId = randomUUID();
  fixture.ids.childRequirements.push(requirementRunId);
  fixture.ids.childTasks.push(taskId);
  fixture.ids.childUnits.push(unitId);
  const request = childRequest(fixture.ids.project, fixture.ids.productAsset);
  const result = childResult();
  const executionPlan = {
    schemaVersion: "1.0" as const,
    summary: `再次生成来源执行单元 ${source.unitId}`,
    groups: [
      {
        sourceImages: [
          {
            assetId: fixture.ids.productAsset,
            sourceRole: "product_source" as const,
            usage: "edit_target" as const,
            position: 0
          }
        ],
        subjectEntities: [
          {
            entityKey: "product",
            label: "商品主体",
            productEntityId: randomUUID(),
            lineageKind: "new_product_source" as const,
            sourceAssetIds: [fixture.ids.productAsset]
          }
        ],
        outputCount: 1,
        outputLayout: "separate_image" as const,
        instruction: "保持商品主体并生成新构图"
      }
    ]
  };
  const now = new Date().toISOString();
  return {
    requirementRun: {
      id: requirementRunId,
      parentRequirementRunId: source.requirementRunId,
      sessionId: fixture.ids.session,
      sourceMessageId: null,
      stateSnapshotId: null,
      userId: fixture.ids.user,
      request,
      result,
      executionPlan,
      executionPlanHash: createHash("sha256").update(JSON.stringify(executionPlan)).digest("hex"),
      aiModel: "integration-test",
      promptVersion: "integration-test",
      createdAt: now
    },
    task: {
      taskId,
      userId: fixture.ids.user,
      requirementRunId,
      sessionId: fixture.ids.session,
      stateSnapshotId: null,
      idempotencyKey: options?.idempotencyKey ?? randomUUID(),
      projectId: fixture.ids.project,
      modelId: "openai-image",
      instruction: "保持商品主体并生成新构图",
      instructionVersion: "image-instruction-v3",
      status: "queued",
      resultAssets: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      regeneratedFrom: {
        taskId: source.taskId,
        unitId: source.unitId,
        assetId: source.assetId
      },
      units: [
        {
          unitId,
          position: 0,
          groupPosition: 0,
          variantPosition: 0,
          outputLayout: "separate_image",
          instruction: "保持商品主体并生成新构图",
          sources: executionPlan.groups[0]!.sourceImages,
          qualitySourceAssetIds: [fixture.ids.productAsset],
          subjectEntities: executionPlan.groups[0]!.subjectEntities
        }
      ]
    }
  };
}

async function expectChildRows(
  connection: DatabaseConnection,
  input: ImageGenerationRegenerationRecord,
  expectedCount: number
) {
  const rows = await Promise.all([
    connection.db
      .select({ id: requirementRuns.id })
      .from(requirementRuns)
      .where(eq(requirementRuns.id, input.requirementRun.id)),
    connection.db
      .select({ id: creationRuns.id })
      .from(creationRuns)
      .where(eq(creationRuns.id, input.task.taskId)),
    connection.db
      .select({ id: generationTasks.id })
      .from(generationTasks)
      .where(eq(generationTasks.id, input.task.taskId)),
    connection.db
      .select({ id: workflowEvents.id })
      .from(workflowEvents)
      .where(eq(workflowEvents.runId, input.task.taskId))
  ]);
  expect(rows.map((result) => result.length)).toEqual([
    expectedCount,
    expectedCount,
    expectedCount,
    expectedCount
  ]);
}

async function expectConcurrentRows(
  fixture: Fixture,
  inputs: ImageGenerationRegenerationRecord[],
  winnerTaskId: string,
  winnerRequirementRunId: string
) {
  const taskIds = inputs.map((input) => input.task.taskId);
  const requirementRunIds = inputs.map((input) => input.requirementRun.id);
  const [tasks, runs, events] = await Promise.all([
    fixture.connection.db
      .select({ id: generationTasks.id })
      .from(generationTasks)
      .where(inArray(generationTasks.id, taskIds)),
    fixture.connection.db
      .select({ id: requirementRuns.id })
      .from(requirementRuns)
      .where(inArray(requirementRuns.id, requirementRunIds)),
    fixture.connection.db
      .select()
      .from(workflowEvents)
      .where(inArray(workflowEvents.runId, taskIds))
  ]);
  expect(tasks).toEqual([{ id: winnerTaskId }]);
  expect(runs).toEqual([{ id: winnerRequirementRunId }]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ runId: winnerTaskId, eventType: "generation.unit.enqueue" });
}

function sourceRequest(projectId: string, productAssetId: string): ResolveRequirementRequest {
  return {
    projectId,
    modelId: "openai-image",
    userText: "生成两张商品主图",
    imageSettings: { imageCount: 2, aspectRatio: "1:1", generationGoal: "商品主图" },
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

function childRequest(projectId: string, productAssetId: string): ResolveRequirementRequest {
  return {
    ...sourceRequest(projectId, productAssetId),
    imageSettings: {
      ...sourceRequest(projectId, productAssetId).imageSettings,
      imageCount: 1
    }
  };
}

function sourceResult(): RequirementResult {
  return {
    schemaVersion: "1.0",
    status: "ready",
    finalRequirement: {
      imageCount: 2,
      aspectRatio: "1:1",
      intent: "生成两张商品主图",
      scene: "桌面陈列",
      background: "白色",
      composition: null,
      lighting: null,
      style: null,
      mustKeep: ["保持商品主体"],
      mustAvoid: [],
      subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
    },
    conflictDecisions: []
  };
}

function childResult(): RequirementResult {
  const source = sourceResult();
  if (source.status !== "ready") throw new Error("测试需求必须已就绪");
  return {
    ...source,
    finalRequirement: { ...source.finalRequirement, imageCount: 1 }
  };
}

function mediaAssetRow(
  fixture: Fixture,
  id: string,
  fileName: string,
  origin: "uploaded" | "generated"
) {
  return {
    id,
    userId: fixture.ids.user,
    projectId: fixture.ids.project,
    kind: "image" as const,
    origin,
    contentSha256: null,
    storageKey: `integration/${fixture.ids.project}/${id}.png`,
    mimeType: "image/png",
    byteSize: 128,
    originalFileName: fileName,
    createdAt: new Date("2026-08-11T02:00:00.000Z")
  };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const taskIds = [fixture.ids.sourceTask, ...fixture.ids.childTasks];
  const requirementRunIds = [fixture.ids.requirement, ...fixture.ids.childRequirements];
  try {
    await fixture.connection.db
      .delete(generationTaskRegenerations)
      .where(inArray(generationTaskRegenerations.taskId, taskIds));
    await fixture.connection.db.delete(generationTasks).where(inArray(generationTasks.id, taskIds));
    await fixture.connection.db.delete(creationRuns).where(inArray(creationRuns.id, taskIds));
    await fixture.connection.db
      .delete(requirementRuns)
      .where(inArray(requirementRuns.id, requirementRunIds));
    await fixture.connection.db
      .delete(productEntities)
      .where(eq(productEntities.projectId, fixture.ids.project));
    await fixture.connection.db
      .delete(mediaAssets)
      .where(inArray(mediaAssets.id, fixture.ids.assets));
    await fixture.connection.db
      .delete(conversationSessions)
      .where(eq(conversationSessions.id, fixture.ids.session));
    await fixture.connection.db.delete(projects).where(eq(projects.id, fixture.ids.project));
  } finally {
    await fixture.connection.close();
  }
}
