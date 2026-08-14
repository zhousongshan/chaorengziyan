import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import {
  environmentSchema,
  type MediaAsset,
  type ResolvedGenerationPlan,
  type RequirementResult,
  type ResolveRequirementRequest
} from "@chaoren/contracts";

import type { AuthorizationPort } from "../src/authorization/authorization.port.js";
import type { ImageGenerationQueue } from "../src/image-generations/image-generation-queue.port.js";
import { ImageGenerationService } from "../src/image-generations/image-generation.service.js";
import type { ImageGenerationTaskRecord } from "../src/image-generations/image-generation-task.repository.js";
import { InMemoryImageGenerationTaskRepository } from "../src/image-generations/in-memory-image-generation-task.repository.js";
import { ImageModelCatalog } from "../src/image-models/image-model.catalog.js";
import { InMemoryMediaAssetRepository } from "../src/media-assets/in-memory-media-asset.repository.js";
import { InMemoryAssetLibraryRepository } from "../src/media-assets/in-memory-asset-library.repository.js";
import { MediaAssetService } from "../src/media-assets/media-asset.service.js";
import type { ProjectService } from "../src/projects/project.service.js";
import { InMemoryRequirementRunRepository } from "../src/requirements/in-memory-requirement-run.repository.js";

const userId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000010";
const requirementRunId = "00000000-0000-4000-8000-000000000020";
const idempotencyKey = "00000000-0000-4000-8000-000000000021";
const productImageId = "00000000-0000-4000-8000-000000000011";
const referenceImageId = "00000000-0000-4000-8000-000000000012";
const sessionId = "00000000-0000-4000-8000-000000000030";
const sourceMessageId = "00000000-0000-4000-8000-000000000031";
const stateSnapshotId = "00000000-0000-4000-8000-000000000032";
const sourceTaskId = "00000000-0000-4000-8000-000000000040";
const sourceUnitId = "00000000-0000-4000-8000-000000000041";
const sourceAssetId = "00000000-0000-4000-8000-000000000042";
const regenerationIdempotencyKey = "00000000-0000-4000-8000-000000000043";
const productEntityId = "00000000-0000-4000-8000-000000000044";

const referenceAnalysis = {
  assetId: referenceImageId,
  observedDesign: {
    sellingPointPresentation: "左侧卖点模块配合商品展示",
    composition: "信息左置、商品右置",
    informationHierarchy: "品牌、标题和辅助卖点分三级",
    typography: "粗体标题搭配圆角标签",
    colorAndLighting: "绿色主色与柔和棚拍光",
    spacingAndRhythm: "左右分区并保留充足边距",
    propsAndScene: "桌面道具形成前后层次"
  },
  transferPlan: {
    adopt: ["采用左右分栏和三级信息层级"],
    adapt: ["把参考商品特写改为当前商品可见细节"],
    avoid: ["不复制参考商品、品牌和原文案"],
    userPriority: []
  }
};

const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379",
  LOCAL_USER_ID: userId,
  MAX_IMAGE_COUNT: 4,
  ALLOWED_ASPECT_RATIOS: "1:1,3:4,9:16"
});

const request: ResolveRequirementRequest = {
  projectId,
  modelId: "openai-image",
  userText: "生成一张干净的电商主图",
  imageSettings: { imageCount: 1, aspectRatio: "1:1", generationGoal: "商品主图" },
  renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
  deliverySettings: {
    outputFormat: "png",
    watermark: { enabled: false, assetId: null, position: "bottom_right" }
  },
  agentInstruction: "",
  productImageIds: [productImageId],
  referenceImageIds: [referenceImageId],
  editBaseImageId: null,
  referenceGuidance: []
};

