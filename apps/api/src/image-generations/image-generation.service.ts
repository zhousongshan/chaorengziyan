import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";

import {
  createImageGenerationRequestSchema,
  finalRequirementSchema,
  imageGenerationSessionListQuerySchema,
  regenerateImageGenerationOutputRequestSchema,
  type CreateImageGenerationResponse,
  type Environment,
  type FinalRequirement,
  type ImageGenerationTask,
  type ImageGenerationCancellation,
  type RegenerateImageGenerationOutputResponse,
  type ResolvedGenerationPlan,
  type ResolveRequirementRequest,
  type SubjectConsistencyStatus,
  generationPlanOutputCount
} from "@chaoren/contracts";
import {
  buildImageGenerationInstruction,
  IMAGE_GENERATION_INSTRUCTION_VERSION
} from "@chaoren/image-generation";

import { AUTHORIZATION_PORT, type AuthorizationPort } from "../authorization/authorization.port.js";
import { ENVIRONMENT } from "../environment.js";
import { ImageModelCatalog } from "../image-models/image-model.catalog.js";
import { MediaAssetService } from "../media-assets/media-asset.service.js";
import {
  REQUIREMENT_RUN_REPOSITORY,
  type RequirementRunRecord,
  type RequirementRunRepository
} from "../requirements/requirement-run.repository.js";
import {
  IMAGE_GENERATION_QUEUE,
  type ImageGenerationQueue
} from "./image-generation-queue.port.js";
import {
  ActiveImageGenerationExistsError,
  IMAGE_GENERATION_TASK_REPOSITORY,
  ImageGenerationIdempotencyConflictError,
  ImageGenerationRegenerationSourceChangedError,
  ImageGenerationRegenerationSourceNotFoundError,
  ImageGenerationRegenerationSourceNotReadyError,
  InvalidQualityEntityLineageError,
  type ImageGenerationRegenerationRecord,
  type ImageGenerationTaskRecord,
  type ImageGenerationTaskRepository
} from "./image-generation-task.repository.js";

type CurrentGenerationPlan = Extract<ResolvedGenerationPlan, { schemaVersion: "3.0" }>;

