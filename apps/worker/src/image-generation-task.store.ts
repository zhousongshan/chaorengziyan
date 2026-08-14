import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  conversationMessageAssets,
  conversationMessages,
  creationRuns,
  generationTaskOutputs,
  generationTaskUnitQualitySources,
  generationTaskUnits,
  generationTaskUnitSources,
  generationTasks,
  generationUnitAttempts,
  mediaAssets,
  requirementRuns,
  subjectConsistencyCheckSources,
  subjectConsistencyRepairs,
  subjectConsistencyChecks,
  workflowEvents,
  type DatabaseConnection
} from "@chaoren/database";
import {
  finalRequirementSchema,
  requirementResultSchema,
  resolveRequirementRequestSchema,
  type FinalRequirement,
  type ImageDeliverySettings,
  type ImageGenerationError,
  type ImageGenerationStatus
} from "@chaoren/contracts";
import type { SourceImageRole } from "@chaoren/image-generation";
import { buildBrandLogoInstruction } from "@chaoren/image-generation";

import { CreationRunCoordinator } from "./creation-run.coordinator.js";

export interface WorkerSourceAsset {
  id: string;
  storageKey: string;
  mimeType: string;
  role: SourceImageRole;
}

export interface WorkerExecutableUnit {
  id: string;
  position: number;
  status?: ImageGenerationStatus;
  instruction: string;
  requirement?: FinalRequirement;
  outputLayout: string;
  sourceAssets: WorkerSourceAsset[];
  qualitySourceAssetIds?: string[];
}

export interface WorkerDeliveryAsset {
  id: string;
  storageKey: string;
  mimeType: string;
}

interface WorkerGenerationTaskBase {
  id: string;
  userId: string;
  projectId: string;
  modelId: string;
  requirementRunId: string;
  sessionId?: string | null;
  stateSnapshotId?: string | null;
}

export interface WorkerExecutableTask extends WorkerGenerationTaskBase {
  status: Extract<ImageGenerationStatus, "queued" | "running">;
  requirement: FinalRequirement;
  renderSettings: ReturnType<typeof resolveRequirementRequestSchema.parse>["renderSettings"];
  deliverySettings: ImageDeliverySettings;
  watermarkAsset: WorkerDeliveryAsset | null;
  instruction: string;
  sourceAssets: WorkerSourceAsset[];
  units?: WorkerExecutableUnit[];
}

export interface WorkerTerminalTask extends WorkerGenerationTaskBase {
  status: Exclude<ImageGenerationStatus, "queued" | "running">;
  requirement: null;
  instruction: null;
  sourceAssets: [];
  units?: [];
}

export type WorkerGenerationTask = WorkerExecutableTask | WorkerTerminalTask;

export interface WorkerOutputAsset {
  id: string;
  userId: string;
  projectId: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  originalFileName: string;
  createdAt: Date;
  unitId?: string;
  unitPosition?: number;
  sourceProductAssetIds?: string[];
}

export interface WorkerFailedUnitAttempt {
  providerRequestId?: string;
  failureStage?: "submission" | "polling" | "download" | "validation";
  errorCode?: string;
}

export interface WorkerAttemptFailure extends ImageGenerationError {
  stage?: "submission" | "polling" | "download" | "validation";
  details?: Record<string, unknown>;
}