const readyResult: RequirementResult = {
  schemaVersion: "1.0",
  status: "ready",
  finalRequirement: {
    imageCount: 1,
    aspectRatio: "1:1",
    intent: "生成一张干净的电商主图",
    scene: "桌面陈列",
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

class FakeQueue implements ImageGenerationQueue {
  public readonly unitJobs: Array<{ taskId: string; unitId: string }> = [];
  public shouldFail = false;
  public readonly cancellations: Array<{ taskId: string; unitIds: string[] }> = [];

  public enqueueUnit(taskId: string, unitId: string): Promise<void> {
    if (this.shouldFail) return Promise.reject(new Error("queue unavailable"));
    this.unitJobs.push({ taskId, unitId });
    return Promise.resolve();
  }

  public cancel(taskId: string, unitIds: string[]): Promise<void> {
    this.cancellations.push({ taskId, unitIds });
    return Promise.resolve();
  }
}

async function createSubject(options?: {
  result?: RequirementResult;
  executionPlan?: ResolvedGenerationPlan;
  includeAssets?: boolean;
  request?: ResolveRequirementRequest;
}) {
  const authorization: AuthorizationPort = { assertAccess: vi.fn(() => Promise.resolve()) };
  const assetRepository = new InMemoryMediaAssetRepository();
  const projects = {
    assertOwned: vi.fn(() => Promise.resolve({ id: projectId }))
  } as unknown as ProjectService;
  const storage = {
    put: vi.fn(),
    read: vi.fn(),
    exists: vi.fn(),
    delete: vi.fn()
  };
  const mediaAssets = new MediaAssetService(
    environment,
    authorization,
    storage,
    assetRepository,
    new InMemoryAssetLibraryRepository(),
    projects
  );
  const requirementRuns = new InMemoryRequirementRunRepository();
  await requirementRuns.save({
    id: requirementRunId,
    parentRequirementRunId: null,
    userId,
    sessionId,
    sourceMessageId,
    stateSnapshotId,
    request: options?.request ?? request,
    result: options?.result ?? readyResult,
    executionPlan: options?.executionPlan ?? currentExecutionPlan(),
    aiModel: "test",
    promptVersion: "test",
    createdAt: new Date().toISOString()
  });
  if (options?.includeAssets !== false) {
    await saveSource(assetRepository, productImageId);
    await saveSource(assetRepository, referenceImageId);
  }

  const queue = new FakeQueue();
  const tasks = new InMemoryImageGenerationTaskRepository(requirementRuns);
  const service = new ImageGenerationService(
    environment,
    authorization,
    requirementRuns,
    queue,
    tasks,
    new ImageModelCatalog(environment),
    mediaAssets
  );
  return { service, queue, tasks, requirementRuns, assetRepository };
}

function currentExecutionPlan(outputCount = 1): ResolvedGenerationPlan {
  return {
    schemaVersion: "3.0",
    summary: "商品图结合参考海报生成",
    groups: [
      {
        sourceImages: [
          {
            assetId: productImageId,
            sourceRole: "product_source",
            usage: "subject_fact",
            position: 0
          },
          {
            assetId: referenceImageId,
            sourceRole: "user_reference",
            usage: "style_reference",
            position: 1
          }
        ],
        subjectEntities: [
          {
            entityKey: "product",
            label: "商品",
            productEntityId,
            lineageKind: "new_product_source",
            inheritedFromAssetId: null,
            sourceAssetIds: [productImageId]
          }
        ],
        subjectPolicy: { defaultAction: "preserve", allowedChanges: [] },
        referenceAnalyses: [referenceAnalysis],
        outputCount,
        outputLayout: "separate_image",
        instruction: "保持当前商品事实，迁移参考海报的左右分栏和信息层级"
      }
    ]
  };
}

describe("ImageGenerationService", () => {
  it("cancels queued units and removes their queue jobs", async () => {
    const { service, queue } = await createSubject();
    const created = await service.create({ requirementRunId, idempotencyKey });

    await expect(service.cancel(created.taskId)).resolves.toMatchObject({
      taskId: created.taskId,
      status: "cancelled",
      providerCancellationStatus: "not_required"
    });
    expect(queue.cancellations).toEqual([
      { taskId: created.taskId, unitIds: [expect.any(String) as string] }
    ]);
    await expect(service.findById(created.taskId)).resolves.toMatchObject({
      status: "cancelled",
      workflowStatus: "cancelled"
    });
  });

  it("persists a queued task and enqueues its independent output unit", async () => {
    const { service, queue, tasks } = await createSubject();
    const created = await service.create({ requirementRunId, idempotencyKey });

    expect(created.status).toBe("queued");
    expect(queue.unitJobs).toEqual([
      { taskId: created.taskId, unitId: expect.any(String) as string }
    ]);
    await expect(tasks.findById(created.taskId)).resolves.toMatchObject({
      idempotencyKey,
      instruction: "本任务只允许按已冻结的执行单元指令执行。",
      instructionVersion: "image-instruction-v6"
    });
    await expect(tasks.findById(created.taskId)).resolves.toMatchObject({
      units: [
        {
          qualitySourceAssetIds: [productImageId],
          instruction: expect.stringContaining("本执行单元的商品事实图")
        }
      ]
    });
    await expect(service.findById(created.taskId)).resolves.toMatchObject({
      taskId: created.taskId,
      requirementRunId,
      modelId: "openai-image",
      status: "queued",
      outputs: [{ position: 0, groupPosition: 0, variantPosition: 0 }]
    });
  });

  it("re-enqueues recoverable tasks when the API starts", async () => {
    const { service, queue } = await createSubject();
    const created = await service.create({ requirementRunId, idempotencyKey });
    queue.unitJobs.length = 0;

    await service.onModuleInit();

    expect(queue.unitJobs).toEqual([
      { taskId: created.taskId, unitId: expect.any(String) as string }
    ]);
  });

  it("keeps the API available when recovery cannot reach Redis", async () => {
    const { service, queue } = await createSubject();
    await service.create({ requirementRunId, idempotencyKey });
    queue.shouldFail = true;

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it("lists only the current user's tasks for one conversation", async () => {
    const { service } = await createSubject();
    const created = await service.create({ requirementRunId, idempotencyKey });

    await expect(
      service.listBySessionId({ sessionId, requirementRunIds: requirementRunId })
    ).resolves.toMatchObject({
      tasks: [{ taskId: created.taskId, requirementRunId, status: "queued" }]
    });
  });

  it("treats a completed quality repair generation as terminal without a second check", async () => {
    const { service, tasks, requirementRuns } = await createSubject();
    const repairRequirementRunId = "00000000-0000-4000-8000-000000000022";
    const repairTaskId = "00000000-0000-4000-8000-000000000023";
    const repairUnitId = "00000000-0000-4000-8000-000000000024";
    const outputAsset: MediaAsset = {
      id: "00000000-0000-4000-8000-000000000025",
      projectId,
      kind: "image",
      storageKey: "generated/repair.png",
      mimeType: "image/png",
      byteSize: 20,
      createdAt: new Date().toISOString()
    };
    await requirementRuns.save({
      id: repairRequirementRunId,
      parentRequirementRunId: requirementRunId,
      userId,
      sessionId,
      request,
      result: readyResult,
      aiModel: "test",
      promptVersion: "test",
      createdAt: new Date().toISOString()
    });
    await tasks.createOrFind({
      taskId: repairTaskId,
      userId,
      requirementRunId: repairRequirementRunId,
      sessionId,
      idempotencyKey: repairTaskId,
      projectId,
      modelId: "openai-image",
      instruction: "质检修复生成",
      instructionVersion: "test",
      status: "succeeded",
      resultAssets: [outputAsset],
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      units: [
        {
          unitId: repairUnitId,
          position: 0,
          groupPosition: 0,
          variantPosition: 0,
          outputLayout: "separate_image",
          instruction: "质检修复生成",
          status: "succeeded",
          qualitySourceAssetIds: [productImageId],
          subjectEntities: [],
          sources: [],
          generatedAsset: outputAsset,
          deliverableAsset: outputAsset,
          subjectConsistencyStatus: null,
          subjectConsistencyPhase: null,
          error: null
        }
      ]
    });

    await expect(service.findById(repairTaskId)).resolves.toMatchObject({
      status: "succeeded",
      workflowStatus: "succeeded",
      subjectConsistencyRequired: false,
      succeededOutputCount: 1
    });
  });

  it("marks the task failed when Redis cannot accept the job", async () => {
    const { service, queue, tasks } = await createSubject();
    queue.shouldFail = true;

    await expect(service.create({ requirementRunId, idempotencyKey })).rejects.toMatchObject({
      status: 503
    });
    expect(await tasks.findRecoverableUnits()).toEqual([]);
  });

  it("does not create a task while the requirement needs clarification", async () => {
    const { service } = await createSubject({
      result: {
        schemaVersion: "1.0",
        status: "needs_clarification",
        questions: ["需要什么比例？"],
        conflictDecisions: []
      }
    });

    await expect(service.create({ requirementRunId, idempotencyKey })).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it("rejects missing source assets before creating a task", async () => {
    const { service, queue } = await createSubject({ includeAssets: false });

    await expect(service.create({ requirementRunId, idempotencyKey })).rejects.toMatchObject({
      status: 400
    });
    expect(queue.unitJobs).toEqual([]);
  });

  it("returns the same task without enqueueing twice for one idempotency key", async () => {
    const { service, queue } = await createSubject();

    const first = await service.create({ requirementRunId, idempotencyKey });
    const repeated = await service.create({ requirementRunId, idempotencyKey });

    expect(repeated).toEqual(first);
    expect(queue.unitJobs).toHaveLength(1);
    expect(queue.unitJobs[0]?.taskId).toBe(first.taskId);
  });

  it("creates one exact child requirement and one output from the clicked result", async () => {
    const { service, queue, tasks, requirementRuns, sourceRequest, sourceResult, sourceUnit } =
      await createRegenerationSubject();

    const regenerated = await service.regenerateOutput(sourceTaskId, sourceUnitId, {
      idempotencyKey: regenerationIdempotencyKey,
      sourceAssetId
    });

    expect(regenerated).toMatchObject({
      status: "queued",
      regeneratedFrom: { taskId: sourceTaskId, unitId: sourceUnitId, assetId: sourceAssetId }
    });
    expect(queue.unitJobs).toEqual([
      { taskId: regenerated.taskId, unitId: expect.any(String) as string }
    ]);

    const childRun = await requirementRuns.findById(regenerated.requirementRunId);
    expect(childRun).toMatchObject({
      parentRequirementRunId: requirementRunId,
      sessionId,
      sourceMessageId,
      stateSnapshotId,
      userId,
      request: {
        ...sourceRequest,
        imageSettings: { ...sourceRequest.imageSettings, imageCount: 1 }
      },
      result: {
        status: "ready",
        finalRequirement: { ...sourceResult.finalRequirement, imageCount: 1 }
      }
    });
    expect(childRun?.executionPlan).toEqual({
      schemaVersion: "3.0",
      summary: `再次生成来源执行单元 ${sourceUnitId}`,
      groups: [
        {
          sourceImages: sourceUnit.sources,
          subjectPolicy: { defaultAction: "preserve", allowedChanges: [] },
          referenceAnalyses: [referenceAnalysis],
          subjectEntities: sourceUnit.subjectEntities.map((entity) => ({
            ...entity,
            lineageKind: "inherited_product_entity",
            inheritedFromAssetId: sourceAssetId
          })),
          outputCount: 1,
          outputLayout: sourceUnit.outputLayout,
          instruction: sourceUnit.instruction
        }
      ]
    });
    expect(childRun?.executionPlanHash).toMatch(/^[a-f0-9]{64}$/);

    await expect(tasks.findById(regenerated.taskId)).resolves.toMatchObject({
      requirementRunId: regenerated.requirementRunId,
      sessionId,
      stateSnapshotId,
      idempotencyKey: regenerationIdempotencyKey,
      status: "queued",
      regeneratedFrom: { taskId: sourceTaskId, unitId: sourceUnitId, assetId: sourceAssetId },
      units: [
        {
          position: 0,
          groupPosition: 0,
          variantPosition: 0,
          sources: sourceUnit.sources,
          qualitySourceAssetIds: sourceUnit.qualitySourceAssetIds,
          subjectEntities: sourceUnit.subjectEntities.map((entity) => ({
            ...entity,
            lineageKind: "inherited_product_entity",
            inheritedFromAssetId: sourceAssetId
          }))
        }
      ]
    });
  });

  it("replays the same regeneration key and source without creating or enqueueing twice", async () => {
    const { service, queue, requirementRuns } = await createRegenerationSubject();
    const saveChildRequirement = vi.spyOn(requirementRuns, "save");

    const first = await service.regenerateOutput(sourceTaskId, sourceUnitId, {
      idempotencyKey: regenerationIdempotencyKey,
      sourceAssetId
    });
    const replayed = await service.regenerateOutput(sourceTaskId, sourceUnitId, {
      idempotencyKey: regenerationIdempotencyKey,
      sourceAssetId
    });

    expect(replayed).toEqual(first);
    expect(saveChildRequirement).toHaveBeenCalledTimes(1);
    expect(queue.unitJobs).toHaveLength(1);
  });

  it("rejects one regeneration key reused for a different source triple", async () => {
    const { service, queue } = await createRegenerationSubject();
    await service.regenerateOutput(sourceTaskId, sourceUnitId, {
      idempotencyKey: regenerationIdempotencyKey,
      sourceAssetId
    });

    await expect(
      service.regenerateOutput(sourceTaskId, sourceUnitId, {
        idempotencyKey: regenerationIdempotencyKey,
        sourceAssetId: productImageId
      })
    ).rejects.toMatchObject({
      response: { code: "IMAGE_GENERATION_IDEMPOTENCY_CONFLICT" }
    });
    expect(queue.unitJobs).toHaveLength(1);
  });

  it("rejects a clicked asset that is no longer the unit deliverable", async () => {
    const { service, queue } = await createRegenerationSubject();

    await expect(
      service.regenerateOutput(sourceTaskId, sourceUnitId, {
        idempotencyKey: regenerationIdempotencyKey,
        sourceAssetId: productImageId
      })
    ).rejects.toMatchObject({ response: { code: "IMAGE_GENERATION_OUTPUT_CHANGED" } });
    expect(queue.unitJobs).toEqual([]);
  });

  it("rejects a missing source unit", async () => {
    const { service, queue } = await createRegenerationSubject();

    await expect(
      service.regenerateOutput(sourceTaskId, crypto.randomUUID(), {
        idempotencyKey: regenerationIdempotencyKey,
        sourceAssetId
      })
    ).rejects.toMatchObject({ response: { code: "IMAGE_GENERATION_OUTPUT_NOT_FOUND" } });
    expect(queue.unitJobs).toEqual([]);
  });

  it("rejects a source task or unit that has not completed", async () => {
    const { service, queue } = await createRegenerationSubject({
      lifecycleStatus: "running",
      unitStatus: "running"
    });

    await expect(
      service.regenerateOutput(sourceTaskId, sourceUnitId, {
        idempotencyKey: regenerationIdempotencyKey,
        sourceAssetId
      })
    ).rejects.toMatchObject({ response: { code: "IMAGE_GENERATION_OUTPUT_NOT_READY" } });
    expect(queue.unitJobs).toEqual([]);
  });

  it("rejects regeneration while the conversation has another active task", async () => {
    const { service, queue, tasks, requirementRuns } = await createRegenerationSubject();
    const saveChildRequirement = vi.spyOn(requirementRuns, "save");
    await tasks.createOrFind(activeTaskRecord());

    await expect(
      service.regenerateOutput(sourceTaskId, sourceUnitId, {
        idempotencyKey: regenerationIdempotencyKey,
        sourceAssetId
      })
    ).rejects.toMatchObject({ response: { code: "IMAGE_GENERATION_ALREADY_ACTIVE" } });
    expect(saveChildRequirement).not.toHaveBeenCalled();
    expect(queue.unitJobs).toEqual([]);
  });

  it("replays a failed regeneration without another queue submission", async () => {
    const { service, queue } = await createRegenerationSubject();
    queue.shouldFail = true;

    await expect(
      service.regenerateOutput(sourceTaskId, sourceUnitId, {
        idempotencyKey: regenerationIdempotencyKey,
        sourceAssetId
      })
    ).rejects.toMatchObject({ status: 503 });
    queue.shouldFail = false;

    await expect(
      service.regenerateOutput(sourceTaskId, sourceUnitId, {
        idempotencyKey: regenerationIdempotencyKey,
        sourceAssetId
      })
    ).resolves.toMatchObject({
      status: "failed",
      regeneratedFrom: { taskId: sourceTaskId, unitId: sourceUnitId, assetId: sourceAssetId }
    });
    expect(queue.unitJobs).toEqual([]);
  });

  it("replays a cancelled idempotency key without creating or enqueueing a new task", async () => {
    const { service, queue } = await createSubject();
    const first = await service.create({ requirementRunId, idempotencyKey });
    await service.cancel(first.taskId);
    queue.unitJobs.length = 0;

    const replayed = await service.create({ requirementRunId, idempotencyKey });

    expect(replayed).toEqual({ taskId: first.taskId, status: "cancelled" });
    expect(queue.unitJobs).toEqual([]);
  });

  it("replays a failed idempotency key without creating or enqueueing a new task", async () => {
    const { service, queue, tasks } = await createSubject();
    const first = await service.create({ requirementRunId, idempotencyKey });
    await tasks.markFailed(first.taskId, { code: "TEST_FAILURE", message: "测试失败" });
    queue.unitJobs.length = 0;

    const replayed = await service.create({ requirementRunId, idempotencyKey });

    expect(replayed).toEqual({ taskId: first.taskId, status: "failed" });
    expect(queue.unitJobs).toEqual([]);
  });

  it("allows only one active creation when two tabs submit different keys", async () => {
    const { service, queue } = await createSubject();
    const submissions = await Promise.allSettled([
      service.create({ requirementRunId, idempotencyKey: crypto.randomUUID() }),
      service.create({ requirementRunId, idempotencyKey: crypto.randomUUID() })
    ]);

    expect(submissions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = submissions.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { response: { code: "IMAGE_GENERATION_ALREADY_ACTIVE" } }
    });
    expect(queue.unitJobs).toHaveLength(1);
  });

  it("enqueues one job for each planned output", async () => {
    const result: RequirementResult = {
      ...readyResult,
      finalRequirement: { ...readyResult.finalRequirement, imageCount: 2 }
    };
    const executionPlan: ResolvedGenerationPlan = {
      schemaVersion: "3.0",
      summary: "两个独立方案",
      groups: [
        {
          subjectPolicy: { defaultAction: "preserve", allowedChanges: [] },
          referenceAnalyses: [],
          sourceImages: [
            {
              assetId: productImageId,
              sourceRole: "product_source",
              usage: "edit_target",
              position: 0
            }
          ],
          outputCount: 2,
          outputLayout: "separate_image",
          instruction: "分别输出"
        }
      ]
    };
    const { service, queue } = await createSubject({ result, executionPlan });

    const created = await service.create({ requirementRunId, idempotencyKey });

    expect(queue.unitJobs).toHaveLength(2);
    expect(new Set(queue.unitJobs.map((job) => job.unitId)).size).toBe(2);
    expect(queue.unitJobs.every((job) => job.taskId === created.taskId)).toBe(true);
  });

  it("uses only the group subject policy in each frozen execution unit", async () => {
    const staleInstruction = "把包装改成小猪花卉马赛克";
    const result: RequirementResult = {
      ...readyResult,
      finalRequirement: {
        ...readyResult.finalRequirement,
        subjectPolicy: {
          defaultAction: "preserve",
          allowedChanges: [{ feature: "pattern", instruction: staleInstruction }]
        }
      }
    };
    const { service, tasks } = await createSubject({ result });

    const created = await service.create({ requirementRunId, idempotencyKey });
    const task = await tasks.findById(created.taskId);

    expect(task?.units[0]?.requirementSnapshot?.subjectPolicy.allowedChanges).toEqual([]);
    expect(task?.units[0]?.instruction).not.toContain(staleInstruction);
    expect(task?.units[0]?.instruction).toContain("用户没有授权修改任何商品主体特征");
  });
});

async function createRegenerationSubject(options?: {
  lifecycleStatus?: ImageGenerationTaskRecord["lifecycleStatus"];
  unitStatus?: NonNullable<ImageGenerationTaskRecord["units"]>[number]["status"];
}) {
  const sourceRequest: ResolveRequirementRequest = {
    ...request,
    userText: "生成四张不同构图的电商主图",
    imageSettings: { ...request.imageSettings, imageCount: 4 }
  };
  const sourceResult: RequirementResult = {
    ...readyResult,
    finalRequirement: {
      ...readyResult.finalRequirement,
      imageCount: 4,
      additionalRequirements: [{ key: "campaign", label: "营销主题", instruction: "突出夏日促销" }]
    }
  };
  const subject = await createSubject({ request: sourceRequest, result: sourceResult });
  const asset = mediaAsset(sourceAssetId);
  await subject.assetRepository.save({
    ...asset,
    userId,
    origin: "generated",
    contentSha256: null,
    originalFileName: "source-result.png"
  });
  const sourceUnit: NonNullable<ImageGenerationTaskRecord["units"]>[number] = {
    unitId: sourceUnitId,
    position: 2,
    groupPosition: 0,
    variantPosition: 0,
    outputLayout: "separate_image",
    instruction: "保持商品主体，生成新的桌面陈列构图",
    status: options?.unitStatus ?? "succeeded",
    attemptCount: 1,
    stageStartedAt: "2026-08-11T01:00:00.000Z",
    completedAt: "2026-08-11T01:01:00.000Z",
    qualitySourceAssetIds: [productImageId],
    subjectEntities: [
      {
        entityKey: "product",
        label: "商品主体",
        productEntityId,
        lineageKind: "inherited_product_entity",
        inheritedFromAssetId: sourceAssetId,
        sourceAssetIds: [productImageId]
      }
    ],
    generatedAsset: asset,
    deliverableAsset: asset,
    subjectConsistencyStatus: "completed",
    subjectConsistencyPhase: "final_inspection",
    error: null,
    sources: [
      {
        assetId: productImageId,
        sourceRole: "product_source",
        usage: "edit_target",
        position: 0
      },
      {
        assetId: referenceImageId,
        sourceRole: "user_reference",
        usage: "style_reference",
        position: 1
      }
    ]
  };
  await subject.tasks.createOrFind({
    taskId: sourceTaskId,
    userId,
    requirementRunId,
    sessionId,
    stateSnapshotId,
    idempotencyKey: sourceTaskId,
    projectId,
    modelId: "openai-image",
    instruction: "来源任务完整指令",
    instructionVersion: "image-instruction-v3",
    status: options?.lifecycleStatus === "running" ? "running" : "succeeded",
    lifecycleStatus: options?.lifecycleStatus ?? "terminal",
    lifecycleUpdatedAt: "2026-08-11T01:01:00.000Z",
    resultAssets: [asset],
    error: null,
    createdAt: "2026-08-11T01:00:00.000Z",
    updatedAt: "2026-08-11T01:01:00.000Z",
    requestedOutputCount: 4,
    unitFailures: [],
    regeneratedFrom: null,
    units: [sourceUnit]
  });
  return { ...subject, sourceRequest, sourceResult, sourceUnit };
}

function activeTaskRecord(): ImageGenerationTaskRecord {
  const now = new Date().toISOString();
  return {
    taskId: "00000000-0000-4000-8000-000000000050",
    userId,
    requirementRunId: "00000000-0000-4000-8000-000000000051",
    sessionId,
    idempotencyKey: "00000000-0000-4000-8000-000000000052",
    projectId,
    modelId: "openai-image",
    instruction: "另一个正在执行的任务",
    instructionVersion: "image-instruction-v3",
    status: "running",
    lifecycleStatus: "running",
    lifecycleUpdatedAt: now,
    resultAssets: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    units: [
      {
        unitId: "00000000-0000-4000-8000-000000000053",
        position: 0,
        groupPosition: 0,
        variantPosition: 0,
        outputLayout: "separate_image",
        instruction: "另一个任务的冻结执行单元",
        qualitySourceAssetIds: [],
        subjectEntities: [],
        sources: []
      }
    ]
  };
}

function mediaAsset(id: string): MediaAsset {
  return {
    id,
    projectId,
    kind: "image",
    storageKey: `generated/${id}.png`,
    mimeType: "image/png",
    byteSize: 20,
    createdAt: "2026-08-11T01:01:00.000Z"
  };
}

async function saveSource(repository: InMemoryMediaAssetRepository, id: string): Promise<void> {
  const asset = mediaAsset(id);
  await repository.save({
    ...asset,
    userId,
    origin: "uploaded",
    contentSha256: null,
    originalFileName: `${id}.png`
  });
}