@Injectable()
export class ImageGenerationService implements OnModuleInit, OnModuleDestroy {
  private dispatchTimer?: NodeJS.Timeout;
  private dispatching = false;
  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
    @Inject(REQUIREMENT_RUN_REPOSITORY)
    private readonly requirementRuns: RequirementRunRepository,
    @Inject(IMAGE_GENERATION_QUEUE) private readonly queue: ImageGenerationQueue,
    @Inject(IMAGE_GENERATION_TASK_REPOSITORY)
    private readonly tasks: ImageGenerationTaskRepository,
    private readonly imageModels: ImageModelCatalog,
    private readonly mediaAssets: MediaAssetService
  ) {}

  public async onModuleInit(): Promise<void> {
    const recoverableUnits = await this.tasks.findRecoverableUnits();
    await Promise.allSettled(
      recoverableUnits.map((unit) => this.queue.enqueueUnit(unit.taskId, unit.unitId))
    );
    if (this.tasks.claimPendingDispatches) {
      await this.dispatchPendingEvents();
      this.dispatchTimer = setInterval(() => void this.dispatchPendingEvents(), 2_000);
      this.dispatchTimer.unref();
    }
  }

  public onModuleDestroy(): void {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
  }

  public async create(rawRequest: unknown): Promise<CreateImageGenerationResponse> {
    const parsedRequest = createImageGenerationRequestSchema.safeParse(rawRequest);
    if (!parsedRequest.success) {
      throw new BadRequestException({
        code: "INVALID_IMAGE_GENERATION_REQUEST",
        issues: parsedRequest.error.issues.map((issue) => ({
          field: issue.path.join(".") || "$",
          message: issue.message
        }))
      });
    }

    const run = await this.requirementRuns.findById(parsedRequest.data.requirementRunId);
    if (!run || run.userId !== this.environment.LOCAL_USER_ID) {
      throw new NotFoundException({ code: "REQUIREMENT_RUN_NOT_FOUND" });
    }
    if (run.result.status !== "ready") {
      throw new ConflictException({
        code: "REQUIREMENT_NEEDS_CLARIFICATION",
        message: "需求尚未确认，不能开始生图"
      });
    }

    const model = this.imageModels.getEnabled(run.request.modelId);
    const { imageCount, aspectRatio } = run.result.finalRequirement;
    if (imageCount > model.maxImageCount || !model.supportedAspectRatios.includes(aspectRatio)) {
      throw new ConflictException({
        code: "REQUIREMENT_MODEL_CONSTRAINT_CHANGED",
        message: "已确认需求不再符合当前模型能力，请重新进行需求识别"
      });
    }

    const assetIds = [
      ...new Set([
        ...run.request.productImageIds,
        ...run.request.referenceImageIds,
        ...(run.request.editBaseImageId ? [run.request.editBaseImageId] : []),
        ...(run.executionPlan?.groups.flatMap((group) =>
          group.sourceImages.map((source) => source.assetId)
        ) ?? []),
        ...(run.request.deliverySettings.watermark.assetId
          ? [run.request.deliverySettings.watermark.assetId]
          : [])
      ])
    ];
    await this.authorization.assertAccess({
      userId: this.environment.LOCAL_USER_ID,
      projectId: run.request.projectId,
      assetIds
    });
    await this.mediaAssets.getOwnedImages(assetIds, run.request.projectId);
    await this.mediaAssets.assertProductAvailableIds(assetIds);

    if (!run.executionPlan || run.executionPlan.schemaVersion !== "3.0") {
      throw new ConflictException({
        code: "GENERATION_PLAN_VERSION_UNSUPPORTED",
        message: "当前需求缺少新版参考图与原子单元执行契约，请重新进行需求识别"
      });
    }
    const plan = run.executionPlan;
    if (generationPlanOutputCount(plan) !== imageCount) {
      throw new ConflictException({
        code: "GENERATION_PLAN_OUTPUT_COUNT_MISMATCH",
        message: "执行计划输出数量与已确认需求不一致，请重新进行需求识别"
      });
    }
    if (plan.groups.some((group) => !group.instruction?.trim())) {
      throw new ConflictException({
        code: "GENERATION_PLAN_CONTEXT_CONFLICT",
        message: "本次执行计划缺少完整的单元需求，请重新进行需求识别"
      });
    }
    if (
      plan.groups.some(
        (group) =>
          group.referenceAnalyses.length > 0 &&
          (!group.referenceDesignPlan || group.copyPlan === undefined)
      )
    ) {
      throw new ConflictException({
        code: "GENERATION_PLAN_CONTEXT_CONFLICT",
        message: "本次参考图执行计划缺少理解、版式或文案规划，请重新进行需求识别"
      });
    }
    const units = expandGenerationUnits(plan, run.result.finalRequirement, run.request);
    const now = new Date().toISOString();
    const task: ImageGenerationTaskRecord = {
      taskId: randomUUID(),
      userId: this.environment.LOCAL_USER_ID,
      requirementRunId: run.id,
      sessionId: run.sessionId ?? null,
      stateSnapshotId: run.stateSnapshotId ?? null,
      idempotencyKey: parsedRequest.data.idempotencyKey,
      projectId: run.request.projectId,
      modelId: model.id,
      instruction: "本任务只允许按已冻结的执行单元指令执行。",
      instructionVersion: IMAGE_GENERATION_INSTRUCTION_VERSION,
      status: "queued",
      resultAssets: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      units
    };
    let stored;
    try {
      stored = await this.tasks.createOrFind(task);
    } catch (error) {
      if (error instanceof ActiveImageGenerationExistsError) {
        throw new ConflictException({
          code: "IMAGE_GENERATION_ALREADY_ACTIVE",
          message: "当前会话已有图片任务正在执行，请等待完成或先停止任务"
        });
      }
      if (error instanceof InvalidQualityEntityLineageError) {
        throw new ConflictException({
          code: "QUALITY_ENTITY_LINEAGE_INVALID",
          message: "商品与原图关系无法确认，请重新选择商品原图后生成"
        });
      }
      throw error;
    }
    if (!stored.created) {
      if (stored.record.requirementRunId !== run.id) {
        throw new ConflictException({
          code: "IMAGE_GENERATION_IDEMPOTENCY_CONFLICT",
          message: "同一个幂等键不能用于不同的生图需求"
        });
      }
      return { taskId: stored.record.taskId, status: stored.record.status };
    }
    if (this.tasks.claimPendingDispatches) {
      await this.dispatchPendingEvents();
      return { taskId: task.taskId, status: task.status };
    }
    let enqueueResults: PromiseSettledResult<void>[];
    try {
      enqueueResults = await Promise.allSettled(
        units.map((unit) => this.queue.enqueueUnit(task.taskId, unit.unitId))
      );
    } catch {
      await this.tasks.markFailed(task.taskId, {
        code: "IMAGE_GENERATION_QUEUE_UNAVAILABLE",
        message: "生图任务队列暂时不可用，请稍后重试"
      });
      throw new ServiceUnavailableException({
        code: "IMAGE_GENERATION_QUEUE_UNAVAILABLE",
        message: "生图任务队列暂时不可用，请稍后重试"
      });
    }
    const failedUnits = enqueueResults.flatMap((result, index) =>
      result.status === "rejected" ? [units[index]!] : []
    );
    await Promise.all(
      failedUnits.map((unit) =>
        this.tasks.markUnitFailed(unit.unitId, {
          code: "IMAGE_GENERATION_QUEUE_UNAVAILABLE",
          message: "该图片的生图任务未能进入队列，请稍后重试"
        })
      )
    );
    if (failedUnits.length === units.length) {
      throw new ServiceUnavailableException({
        code: "IMAGE_GENERATION_QUEUE_UNAVAILABLE",
        message: "生图任务队列暂时不可用，请稍后重试"
      });
    }
    return { taskId: task.taskId, status: task.status };
  }

  private async dispatchPendingEvents(): Promise<void> {
    if (
      this.dispatching ||
      !this.tasks.claimPendingDispatches ||
      !this.tasks.markDispatchPublished ||
      !this.tasks.markDispatchFailed
    ) {
      return;
    }
    this.dispatching = true;
    try {
      const events = await this.tasks.claimPendingDispatches(100);
      for (const event of events) {
        try {
          if (event.eventType === "generation.unit.enqueue" && event.unitId) {
            await this.queue.enqueueUnit(event.taskId, event.unitId);
          } else {
            await this.tasks.markDispatchPublished(event.eventId);
            continue;
          }
          await this.tasks.markDispatchPublished(event.eventId);
        } catch (error) {
          await this.tasks.markDispatchFailed(
            event.eventId,
            error instanceof Error ? error.message : "队列投递失败"
          );
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  public async findById(id: string): Promise<ImageGenerationTask> {
    const task = await this.tasks.findById(id);
    if (!task || task.userId !== this.environment.LOCAL_USER_ID) {
      throw new NotFoundException({ code: "IMAGE_GENERATION_TASK_NOT_FOUND" });
    }
    return this.toResponse(task);
  }

  public async regenerateOutput(
    taskId: string,
    unitId: string,
    rawRequest: unknown
  ): Promise<RegenerateImageGenerationOutputResponse> {
    const parsed = regenerateImageGenerationOutputRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new BadRequestException({ code: "INVALID_IMAGE_REGENERATION_REQUEST" });
    }

    const existing = await this.tasks.findByIdempotencyKey(
      this.environment.LOCAL_USER_ID,
      parsed.data.idempotencyKey
    );
    if (existing) {
      if (
        existing.regeneratedFrom?.taskId !== taskId ||
        existing.regeneratedFrom.unitId !== unitId ||
        existing.regeneratedFrom.assetId !== parsed.data.sourceAssetId
      ) {
        throw new ConflictException({ code: "IMAGE_GENERATION_IDEMPOTENCY_CONFLICT" });
      }
      return {
        taskId: existing.taskId,
        requirementRunId: existing.requirementRunId,
        status: existing.status,
        regeneratedFrom: existing.regeneratedFrom
      };
    }

    const sourceTask = await this.tasks.findById(taskId);
    if (!sourceTask || sourceTask.userId !== this.environment.LOCAL_USER_ID) {
      throw new NotFoundException({ code: "IMAGE_GENERATION_TASK_NOT_FOUND" });
    }
    const sourceUnit = sourceTask.units?.find((unit) => unit.unitId === unitId);
    if (!sourceUnit) {
      throw new NotFoundException({ code: "IMAGE_GENERATION_OUTPUT_NOT_FOUND" });
    }
    if (
      sourceTask.lifecycleStatus !== "terminal" ||
      sourceUnit.status !== "succeeded" ||
      !sourceUnit.deliverableAsset
    ) {
      throw new ConflictException({
        code: "IMAGE_GENERATION_OUTPUT_NOT_READY",
        message: "所选结果尚未完成，暂时不能再次生成"
      });
    }
    if (sourceUnit.deliverableAsset.id !== parsed.data.sourceAssetId) {
      throw new ConflictException({
        code: "IMAGE_GENERATION_OUTPUT_CHANGED",
        message: "所选结果已经更新，请刷新后重试"
      });
    }

    const sourceRun = await this.requirementRuns.findById(sourceTask.requirementRunId);
    if (
      !sourceRun ||
      sourceRun.userId !== this.environment.LOCAL_USER_ID ||
      sourceRun.result.status !== "ready"
    ) {
      throw new NotFoundException({ code: "REQUIREMENT_RUN_NOT_FOUND" });
    }
    if (!sourceRun.executionPlan || sourceRun.executionPlan.schemaVersion !== "3.0") {
      throw new ConflictException({
        code: "GENERATION_PLAN_VERSION_UNSUPPORTED",
        message: "该历史结果缺少新版冻结执行契约，不能再次生成"
      });
    }
    const sourceGroup = sourceRun.executionPlan.groups[sourceUnit.groupPosition];
    if (!sourceGroup) {
      throw new ConflictException({
        code: "GENERATION_PLAN_CONTEXT_CONFLICT",
        message: "历史结果对应的冻结执行分组不存在"
      });
    }
    this.imageModels.getEnabled(sourceTask.modelId);
    const sourceAssetIds = [
      ...new Set([
        ...sourceUnit.sources.map((source) => source.assetId),
        ...sourceUnit.qualitySourceAssetIds,
        parsed.data.sourceAssetId,
        ...(sourceRun.request.deliverySettings.watermark.assetId
          ? [sourceRun.request.deliverySettings.watermark.assetId]
          : [])
      ])
    ];
    await this.authorization.assertAccess({
      userId: this.environment.LOCAL_USER_ID,
      projectId: sourceTask.projectId,
      assetIds: sourceAssetIds
    });
    await this.mediaAssets.getOwnedImages(sourceAssetIds, sourceTask.projectId);

    const requirementRunId = randomUUID();
    const nextTaskId = randomUUID();
    const nextUnitId = randomUUID();
    const now = new Date().toISOString();
    const requirement = { ...sourceRun.result.finalRequirement, imageCount: 1 };
    const request = {
      ...sourceRun.request,
      imageSettings: { ...sourceRun.request.imageSettings, imageCount: 1 }
    };
    const executionPlan: ResolvedGenerationPlan = {
      schemaVersion: "3.0",
      summary: `再次生成来源执行单元 ${sourceUnit.unitId}`,
      groups: [
        {
          sourceImages: sourceUnit.sources.map((source) => ({ ...source })),
          subjectPolicy: sourceGroup.subjectPolicy,
          referenceDesignPlan: sourceGroup.referenceDesignPlan,
          copyPlan: sourceGroup.copyPlan,
          referenceAnalyses: sourceGroup.referenceAnalyses.map((analysis) => ({
            ...analysis,
            observedDesign: { ...analysis.observedDesign },
            transferPlan: {
              ...analysis.transferPlan,
              adopt: [...analysis.transferPlan.adopt],
              adapt: [...analysis.transferPlan.adapt],
              avoid: [...analysis.transferPlan.avoid],
              userPriority: [...analysis.transferPlan.userPriority]
            }
          })),
          subjectEntities: (sourceUnit.subjectEntities ?? []).map((entity) => ({
            ...entity,
            lineageKind: "inherited_product_entity" as const,
            inheritedFromAssetId: parsed.data.sourceAssetId,
            sourceAssetIds: [...entity.sourceAssetIds]
          })),
          outputCount: 1,
          outputLayout: sourceUnit.outputLayout,
          instruction: sourceUnit.instruction ?? sourceTask.instruction
        }
      ]
    };
    const childRequirementRun: RequirementRunRecord = {
      id: requirementRunId,
      parentRequirementRunId: sourceRun.id,
      sessionId: sourceRun.sessionId ?? null,
      sourceMessageId: sourceRun.sourceMessageId ?? null,
      stateSnapshotId: sourceRun.stateSnapshotId ?? null,
      userId: sourceRun.userId,
      request,
      result: {
        schemaVersion: "1.0",
        status: "ready",
        finalRequirement: requirement,
        conflictDecisions: []
      },
      executionPlan,
      executionPlanHash: createHash("sha256").update(JSON.stringify(executionPlan)).digest("hex"),
      aiModel: sourceRun.aiModel,
      promptVersion: sourceRun.promptVersion,
      createdAt: now
    };

    const regeneratedFrom = {
      taskId: sourceTask.taskId,
      unitId: sourceUnit.unitId,
      assetId: parsed.data.sourceAssetId
    };
    const task: ImageGenerationRegenerationRecord["task"] = {
      taskId: nextTaskId,
      userId: sourceTask.userId,
      requirementRunId,
      sessionId: sourceTask.sessionId ?? null,
      stateSnapshotId: sourceTask.stateSnapshotId ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
      projectId: sourceTask.projectId,
      modelId: sourceTask.modelId,
      instruction: "本任务只允许按已冻结的执行单元指令执行。",
      instructionVersion: sourceTask.instructionVersion,
      status: "queued",
      resultAssets: [],
      error: null,
      createdAt: now,
      updatedAt: now,
      regeneratedFrom,
      units: [
        {
          unitId: nextUnitId,
          position: 0,
          groupPosition: 0,
          variantPosition: 0,
          outputLayout: sourceUnit.outputLayout,
          instruction: sourceUnit.instruction,
          requirementSnapshot: sourceUnit.requirementSnapshot ?? requirement,
          sources: sourceUnit.sources.map((source) => ({ ...source })),
          qualitySourceAssetIds: [...sourceUnit.qualitySourceAssetIds],
          subjectEntities: (sourceUnit.subjectEntities ?? []).map((entity) => ({
            ...entity,
            sourceAssetIds: [...entity.sourceAssetIds]
          }))
        }
      ]
    };
    let stored;
    try {
      stored = await this.tasks.createRegenerationOrFind({
        requirementRun: childRequirementRun,
        task
      });
    } catch (error) {
      if (error instanceof ActiveImageGenerationExistsError) {
        throw new ConflictException({
          code: "IMAGE_GENERATION_ALREADY_ACTIVE",
          message: "当前会话已有图片任务正在执行，请等待完成或先停止任务"
        });
      }
      if (error instanceof ImageGenerationIdempotencyConflictError) {
        throw new ConflictException({ code: "IMAGE_GENERATION_IDEMPOTENCY_CONFLICT" });
      }
      if (error instanceof ImageGenerationRegenerationSourceNotFoundError) {
        throw new NotFoundException({ code: "IMAGE_GENERATION_OUTPUT_NOT_FOUND" });
      }
      if (error instanceof ImageGenerationRegenerationSourceNotReadyError) {
        throw new ConflictException({
          code: "IMAGE_GENERATION_OUTPUT_NOT_READY",
          message: "所选结果尚未完成，暂时不能再次生成"
        });
      }
      if (error instanceof ImageGenerationRegenerationSourceChangedError) {
        throw new ConflictException({
          code: "IMAGE_GENERATION_OUTPUT_CHANGED",
          message: "所选结果已经更新，请刷新后重试"
        });
      }
      if (error instanceof InvalidQualityEntityLineageError) {
        throw new ConflictException({
          code: "QUALITY_ENTITY_LINEAGE_INVALID",
          message: "商品与原图关系无法确认，请重新选择商品原图后生成"
        });
      }
      throw error;
    }
    if (stored.created) {
      if (this.tasks.claimPendingDispatches) await this.dispatchPendingEvents();
      else {
        try {
          await this.queue.enqueueUnit(nextTaskId, nextUnitId);
        } catch {
          await this.tasks.markUnitFailed(nextUnitId, {
            code: "IMAGE_GENERATION_QUEUE_UNAVAILABLE",
            message: "该图片的生图任务未能进入队列，请稍后重试"
          });
          throw new ServiceUnavailableException({
            code: "IMAGE_GENERATION_QUEUE_UNAVAILABLE",
            message: "生图任务队列暂时不可用，请稍后重试"
          });
        }
      }
    }
    return {
      taskId: stored.record.taskId,
      requirementRunId: stored.record.requirementRunId,
      status: stored.record.status,
      regeneratedFrom: stored.record.regeneratedFrom ?? regeneratedFrom
    };
  }

  public async listBySessionId(rawQuery: unknown): Promise<{ tasks: ImageGenerationTask[] }> {
    const parsed = imageGenerationSessionListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({ code: "INVALID_IMAGE_GENERATION_SESSION_QUERY" });
    }
    const records = await this.tasks.findBySessionId(
      parsed.data.sessionId,
      this.environment.LOCAL_USER_ID,
      parsed.data.requirementRunIds
    );
    return { tasks: await Promise.all(records.map((record) => this.toResponse(record))) };
  }

  public async findActiveBySessionId(
    sessionId: string
  ): Promise<{ task: ImageGenerationTask | null }> {
    const record = await this.tasks.findActiveBySessionId(
      sessionId,
      this.environment.LOCAL_USER_ID
    );
    return { task: record ? await this.toResponse(record) : null };
  }

  public async cancel(id: string): Promise<ImageGenerationCancellation> {
    const task = await this.tasks.findById(id);
    if (!task || task.userId !== this.environment.LOCAL_USER_ID) {
      throw new NotFoundException({ code: "IMAGE_GENERATION_TASK_NOT_FOUND" });
    }
    const result = await this.tasks.cancel(id, this.environment.LOCAL_USER_ID);
    if (!result.cancelled) {
      throw new ConflictException({
        code: "IMAGE_GENERATION_TASK_ALREADY_FINISHED",
        message: "任务已经结束，不能再停止"
      });
    }
    await Promise.all(
      [{ taskId: id, unitIds: result.unitIds }, ...result.relatedTasks].map((target) =>
        this.queue.cancel(target.taskId, target.unitIds).catch(() => undefined)
      )
    );
    const cancelled = await this.tasks.findById(id);
    if (!cancelled || cancelled.lifecycleStatus !== "cancelled") {
      throw new ConflictException({
        code: "IMAGE_GENERATION_TASK_ALREADY_FINISHED",
        message: "任务已经结束，不能再停止"
      });
    }
    return {
      taskId: id,
      status: "cancelled",
      cancelledAt: cancelled.lifecycleUpdatedAt ?? cancelled.updatedAt,
      providerCancellationStatus: result.hadRunningAttempt ? "not_supported" : "not_required"
    };
  }

  private async toResponse(task: ImageGenerationTaskRecord): Promise<ImageGenerationTask> {
    const units = task.units ?? [];
    const requirementRun = await this.requirementRuns.findById(task.requirementRunId);
    const isRepairGeneration = Boolean(
      requirementRun?.parentRequirementRunId && !task.regeneratedFrom
    );
    const deliverableAssetIds = units.flatMap((unit) =>
      unit.deliverableAsset ? [unit.deliverableAsset.id] : []
    );
    const presentationMetadata =
      await this.mediaAssets.getPresentationMetadata(deliverableAssetIds);
    const outputs = units.map((unit) => ({
      unitId: unit.unitId,
      position: unit.position,
      groupPosition: unit.groupPosition,
      variantPosition: unit.variantPosition,
      generationStatus: unit.status ?? "queued",
      attemptCount: unit.attemptCount ?? 0,
      stageStartedAt: unit.stageStartedAt ?? task.createdAt,
      completedAt: unit.completedAt ?? null,
      subjectConsistencyRequired: !isRepairGeneration && unit.qualitySourceAssetIds.length > 0,
      subjectConsistencyStatus: unit.subjectConsistencyStatus ?? null,
      subjectConsistencyPhase: unit.subjectConsistencyPhase ?? null,
      generatedAsset: unit.generatedAsset ?? null,
      deliverableAsset: unit.deliverableAsset ?? null,
      displayName: unit.deliverableAsset
        ? (presentationMetadata[unit.deliverableAsset.id]?.displayName ?? null)
        : null,
      favorite: unit.deliverableAsset
        ? (presentationMetadata[unit.deliverableAsset.id]?.favorite ?? false)
        : false,
      error: unit.error ?? null
    }));
    const workflowStatus =
      task.lifecycleStatus === "cancelled"
        ? "cancelled"
        : deriveWorkflowStatus(outputs, task.status);
    const deliverableAssets = outputs.flatMap((output) =>
      output.deliverableAsset ? [output.deliverableAsset] : []
    );
    const activeStageStarts = outputs
      .filter((output) => output.completedAt === null)
      .map((output) => output.stageStartedAt)
      .sort();
    return {
      taskId: task.taskId,
      requirementRunId: task.requirementRunId,
      projectId: task.projectId,
      modelId: task.modelId,
      executionConcurrency: this.environment.IMAGE_WORKER_CONCURRENCY,
      stageStartedAt: activeStageStarts[0] ?? task.updatedAt,
      subjectConsistencyRequired:
        outputs.some((output) => output.subjectConsistencyRequired) ||
        Boolean(
          units.length === 0 && requirementRun && requirementRun.request.productImageIds.length > 0
        ),
      status: task.status,
      workflowStatus,
      resultAssets: units.length > 0 ? deliverableAssets : task.resultAssets,
      outputs,
      requestedOutputCount:
        task.requestedOutputCount ?? (units.length > 0 ? units.length : task.resultAssets.length),
      succeededOutputCount: units.length > 0 ? deliverableAssets.length : task.resultAssets.length,
      unitFailures: task.unitFailures ?? [],
      regeneratedFrom: task.regeneratedFrom ?? null,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
  }
}

function expandGenerationUnits(
  plan: CurrentGenerationPlan,
  requirement: FinalRequirement,
  request: ResolveRequirementRequest
) {
  let position = 0;
  const units = plan.groups.flatMap((group, groupPosition) => {
    const sourceImages = appendBrandLogoSource(group.sourceImages, request.deliverySettings);
    const instruction = group.instruction;
    if (!instruction) {
      throw new InvalidQualityEntityLineageError("生图执行单元缺少冻结需求指令");
    }
    const requirementSnapshot = buildUnitRequirementSnapshot(
      requirement,
      instruction,
      group.subjectPolicy
    );
    return Array.from({ length: group.outputCount }, (_, variantPosition) => ({
      unitId: randomUUID(),
      position: position++,
      groupPosition,
      variantPosition,
      outputLayout: group.outputLayout,
      requirementSnapshot,
      instruction: [
        buildImageGenerationInstruction(
          requirementSnapshot,
          {
            editBase: sourceImages.filter((source) => toProviderRole(source) === "edit_base")
              .length,
            product: sourceImages.filter((source) => toProviderRole(source) === "product").length,
            reference: sourceImages.filter((source) => toProviderRole(source) === "reference")
              .length
          },
          {
            generationGoal: request.imageSettings.generationGoal,
            referenceGuidance: request.referenceGuidance.filter((guidance) =>
              sourceImages.some((source) => source.assetId === guidance.assetId)
            ),
            referenceAnalyses: group.referenceAnalyses.map((analysis) => {
              const sourceImageNumber =
                sourceImages.findIndex((source) => source.assetId === analysis.assetId) + 1;
              if (sourceImageNumber <= 0) {
                throw new InvalidQualityEntityLineageError("参考分析没有对应的执行单元参考图");
              }
              return { ...analysis, sourceImageNumber };
            }),
            referenceDesignPlan: group.referenceDesignPlan,
            copyPlan: group.copyPlan,
            orderedSourceRoles: sourceImages.map(toProviderRole),
            brandLogoPosition: request.deliverySettings.watermark.position
          }
        ),
        `本执行单元输出形式：${group.outputLayout}。`
      ]
        .filter(Boolean)
        .join("\n"),
      sources: sourceImages,
      subjectEntities: group.subjectEntities,
      qualitySourceAssetIds: [] as string[]
    }));
  });
  return units.map((unit) => {
    const subjectEntities = (unit.subjectEntities ?? []).map((entity) => {
      if (!entity.productEntityId || entity.lineageKind === "legacy_unverified") {
        throw new InvalidQualityEntityLineageError("商品实体缺少可信的稳定血缘");
      }
      return {
        entityKey: entity.entityKey,
        label: entity.label,
        productEntityId: entity.productEntityId,
        lineageKind: entity.lineageKind,
        inheritedFromAssetId: entity.inheritedFromAssetId,
        sourceAssetIds: [...new Set(entity.sourceAssetIds)]
      };
    });
    const qualitySourceAssetIds = [
      ...new Set(subjectEntities.flatMap((entity) => entity.sourceAssetIds))
    ];
    return {
      ...unit,
      qualitySourceAssetIds,
      subjectEntities
    };
  });
}

function buildUnitRequirementSnapshot(
  requirement: FinalRequirement,
  instruction: string,
  subjectPolicy: FinalRequirement["subjectPolicy"]
): FinalRequirement {
  return finalRequirementSchema.parse({
    imageCount: 1,
    aspectRatio: requirement.aspectRatio,
    intent: instruction,
    scene: null,
    background: null,
    composition: null,
    lighting: null,
    style: null,
    mustKeep: [],
    mustAvoid: [],
    subjectPolicy
  });
}

function deriveWorkflowStatus(
  outputs: Array<{
    generationStatus: ImageGenerationTask["status"];
    subjectConsistencyRequired: boolean;
    subjectConsistencyStatus: SubjectConsistencyStatus | null;
    deliverableAsset: unknown;
  }>,
  parentStatus: ImageGenerationTask["status"]
): NonNullable<ImageGenerationTask["workflowStatus"]> {
  if (parentStatus === "cancelled") return "cancelled";
  if (outputs.length === 0) return parentStatus;
  const delivered = outputs.filter((output) => output.deliverableAsset).length;
  const pending = outputs.some(
    (output) =>
      output.generationStatus === "queued" ||
      output.generationStatus === "running" ||
      (output.generationStatus === "succeeded" &&
        output.subjectConsistencyRequired &&
        (output.subjectConsistencyStatus === null ||
          output.subjectConsistencyStatus === "queued" ||
          output.subjectConsistencyStatus === "running"))
  );
  if (pending) return parentStatus === "queued" ? "queued" : "running";
  if (delivered === outputs.length) return "succeeded";
  if (delivered > 0) return "partially_succeeded";
  return "failed";
}

function toProviderRole(
  source: ResolvedGenerationPlan["groups"][number]["sourceImages"][number]
): "edit_base" | "product" | "reference" | "brand_logo" {
  if (source.sourceRole === "brand_logo" || source.usage === "brand_mark") {
    return "brand_logo";
  }
  if (source.usage === "style_reference" || source.sourceRole === "user_reference")
    return "reference";
  if (source.usage === "edit_target") return "edit_base";
  if (["edit_base", "generated_result", "selected_result"].includes(source.sourceRole)) {
    return "edit_base";
  }
  return "product";
}

function appendBrandLogoSource(
  sources: ResolvedGenerationPlan["groups"][number]["sourceImages"],
  deliverySettings: ResolveRequirementRequest["deliverySettings"]
): ResolvedGenerationPlan["groups"][number]["sourceImages"] {
  const watermark = deliverySettings.watermark;
  const withoutPreviousLogo = sources
    .filter((source) => source.sourceRole !== "brand_logo" && source.usage !== "brand_mark")
    .map((source, position) => ({ ...source, position }));
  if (!watermark.enabled || !watermark.assetId) return withoutPreviousLogo;
  return [
    ...withoutPreviousLogo,
    {
      assetId: watermark.assetId,
      sourceRole: "brand_logo",
      usage: "brand_mark",
      position: withoutPreviousLogo.length
    }
  ];
}