export interface ImageGenerationTaskStore {
  load(taskId: string): Promise<WorkerGenerationTask | undefined>;
  loadUnit(
    taskId: string,
    unitId: string
  ): Promise<
    | {
        task: WorkerExecutableTask;
        unit: WorkerExecutableUnit;
      }
    | undefined
  >;
  claimUnit(taskId: string, unitId: string): Promise<boolean>;
  startUnitAttempt(unitId: string, attemptNumber: number): Promise<void>;
  loadPreviousFailedUnitAttempt(
    unitId: string,
    attemptNumber: number
  ): Promise<WorkerFailedUnitAttempt | undefined>;
  updateUnitAttemptProviderRequestId(
    unitId: string,
    attemptNumber: number,
    providerRequestId: string
  ): Promise<void>;
  isUnitCancelled(taskId: string, unitId: string): Promise<boolean>;
  failUnitAttempt(
    unitId: string,
    attemptNumber: number,
    error: WorkerAttemptFailure
  ): Promise<void>;
  completeUnitAttempt(unitId: string, attemptNumber: number): Promise<void>;
  markLateResultDiscarded(unitId: string, attemptNumber: number): Promise<void>;
  markSubjectCheckEnqueued(checkId: string): Promise<void>;
  markUnitSucceeded(
    taskId: string,
    unitId: string,
    output: WorkerOutputAsset,
    consistency?: {
      requirementRunId: string;
      sourceProductAssetIds: string[];
      inspectionModel: string;
      requirementModel: string;
      workflowVersion: string;
    }
  ): Promise<string[]>;
  markUnitFailed(unitId: string, error: ImageGenerationError): Promise<void>;
  markQueueDeliveryFailed(unitId: string): Promise<void>;
  findRecoverableUnits(): Promise<Array<{ taskId: string; unitId: string }>>;
}

export class WorkerTaskDataError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "WorkerTaskDataError";
  }
}

export class DrizzleImageGenerationTaskStore implements ImageGenerationTaskStore {
  private readonly runCoordinator: CreationRunCoordinator;

  public constructor(private readonly connection: DatabaseConnection) {
    this.runCoordinator = new CreationRunCoordinator(connection);
  }

  public async load(taskId: string): Promise<WorkerGenerationTask | undefined> {
    const [task] = await this.connection.db
      .select()
      .from(generationTasks)
      .where(eq(generationTasks.id, taskId))
      .limit(1);
    if (!task) return undefined;

    if (task.status !== "queued" && task.status !== "running") {
      return {
        id: task.id,
        userId: task.userId,
        projectId: task.projectId,
        modelId: task.modelId,
        requirementRunId: task.requirementRunId,
        sessionId: task.sessionId,
        stateSnapshotId: task.stateSnapshotId,
        status: task.status,
        requirement: null,
        instruction: null,
        sourceAssets: [],
        units: []
      };
    }

    const [run] = await this.connection.db
      .select()
      .from(requirementRuns)
      .where(eq(requirementRuns.id, task.requirementRunId))
      .limit(1);
    if (!run) {
      throw new WorkerTaskDataError(
        "REQUIREMENT_RUN_NOT_AVAILABLE",
        "生图任务对应的需求记录不存在"
      );
    }

    const request = resolveRequirementRequestSchema.safeParse(run.request);
    const result = requirementResultSchema.safeParse(run.result);
    if (!request.success || !result.success || result.data.status !== "ready") {
      throw new WorkerTaskDataError(
        "REQUIREMENT_RUN_NOT_AVAILABLE",
        "生图任务对应的需求记录不可用"
      );
    }
    if (
      task.kind !== "image" ||
      task.userId !== run.userId ||
      task.projectId !== run.projectId ||
      task.projectId !== request.data.projectId ||
      task.modelId !== request.data.modelId
    ) {
      throw new WorkerTaskDataError(
        "IMAGE_GENERATION_TASK_DATA_CONFLICT",
        "生图任务、需求记录与项目数据不一致"
      );
    }

    const unitRows = await this.connection.db
      .select()
      .from(generationTaskUnits)
      .where(eq(generationTaskUnits.taskId, taskId))
      .orderBy(asc(generationTaskUnits.position));
    const unitSourceRows =
      unitRows.length === 0
        ? []
        : await this.connection.db
            .select()
            .from(generationTaskUnitSources)
            .where(
              inArray(
                generationTaskUnitSources.unitId,
                unitRows.map((unit) => unit.id)
              )
            )
            .orderBy(
              asc(generationTaskUnitSources.unitId),
              asc(generationTaskUnitSources.position)
            );
    const unitQualitySourceRows =
      unitRows.length === 0
        ? []
        : await this.connection.db
            .select()
            .from(generationTaskUnitQualitySources)
            .where(
              inArray(
                generationTaskUnitQualitySources.unitId,
                unitRows.map((unit) => unit.id)
              )
            )
            .orderBy(
              asc(generationTaskUnitQualitySources.unitId),
              asc(generationTaskUnitQualitySources.position)
            );
    const orderedSources = [
      ...(request.data.editBaseImageId
        ? [{ id: request.data.editBaseImageId, role: "edit_base" as const }]
        : []),
      ...request.data.productImageIds.map((id) => ({ id, role: "product" as const })),
      ...request.data.referenceImageIds.map((id) => ({ id, role: "reference" as const }))
    ];
    const uniqueSourceIds = [
      ...new Set([
        ...orderedSources.map((source) => source.id),
        ...unitSourceRows.map((source) => source.assetId),
        ...unitQualitySourceRows.map((source) => source.assetId)
      ])
    ];
    const watermarkAssetId = request.data.deliverySettings.watermark.assetId;
    const assetIds = [
      ...new Set([...uniqueSourceIds, ...(watermarkAssetId ? [watermarkAssetId] : [])])
    ];
    const rows =
      assetIds.length === 0
        ? []
        : await this.connection.db
            .select()
            .from(mediaAssets)
            .where(inArray(mediaAssets.id, assetIds));
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    for (const source of unitQualitySourceRows) {
      const asset = rowsById.get(source.assetId);
      if (
        !asset ||
        asset.userId !== task.userId ||
        asset.projectId !== task.projectId ||
        asset.kind !== "image"
      ) {
        throw new WorkerTaskDataError(
          "QUALITY_SOURCE_IMAGE_NOT_AVAILABLE",
          "生图单元对应的商品质检原图不存在，或不属于当前任务"
        );
      }
    }
    const sourceAssets: WorkerSourceAsset[] = orderedSources.map(({ id, role }) => {
      const asset = rowsById.get(id);
      if (
        !asset ||
        asset.userId !== task.userId ||
        asset.projectId !== task.projectId ||
        asset.kind !== "image"
      ) {
        throw new WorkerTaskDataError(
          "SOURCE_IMAGE_NOT_AVAILABLE",
          "部分商品图或参考图不存在，或不属于当前任务"
        );
      }
      return { id: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType, role };
    });
    const watermark = watermarkAssetId ? rowsById.get(watermarkAssetId) : undefined;
    if (
      request.data.deliverySettings.watermark.enabled &&
      (!watermark ||
        watermark.userId !== task.userId ||
        watermark.projectId !== task.projectId ||
        watermark.kind !== "image")
    ) {
      throw new WorkerTaskDataError(
        "WATERMARK_IMAGE_NOT_AVAILABLE",
        "水印 Logo 不存在，或不属于当前任务"
      );
    }
    const brandLogoSource =
      request.data.deliverySettings.watermark.enabled && watermark
        ? {
            id: watermark.id,
            storageKey: watermark.storageKey,
            mimeType: watermark.mimeType,
            role: "brand_logo" as const
          }
        : null;
    if (brandLogoSource) sourceAssets.push(brandLogoSource);
    const readyRequirement = result.data.status === "ready" ? result.data.finalRequirement : null;
    if (!readyRequirement) {
      throw new WorkerTaskDataError(
        "REQUIREMENT_RUN_NOT_AVAILABLE",
        "生图任务对应的需求记录不可用"
      );
    }
    const units = unitRows.map((unit) => {
      const frozenInstruction = unit.instruction?.trim();
      if (!frozenInstruction) {
        throw new WorkerTaskDataError(
          "GENERATION_EXECUTION_PLAN_UNAVAILABLE",
          "生图单元缺少冻结执行指令，不能沿用旧请求重新生成"
        );
      }
      const unitRequirement = unit.requirementSnapshot
        ? finalRequirementSchema.parse(unit.requirementSnapshot)
        : { ...readyRequirement, imageCount: 1 };
      const unitSourceAssets = unitSourceRows
        .filter((source) => source.unitId === unit.id)
        .map((source) => {
          const asset = rowsById.get(source.assetId);
          if (
            !asset ||
            asset.userId !== task.userId ||
            asset.projectId !== task.projectId ||
            asset.kind !== "image"
          ) {
            throw new WorkerTaskDataError(
              "SOURCE_IMAGE_NOT_AVAILABLE",
              "生图单元引用的图片不存在，或不属于当前任务"
            );
          }
          return {
            id: asset.id,
            storageKey: asset.storageKey,
            mimeType: asset.mimeType,
            role: toProviderSourceRole(source.sourceRole, source.usage)
          };
        });
      const hasStoredBrandLogo = unitSourceAssets.some((source) => source.role === "brand_logo");
      if (brandLogoSource && !hasStoredBrandLogo) {
        unitSourceAssets.push(brandLogoSource);
      }
      return {
        id: unit.id,
        position: unit.position,
        status: unit.status,
        instruction:
          brandLogoSource && !hasStoredBrandLogo
            ? `${frozenInstruction}\n${buildBrandLogoInstruction(
                unitSourceAssets.length,
                request.data.deliverySettings.watermark.position
              )}`
            : frozenInstruction,
        requirement: unitRequirement,
        outputLayout: unit.outputLayout,
        sourceAssets: unitSourceAssets,
        qualitySourceAssetIds: unitQualitySourceRows
          .filter((source) => source.unitId === unit.id)
          .map((source) => source.assetId)
      };
    });

    return {
      id: task.id,
      userId: task.userId,
      projectId: task.projectId,
      modelId: task.modelId,
      requirementRunId: task.requirementRunId,
      sessionId: task.sessionId,
      stateSnapshotId: task.stateSnapshotId,
      status: task.status,
      requirement: result.data.finalRequirement,
      renderSettings: request.data.renderSettings,
      deliverySettings: request.data.deliverySettings,
      watermarkAsset: watermark
        ? { id: watermark.id, storageKey: watermark.storageKey, mimeType: watermark.mimeType }
        : null,
      instruction: task.instruction,
      sourceAssets,
      units
    };
  }

  public async loadUnit(
    taskId: string,
    unitId: string
  ): Promise<{ task: WorkerExecutableTask; unit: WorkerExecutableUnit } | undefined> {
    const task = await this.load(taskId);
    if (!task || (task.status !== "queued" && task.status !== "running")) return undefined;
    const unit = task.units?.find((candidate) => candidate.id === unitId);
    if (!unit) return undefined;
    return { task, unit };
  }

  public async claimUnit(taskId: string, unitId: string): Promise<boolean> {
    const claimed = await this.connection.db.transaction(async (transaction) => {
      await transaction
        .update(generationTasks)
        .set({ status: "running", errorCode: null, errorMessage: null, updatedAt: new Date() })
        .where(and(eq(generationTasks.id, taskId), eq(generationTasks.status, "queued")));
      const [unit] = await transaction
        .select({ status: generationTaskUnits.status, taskId: generationTaskUnits.taskId })
        .from(generationTaskUnits)
        .where(eq(generationTaskUnits.id, unitId))
        .limit(1);
      if (!unit || unit.taskId !== taskId || !["queued", "running"].includes(unit.status)) {
        return false;
      }
      if (unit.status === "queued") {
        await transaction
          .update(generationTaskUnits)
          .set({ status: "running", errorCode: null, errorMessage: null, updatedAt: new Date() })
          .where(and(eq(generationTaskUnits.id, unitId), eq(generationTaskUnits.status, "queued")));
      }
      return true;
    });
    if (claimed) await this.runCoordinator.markRunningByTaskId(taskId);
    return claimed;
  }

  public async startUnitAttempt(unitId: string, attemptNumber: number): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      const now = new Date();
      await transaction
        .insert(generationUnitAttempts)
        .values({ unitId, attemptNumber, status: "running", startedAt: now })
        .onConflictDoUpdate({
          target: [generationUnitAttempts.unitId, generationUnitAttempts.attemptNumber],
          set: {
            status: "running",
            providerRequestId: null,
            errorCode: null,
            errorMessage: null,
            failureStage: null,
            errorDetails: null,
            completedAt: null,
            startedAt: now
          }
        });
      const [unit] = await transaction
        .update(generationTaskUnits)
        .set({ updatedAt: now })
        .where(eq(generationTaskUnits.id, unitId))
        .returning({ taskId: generationTaskUnits.taskId });
      if (unit) {
        await transaction
          .update(generationTasks)
          .set({ updatedAt: now })
          .where(eq(generationTasks.id, unit.taskId));
      }
    });
  }

  public async loadPreviousFailedUnitAttempt(
    unitId: string,
    attemptNumber: number
  ): Promise<WorkerFailedUnitAttempt | undefined> {
    if (attemptNumber <= 1) return undefined;
    const [attempt] = await this.connection.db
      .select({
        providerRequestId: generationUnitAttempts.providerRequestId,
        failureStage: generationUnitAttempts.failureStage,
        errorCode: generationUnitAttempts.errorCode
      })
      .from(generationUnitAttempts)
      .where(
        and(
          eq(generationUnitAttempts.unitId, unitId),
          eq(generationUnitAttempts.attemptNumber, attemptNumber - 1),
          eq(generationUnitAttempts.status, "failed")
        )
      )
      .limit(1);
    if (!attempt) return undefined;
    const failureStage = normalizeFailureStage(attempt.failureStage, attempt.errorCode);
    return {
      ...(attempt.providerRequestId ? { providerRequestId: attempt.providerRequestId } : {}),
      ...(failureStage ? { failureStage } : {}),
      ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {})
    };
  }

  public async updateUnitAttemptProviderRequestId(
    unitId: string,
    attemptNumber: number,
    providerRequestId: string
  ): Promise<void> {
    await this.connection.db
      .update(generationUnitAttempts)
      .set({ providerRequestId })
      .where(
        and(
          eq(generationUnitAttempts.unitId, unitId),
          eq(generationUnitAttempts.attemptNumber, attemptNumber),
          eq(generationUnitAttempts.status, "running")
        )
      );
  }

  public async isUnitCancelled(taskId: string, unitId: string): Promise<boolean> {
    const [row] = await this.connection.db
      .select({ taskStatus: generationTasks.status, unitStatus: generationTaskUnits.status })
      .from(generationTaskUnits)
      .innerJoin(generationTasks, eq(generationTaskUnits.taskId, generationTasks.id))
      .where(and(eq(generationTasks.id, taskId), eq(generationTaskUnits.id, unitId)))
      .limit(1);
    return !row || row.taskStatus === "cancelled" || row.unitStatus === "cancelled";
  }

  public async failUnitAttempt(
    unitId: string,
    attemptNumber: number,
    error: WorkerAttemptFailure
  ): Promise<void> {
    await this.connection.db
      .update(generationUnitAttempts)
      .set({
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
        failureStage: error.stage ?? null,
        errorDetails: error.details ?? null,
        completedAt: new Date()
      })
      .where(
        and(
          eq(generationUnitAttempts.unitId, unitId),
          eq(generationUnitAttempts.attemptNumber, attemptNumber),
          eq(generationUnitAttempts.status, "running")
        )
      );
  }

  public async completeUnitAttempt(unitId: string, attemptNumber: number): Promise<void> {
    await this.connection.db
      .update(generationUnitAttempts)
      .set({ status: "succeeded", errorCode: null, errorMessage: null, completedAt: new Date() })
      .where(
        and(
          eq(generationUnitAttempts.unitId, unitId),
          eq(generationUnitAttempts.attemptNumber, attemptNumber),
          eq(generationUnitAttempts.status, "running")
        )
      );
  }

  public async markLateResultDiscarded(unitId: string, attemptNumber: number): Promise<void> {
    await this.connection.db
      .update(generationUnitAttempts)
      .set({ lateResultDiscardedAt: new Date() })
      .where(
        and(
          eq(generationUnitAttempts.unitId, unitId),
          eq(generationUnitAttempts.attemptNumber, attemptNumber)
        )
      );
  }

  public async markSubjectCheckEnqueued(checkId: string): Promise<void> {
    await this.connection.db
      .update(workflowEvents)
      .set({ publishedAt: new Date(), lastError: null })
      .where(
        and(
          eq(workflowEvents.eventType, "subject.check.enqueue"),
          eq(workflowEvents.entityId, checkId),
          isNull(workflowEvents.publishedAt)
        )
      );
  }

  public async markUnitSucceeded(
    taskId: string,
    unitId: string,
    output: WorkerOutputAsset,
    consistency?: {
      requirementRunId: string;
      sourceProductAssetIds: string[];
      inspectionModel: string;
      requirementModel: string;
      workflowVersion: string;
    }
  ): Promise<string[]> {
    const checkId = consistency ? randomUUID() : null;
    let queuedCheckIds: string[] = [];
    await this.connection.db.transaction(async (transaction) => {
      const [unit] = await transaction
        .select({ status: generationTaskUnits.status, position: generationTaskUnits.position })
        .from(generationTaskUnits)
        .where(and(eq(generationTaskUnits.id, unitId), eq(generationTaskUnits.taskId, taskId)))
        .limit(1);
      if (!unit || !["queued", "running"].includes(unit.status)) {
        throw new WorkerTaskDataError(
          "INVALID_IMAGE_GENERATION_UNIT_TRANSITION",
          "生图单元状态不允许标记成功"
        );
      }
      const [task] = await transaction
        .select({
          creationRunId: generationTasks.creationRunId,
          sessionId: generationTasks.sessionId,
          requirementRunId: generationTasks.requirementRunId
        })
        .from(generationTasks)
        .where(eq(generationTasks.id, taskId))
        .limit(1);
      if (!task) throw new WorkerTaskDataError("IMAGE_GENERATION_TASK_NOT_FOUND", "生图任务不存在");
      const [repair] = await transaction
        .select({
          checkId: subjectConsistencyRepairs.checkId,
          originalGeneratedAssetId: subjectConsistencyChecks.generatedAssetId
        })
        .from(subjectConsistencyRepairs)
        .innerJoin(
          subjectConsistencyChecks,
          eq(subjectConsistencyRepairs.checkId, subjectConsistencyChecks.id)
        )
        .where(eq(subjectConsistencyRepairs.generationTaskId, taskId))
        .limit(1);

      await transaction.insert(mediaAssets).values({
        id: output.id,
        userId: output.userId,
        projectId: output.projectId,
        kind: "image",
        origin: "generated",
        contentSha256: null,
        storageKey: output.storageKey,
        mimeType: output.mimeType,
        byteSize: output.byteSize,
        originalFileName: output.originalFileName,
        createdAt: output.createdAt
      });
      await transaction.insert(generationTaskOutputs).values({
        taskId,
        assetId: output.id,
        unitId,
        position: unit.position,
        status: consistency || repair ? "candidate" : "deliverable",
        deliverableAssetId: consistency || repair ? null : output.id,
        updatedAt: output.createdAt
      });
      await transaction
        .update(generationTaskUnits)
        .set({
          status: "succeeded",
          errorCode: null,
          errorMessage: null,
          updatedAt: output.createdAt
        })
        .where(eq(generationTaskUnits.id, unitId));

      if (task.sessionId) {
        const [run] = await transaction
          .select({ sourceMessageId: requirementRuns.sourceMessageId })
          .from(requirementRuns)
          .where(eq(requirementRuns.id, task.requirementRunId))
          .limit(1);
        const [sourceMessage] = run?.sourceMessageId
          ? await transaction
              .select({ turnNumber: conversationMessages.turnNumber })
              .from(conversationMessages)
              .where(eq(conversationMessages.id, run.sourceMessageId))
              .limit(1)
          : [];
        const [assistantMessage] = sourceMessage
          ? await transaction
              .select({ id: conversationMessages.id })
              .from(conversationMessages)
              .where(
                and(
                  eq(conversationMessages.sessionId, task.sessionId),
                  eq(conversationMessages.turnNumber, sourceMessage.turnNumber),
                  eq(conversationMessages.role, "assistant")
                )
              )
              .limit(1)
          : [];
        if (assistantMessage && !repair && !consistency) {
          await transaction.insert(conversationMessageAssets).values({
            messageId: assistantMessage.id,
            assetId: output.id,
            role: "generated_result",
            position: unit.position,
            relation: `generation-task:${taskId}`,
            createdAt: output.createdAt
          });
        }
      }

      if (repair) {
        await transaction
          .update(generationTaskOutputs)
          .set({
            status: "superseded",
            supersededByAssetId: output.id,
            rejectionCode: null,
            updatedAt: output.createdAt
          })
          .where(eq(generationTaskOutputs.assetId, repair.originalGeneratedAssetId));
        await transaction
          .update(subjectConsistencyRepairs)
          .set({ generatedAssetId: output.id, updatedAt: output.createdAt })
          .where(eq(subjectConsistencyRepairs.generationTaskId, taskId));
        await transaction
          .update(subjectConsistencyChecks)
          .set({
            status: "queued",
            phase: "final_inspection",
            userMessage: "修复图片已生成，正在进行第二次主体质检",
            errorCode: null,
            errorMessage: null,
            updatedAt: output.createdAt
          })
          .where(
            and(
              eq(subjectConsistencyChecks.id, repair.checkId),
              inArray(subjectConsistencyChecks.status, ["queued", "running"])
            )
          );
        queuedCheckIds = [repair.checkId];
      } else if (consistency && checkId) {
        await transaction.insert(subjectConsistencyChecks).values({
          id: checkId,
          userId: output.userId,
          projectId: output.projectId,
          generationTaskId: taskId,
          generationUnitId: unitId,
          requirementRunId: consistency.requirementRunId,
          generatedAssetId: output.id,
          status: "queued",
          phase: "initial_inspection",
          inspectionModel: consistency.inspectionModel,
          requirementModel: consistency.requirementModel,
          workflowVersion: consistency.workflowVersion,
          createdAt: output.createdAt,
          updatedAt: output.createdAt
        });
        await transaction.insert(subjectConsistencyCheckSources).values(
          consistency.sourceProductAssetIds.map((assetId, position) => ({
            checkId,
            assetId,
            position
          }))
        );
        queuedCheckIds = [checkId];
      }

      if (queuedCheckIds.length > 0) {
        await transaction
          .select({ id: creationRuns.id })
          .from(creationRuns)
          .where(eq(creationRuns.id, task.creationRunId))
          .limit(1)
          .for("update");
        const [lastEvent] = await transaction
          .select({ sequence: workflowEvents.sequence })
          .from(workflowEvents)
          .where(eq(workflowEvents.runId, task.creationRunId))
          .orderBy(desc(workflowEvents.sequence))
          .limit(1);
        await transaction.insert(workflowEvents).values(
          queuedCheckIds.map((queuedCheckId, index) => ({
            runId: task.creationRunId,
            sequence: (lastEvent?.sequence ?? 0) + index + 1,
            eventType: "subject.check.enqueue",
            entityType: "subject_consistency_check",
            entityId: queuedCheckId,
            payload: { checkId: queuedCheckId }
          }))
        );
      }

      const unitStatuses = await transaction
        .select({ status: generationTaskUnits.status })
        .from(generationTaskUnits)
        .where(eq(generationTaskUnits.taskId, taskId));
      const pending = unitStatuses.some(
        (candidate) => candidate.status === "queued" || candidate.status === "running"
      );
      const succeeded = unitStatuses.some((candidate) => candidate.status === "succeeded");
      await transaction
        .update(generationTasks)
        .set({
          status: pending ? "running" : succeeded ? "succeeded" : "failed",
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date()
        })
        .where(eq(generationTasks.id, taskId));
    });
    await this.runCoordinator.finalizeByTaskId(taskId);
    return queuedCheckIds;
  }

  public async markUnitFailed(unitId: string, error: ImageGenerationError): Promise<void> {
    const [updated] = await this.connection.db
      .update(generationTaskUnits)
      .set({
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(generationTaskUnits.id, unitId),
          inArray(generationTaskUnits.status, ["queued", "running"])
        )
      )
      .returning({ taskId: generationTaskUnits.taskId });
    if (!updated) return;
    const units = await this.connection.db
      .select({
        status: generationTaskUnits.status,
        errorCode: generationTaskUnits.errorCode,
        errorMessage: generationTaskUnits.errorMessage
      })
      .from(generationTaskUnits)
      .where(eq(generationTaskUnits.taskId, updated.taskId));
    const pending = units.some((unit) => unit.status === "queued" || unit.status === "running");
    const succeeded = units.some((unit) => unit.status === "succeeded");
    const firstFailure = units.find((unit) => unit.status === "failed");
    await this.connection.db
      .update(generationTasks)
      .set({
        status: pending ? "running" : succeeded ? "succeeded" : "failed",
        errorCode: pending || succeeded ? null : (firstFailure?.errorCode ?? error.code),
        errorMessage: pending || succeeded ? null : (firstFailure?.errorMessage ?? error.message),
        updatedAt: new Date()
      })
      .where(eq(generationTasks.id, updated.taskId));
    await this.runCoordinator.finalizeByTaskId(updated.taskId);
  }

  public async markQueueDeliveryFailed(unitId: string): Promise<void> {
    await this.markUnitFailed(unitId, {
      code: "IMAGE_GENERATION_QUEUE_UNAVAILABLE",
      message: "生图任务队列投递失败，已达到自动恢复上限"
    });
  }

  public async findRecoverableUnits(): Promise<Array<{ taskId: string; unitId: string }>> {
    return this.connection.db
      .select({ taskId: generationTaskUnits.taskId, unitId: generationTaskUnits.id })
      .from(generationTaskUnits)
      .innerJoin(generationTasks, eq(generationTaskUnits.taskId, generationTasks.id))
      .where(
        and(
          inArray(generationTasks.status, ["queued", "running"]),
          inArray(generationTaskUnits.status, ["queued", "running"])
        )
      );
  }
}

function normalizeFailureStage(
  stage: string | null,
  errorCode: string | null
): WorkerFailedUnitAttempt["failureStage"] {
  if (["submission", "polling", "download", "validation"].includes(stage ?? "")) {
    return stage as WorkerFailedUnitAttempt["failureStage"];
  }
  // Compatibility for attempts written before failure_stage was introduced.
  if (errorCode === "IMAGE_DOWNLOAD_FAILED") return "download";
  return undefined;
}

function toProviderSourceRole(sourceRole: string, usage: string): SourceImageRole {
  if (sourceRole === "brand_logo" || usage === "brand_mark") return "brand_logo";
  if (usage === "edit_target") return "edit_base";
  if (usage === "style_reference" || sourceRole === "user_reference") return "reference";
  if (["edit_base", "generated_result", "selected_result"].includes(sourceRole)) {
    return "edit_base";
  }
  return "product";
}
