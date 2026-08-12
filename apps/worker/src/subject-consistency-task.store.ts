import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  conversationMessageAssets,
  conversationMessages,
  creationRuns,
  generationTaskOutputs,
  generationTaskUnitQualitySources,
  generationTaskUnits,
  generationTaskUnitSources,
  generationUnitSubjectEntities,
  generationUnitSubjectEntitySources,
  generationTasks,
  mediaAssets,
  requirementRuns,
  subjectConsistencyAttempts,
  subjectConsistencyCheckSources,
  subjectConsistencyChecks,
  subjectConsistencyRepairs,
  workflowEvents,
  type DatabaseConnection
} from "@chaoren/database";
import {
  finalRequirementSchema,
  requirementResultSchema,
  resolvedGenerationPlanSchema,
  resolveRequirementRequestSchema,
  subjectInspectionResultSchema,
  subjectRequirementReconciliationSchema,
  type FinalRequirement,
  type ImageDeliverySettings,
  type SubjectConsistencyPhase,
  type SubjectConsistencyStatus,
  type SubjectInspectionResult,
  type SubjectRequirementReconciliation
} from "@chaoren/contracts";
import {
  buildImageGenerationInstruction,
  IMAGE_GENERATION_INSTRUCTION_VERSION
} from "@chaoren/image-generation";
import { SUBJECT_RECONCILIATION_PROMPT_VERSION } from "@chaoren/subject-consistency";

import { CreationRunCoordinator } from "./creation-run.coordinator.js";

export interface WorkerSubjectAsset {
  id: string;
  storageKey: string;
  mimeType: string;
}

export interface WorkerSubjectConsistencyTask {
  id: string;
  userId: string;
  projectId: string;
  generationTaskId: string;
  requirementRunId: string;
  status: SubjectConsistencyStatus;
  phase: SubjectConsistencyPhase;
  originalUserText: string;
  originalRequirement: FinalRequirement;
  sourceProducts: WorkerSubjectAsset[];
  subjectEntities: Array<{
    entityKey: string;
    label: string | null;
    sourceProductIds: string[];
  }>;
  generatedCandidate: WorkerSubjectAsset;
  watermarkAsset: WorkerSubjectAsset | null;
  deliverySettings: ImageDeliverySettings;
  repair: {
    generationTaskId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    generatedCandidate: WorkerSubjectAsset | null;
    error: { code: string; message: string } | null;
  } | null;
  attempts: Array<{
    round: 1 | 2;
    requirement: FinalRequirement;
    result: SubjectInspectionResult;
  }>;
  reconciliation: SubjectRequirementReconciliation | null;
}

export interface SubjectConsistencyTaskStore {
  load(checkId: string): Promise<WorkerSubjectConsistencyTask | undefined>;
  claim(checkId: string): Promise<boolean>;
  isCancelled(checkId: string): Promise<boolean>;
  saveAttempt(
    checkId: string,
    round: 1 | 2,
    requirement: FinalRequirement,
    result: SubjectInspectionResult,
    model: string,
    promptVersion: string
  ): Promise<void>;
  saveReconciliation(
    checkId: string,
    reconciliation: SubjectRequirementReconciliation
  ): Promise<void>;
  createOrFindRepair(
    checkId: string,
    requirement: FinalRequirement
  ): Promise<{ generationTaskId: string; generationUnitId?: string; created: boolean }>;
  markRepairEnqueued(generationTaskId: string, generationUnitId?: string): Promise<void>;
  markSourceUnusable(checkId: string, message: string): Promise<void>;
  complete(
    checkId: string,
    verdict: "passed" | "rejected",
    message: string,
    delivery?: {
      sourceAssetId: string;
      assetId: string;
      newAsset?: {
        id: string;
        userId: string;
        projectId: string;
        storageKey: string;
        mimeType: string;
        byteSize: number;
        originalFileName: string;
        createdAt: Date;
      };
    }
  ): Promise<void>;
  markExecutionFailed(checkId: string, error: { code: string; message: string }): Promise<void>;
  findRecoverableIds(): Promise<string[]>;
}

export class SubjectConsistencyTaskDataError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SubjectConsistencyTaskDataError";
  }
}

export class DrizzleSubjectConsistencyTaskStore implements SubjectConsistencyTaskStore {
  private readonly runCoordinator: CreationRunCoordinator;

  public constructor(private readonly connection: DatabaseConnection) {
    this.runCoordinator = new CreationRunCoordinator(connection);
  }

  public async load(checkId: string): Promise<WorkerSubjectConsistencyTask | undefined> {
    const [check] = await this.connection.db
      .select()
      .from(subjectConsistencyChecks)
      .where(eq(subjectConsistencyChecks.id, checkId))
      .limit(1);
    if (!check) return undefined;

    const [task] = await this.connection.db
      .select()
      .from(generationTasks)
      .where(eq(generationTasks.id, check.generationTaskId))
      .limit(1);
    const [run] = await this.connection.db
      .select()
      .from(requirementRuns)
      .where(eq(requirementRuns.id, check.requirementRunId))
      .limit(1);
    if (!task || !run) {
      throw new SubjectConsistencyTaskDataError(
        "SUBJECT_CHECK_LINEAGE_NOT_AVAILABLE",
        "主体质检对应的生图任务或需求记录不存在"
      );
    }

    const request = resolveRequirementRequestSchema.safeParse(run.request);
    const requirementResult = requirementResultSchema.safeParse(run.result);
    if (
      !request.success ||
      !requirementResult.success ||
      requirementResult.data.status !== "ready"
    ) {
      throw new SubjectConsistencyTaskDataError(
        "SUBJECT_CHECK_REQUIREMENT_NOT_AVAILABLE",
        "主体质检对应的需求记录不可用"
      );
    }
    const sourceRows = await this.connection.db
      .select({ assetId: subjectConsistencyCheckSources.assetId })
      .from(subjectConsistencyCheckSources)
      .where(eq(subjectConsistencyCheckSources.checkId, check.id))
      .orderBy(asc(subjectConsistencyCheckSources.position));
    const sourceProductAssetIds = sourceRows.map((row) => row.assetId);
    const entityRows = check.generationUnitId
      ? await this.connection.db
          .select({
            entityId: generationUnitSubjectEntities.id,
            entityKey: generationUnitSubjectEntities.entityKey,
            label: generationUnitSubjectEntities.label,
            entityPosition: generationUnitSubjectEntities.position,
            assetId: generationUnitSubjectEntitySources.assetId,
            sourcePosition: generationUnitSubjectEntitySources.position
          })
          .from(generationUnitSubjectEntities)
          .leftJoin(
            generationUnitSubjectEntitySources,
            eq(generationUnitSubjectEntitySources.entityId, generationUnitSubjectEntities.id)
          )
          .where(eq(generationUnitSubjectEntities.unitId, check.generationUnitId))
          .orderBy(
            asc(generationUnitSubjectEntities.position),
            asc(generationUnitSubjectEntitySources.position)
          )
      : [];
    const subjectEntities =
      entityRows.length > 0
        ? entityRows
            .filter(
              (entity, index, rows) =>
                rows.findIndex((candidate) => candidate.entityId === entity.entityId) === index
            )
            .map((entity) => ({
              entityKey: entity.entityKey,
              label: entity.label,
              sourceProductIds: entityRows
                .filter((source) => source.entityId === entity.entityId && source.assetId !== null)
                .map((source) => source.assetId!)
            }))
        : [
            {
              entityKey: "legacy_product",
              label: "历史商品主体",
              sourceProductIds: sourceProductAssetIds
            }
          ];
    const entitySourceIds = [
      ...new Set(subjectEntities.flatMap((entity) => entity.sourceProductIds))
    ];

    const [outputRelation] = await this.connection.db
      .select()
      .from(generationTaskOutputs)
      .where(
        and(
          eq(generationTaskOutputs.taskId, task.id),
          eq(generationTaskOutputs.assetId, check.generatedAssetId)
        )
      )
      .limit(1);
    if (
      !outputRelation ||
      task.id !== check.generationTaskId ||
      task.requirementRunId !== run.id ||
      task.userId !== check.userId ||
      task.projectId !== check.projectId ||
      run.userId !== check.userId ||
      run.projectId !== check.projectId ||
      !sameIdSet(sourceProductAssetIds, entitySourceIds)
    ) {
      throw new SubjectConsistencyTaskDataError(
        "SUBJECT_CHECK_LINEAGE_CONFLICT",
        "商品图、生成图、任务和需求记录的数据关系不一致"
      );
    }

    const watermarkAssetId = request.data.deliverySettings.watermark.assetId;
    const assets = await this.connection.db
      .select()
      .from(mediaAssets)
      .where(
        inArray(mediaAssets.id, [
          ...sourceProductAssetIds,
          check.generatedAssetId,
          ...(watermarkAssetId ? [watermarkAssetId] : [])
        ])
      );
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const sources = sourceProductAssetIds.map((assetId) => assetsById.get(assetId));
    const generated = assetsById.get(check.generatedAssetId);
    const watermark = watermarkAssetId ? assetsById.get(watermarkAssetId) : undefined;
    for (const asset of [...sources, generated]) {
      if (
        !asset ||
        asset.userId !== check.userId ||
        asset.projectId !== check.projectId ||
        asset.kind !== "image"
      ) {
        throw new SubjectConsistencyTaskDataError(
          "SUBJECT_CHECK_IMAGE_NOT_AVAILABLE",
          "主体质检所需图片不存在或不属于当前任务"
        );
      }
    }
    if (
      watermarkAssetId &&
      (!watermark ||
        watermark.userId !== check.userId ||
        watermark.projectId !== check.projectId ||
        watermark.kind !== "image")
    ) {
      throw new SubjectConsistencyTaskDataError(
        "WATERMARK_IMAGE_NOT_AVAILABLE",
        "水印 Logo 不存在或不属于当前任务"
      );
    }

    const attemptRows = await this.connection.db
      .select()
      .from(subjectConsistencyAttempts)
      .where(eq(subjectConsistencyAttempts.checkId, checkId))
      .orderBy(asc(subjectConsistencyAttempts.round));
    const [repairRow] = await this.connection.db
      .select()
      .from(subjectConsistencyRepairs)
      .where(eq(subjectConsistencyRepairs.checkId, checkId))
      .limit(1);
    const [repairTask] = repairRow
      ? await this.connection.db
          .select()
          .from(generationTasks)
          .where(eq(generationTasks.id, repairRow.generationTaskId))
          .limit(1)
      : [];
    const [repairAsset] = repairRow?.generatedAssetId
      ? await this.connection.db
          .select()
          .from(mediaAssets)
          .where(eq(mediaAssets.id, repairRow.generatedAssetId))
          .limit(1)
      : [];
    if (
      repairRow &&
      (!repairTask ||
        repairTask.userId !== check.userId ||
        repairTask.projectId !== check.projectId ||
        (repairRow.generatedAssetId &&
          (!repairAsset ||
            repairAsset.userId !== check.userId ||
            repairAsset.projectId !== check.projectId ||
            repairAsset.kind !== "image")))
    ) {
      throw new SubjectConsistencyTaskDataError(
        "SUBJECT_REPAIR_LINEAGE_CONFLICT",
        "主体修复任务与原质检任务的数据关系不一致"
      );
    }

    return {
      id: check.id,
      userId: check.userId,
      projectId: check.projectId,
      generationTaskId: check.generationTaskId,
      requirementRunId: check.requirementRunId,
      status: check.status,
      phase: check.phase,
      originalUserText: request.data.userText,
      originalRequirement: requirementResult.data.finalRequirement,
      sourceProducts: sources.map((source) => ({
        id: source!.id,
        storageKey: source!.storageKey,
        mimeType: source!.mimeType
      })),
      subjectEntities,
      generatedCandidate: {
        id: generated!.id,
        storageKey: generated!.storageKey,
        mimeType: generated!.mimeType
      },
      watermarkAsset: watermark
        ? {
            id: watermark.id,
            storageKey: watermark.storageKey,
            mimeType: watermark.mimeType
          }
        : null,
      deliverySettings: request.data.deliverySettings,
      repair:
        repairRow && repairTask
          ? {
              generationTaskId: repairTask.id,
              status: repairTask.status,
              generatedCandidate: repairAsset
                ? {
                    id: repairAsset.id,
                    storageKey: repairAsset.storageKey,
                    mimeType: repairAsset.mimeType
                  }
                : null,
              error:
                repairTask.errorCode && repairTask.errorMessage
                  ? { code: repairTask.errorCode, message: repairTask.errorMessage }
                  : null
            }
          : null,
      attempts: attemptRows.map((attempt) => ({
        round: attempt.round === 2 ? 2 : 1,
        requirement: finalRequirementSchema.parse(attempt.requirementSnapshot),
        result: subjectInspectionResultSchema.parse(attempt.result)
      })),
      reconciliation: check.reconciliation
        ? subjectRequirementReconciliationSchema.parse(check.reconciliation)
        : null
    };
  }

  public async isCancelled(checkId: string): Promise<boolean> {
    const [row] = await this.connection.db
      .select({ status: subjectConsistencyChecks.status })
      .from(subjectConsistencyChecks)
      .where(eq(subjectConsistencyChecks.id, checkId))
      .limit(1);
    return !row || row.status === "cancelled";
  }

  public async claim(checkId: string): Promise<boolean> {
    const updated = await this.connection.db
      .update(subjectConsistencyChecks)
      .set({
        status: "running",
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(subjectConsistencyChecks.id, checkId),
          inArray(subjectConsistencyChecks.status, ["queued", "running"])
        )
      )
      .returning({ id: subjectConsistencyChecks.id });
    return updated.length === 1;
  }

  public async saveAttempt(
    checkId: string,
    round: 1 | 2,
    requirement: FinalRequirement,
    result: SubjectInspectionResult,
    model: string,
    promptVersion: string
  ): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      const [check] = await transaction
        .select({
          generationTaskId: subjectConsistencyChecks.generationTaskId,
          generatedAssetId: subjectConsistencyChecks.generatedAssetId,
          status: subjectConsistencyChecks.status
        })
        .from(subjectConsistencyChecks)
        .where(eq(subjectConsistencyChecks.id, checkId))
        .limit(1)
        .for("update");
      if (!check || !["queued", "running"].includes(check.status)) return;
      const [repair] =
        round === 2
          ? await transaction
              .select({
                generationTaskId: subjectConsistencyRepairs.generationTaskId,
                generatedAssetId: subjectConsistencyRepairs.generatedAssetId
              })
              .from(subjectConsistencyRepairs)
              .where(eq(subjectConsistencyRepairs.checkId, checkId))
              .limit(1)
          : [];
      await transaction
        .insert(subjectConsistencyAttempts)
        .values({
          checkId,
          round,
          generationTaskId: repair?.generationTaskId ?? check?.generationTaskId,
          generatedAssetId: repair?.generatedAssetId ?? check?.generatedAssetId,
          requirementSnapshot: requirement,
          result,
          model,
          promptVersion
        })
        .onConflictDoNothing();
      await transaction
        .update(subjectConsistencyChecks)
        .set({
          phase:
            round === 2 || result.verdict !== "failed"
              ? "final_inspection"
              : "requirement_reconciliation",
          updatedAt: new Date()
        })
        .where(
          and(
            eq(subjectConsistencyChecks.id, checkId),
            inArray(subjectConsistencyChecks.status, ["queued", "running"])
          )
        );
    });
  }

  public async saveReconciliation(
    checkId: string,
    reconciliation: SubjectRequirementReconciliation
  ): Promise<void> {
    await this.connection.db
      .update(subjectConsistencyChecks)
      .set({ reconciliation, phase: "final_inspection", updatedAt: new Date() })
      .where(
        and(
          eq(subjectConsistencyChecks.id, checkId),
          inArray(subjectConsistencyChecks.status, ["queued", "running"])
        )
      );
  }

  public async createOrFindRepair(
    checkId: string,
    requirement: FinalRequirement
  ): Promise<{ generationTaskId: string; generationUnitId?: string; created: boolean }> {
    const existing = await this.connection.db
      .select({
        generationTaskId: subjectConsistencyRepairs.generationTaskId,
        generationUnitId: generationTaskUnits.id
      })
      .from(subjectConsistencyRepairs)
      .innerJoin(
        generationTaskUnits,
        eq(generationTaskUnits.taskId, subjectConsistencyRepairs.generationTaskId)
      )
      .where(eq(subjectConsistencyRepairs.checkId, checkId))
      .limit(1);
    if (existing[0]) return { ...existing[0], created: false };

    return this.connection.db.transaction(async (transaction) => {
      const [check] = await transaction
        .select()
        .from(subjectConsistencyChecks)
        .where(eq(subjectConsistencyChecks.id, checkId))
        .limit(1)
        .for("update");
      if (!check) {
        throw new SubjectConsistencyTaskDataError(
          "SUBJECT_CONSISTENCY_CHECK_NOT_FOUND",
          "主体质检任务不存在"
        );
      }
      if (!["queued", "running"].includes(check.status)) {
        throw new SubjectConsistencyTaskDataError(
          "SUBJECT_CONSISTENCY_CHECK_CANCELLED",
          "主体质检任务已停止"
        );
      }
      const [concurrentExisting] = await transaction
        .select({
          generationTaskId: subjectConsistencyRepairs.generationTaskId,
          generationUnitId: generationTaskUnits.id
        })
        .from(subjectConsistencyRepairs)
        .innerJoin(
          generationTaskUnits,
          eq(generationTaskUnits.taskId, subjectConsistencyRepairs.generationTaskId)
        )
        .where(eq(subjectConsistencyRepairs.checkId, checkId))
        .limit(1);
      if (concurrentExisting) {
        return { ...concurrentExisting, created: false };
      }
      const [rootTask] = await transaction
        .select()
        .from(generationTasks)
        .where(eq(generationTasks.id, check.generationTaskId))
        .limit(1);
      const [rootRun] = await transaction
        .select()
        .from(requirementRuns)
        .where(eq(requirementRuns.id, check.requirementRunId))
        .limit(1);
      if (!rootTask || !rootRun) {
        throw new SubjectConsistencyTaskDataError(
          "SUBJECT_CHECK_LINEAGE_NOT_AVAILABLE",
          "主体质检对应的生图任务或需求记录不存在"
        );
      }
      const request = resolveRequirementRequestSchema.parse(rootRun.request);
      const storedUnitSources = check.generationUnitId
        ? await transaction
            .select()
            .from(generationTaskUnitSources)
            .where(eq(generationTaskUnitSources.unitId, check.generationUnitId))
            .orderBy(asc(generationTaskUnitSources.position))
        : [];
      const fallbackProductSources =
        storedUnitSources.length > 0
          ? []
          : await transaction
              .select({ assetId: subjectConsistencyCheckSources.assetId })
              .from(subjectConsistencyCheckSources)
              .where(eq(subjectConsistencyCheckSources.checkId, checkId))
              .orderBy(asc(subjectConsistencyCheckSources.position));
      const repairPlanSources =
        storedUnitSources.length > 0
          ? storedUnitSources.map((source, position) => ({
              assetId: source.assetId,
              sourceRole: source.sourceRole,
              usage: source.usage,
              position
            }))
          : fallbackProductSources.map((source, position) => ({
              assetId: source.assetId,
              sourceRole: "product_source",
              usage: "subject_fact",
              position
            }));
      const repairPlan = resolvedGenerationPlanSchema.parse({
        schemaVersion: "1.0",
        summary: "针对质检失败输出的单元修复计划",
        groups: [
          {
            sourceImages: repairPlanSources,
            outputCount: 1,
            outputLayout: "separate_image",
            instruction: "仅修复质检指出的主体差异，不扩大用户原始修改范围"
          }
        ]
      });
      const repairRequest = resolveRequirementRequestSchema.parse({
        ...request,
        imageSettings: { ...request.imageSettings, imageCount: 1 },
        productImageIds: repairPlanSources
          .filter((source) => source.sourceRole === "product_source")
          .map((source) => source.assetId),
        referenceImageIds: repairPlanSources
          .filter((source) => source.sourceRole === "user_reference")
          .map((source) => source.assetId),
        editBaseImageId:
          repairPlanSources.find((source) =>
            ["edit_base", "generated_result", "selected_result"].includes(source.sourceRole)
          )?.assetId ?? null
      });
      const repairedRequirement: FinalRequirement = { ...requirement, imageCount: 1 };
      const requirementRunId = randomUUID();
      const generationTaskId = randomUUID();
      const generationUnitId = randomUUID();
      const now = new Date();

      await transaction.insert(requirementRuns).values({
        id: requirementRunId,
        parentRequirementRunId: rootRun.id,
        userId: rootRun.userId,
        projectId: rootRun.projectId,
        sessionId: rootRun.sessionId,
        sourceMessageId: rootRun.sourceMessageId,
        stateSnapshotId: rootRun.stateSnapshotId,
        request: repairRequest,
        result: {
          schemaVersion: "1.0",
          status: "ready",
          finalRequirement: repairedRequirement,
          conflictDecisions: []
        },
        executionPlan: repairPlan,
        executionPlanHash: createHash("sha256").update(JSON.stringify(repairPlan)).digest("hex"),
        aiModel: check.requirementModel,
        promptVersion: SUBJECT_RECONCILIATION_PROMPT_VERSION,
        createdAt: now
      });
      await transaction.insert(generationTasks).values({
        id: generationTaskId,
        creationRunId: rootTask.creationRunId,
        userId: rootTask.userId,
        projectId: rootTask.projectId,
        requirementRunId,
        sessionId: rootTask.sessionId,
        stateSnapshotId: rootTask.stateSnapshotId,
        idempotencyKey: generationTaskId,
        kind: "image",
        modelId: rootTask.modelId,
        instruction: buildImageGenerationInstruction(
          repairedRequirement,
          {
            editBase: repairRequest.editBaseImageId ? 1 : 0,
            product: repairRequest.productImageIds.length,
            reference: repairRequest.referenceImageIds.length
          },
          {
            generationGoal: repairRequest.imageSettings.generationGoal,
            referenceGuidance: repairRequest.referenceGuidance
          }
        ),
        instructionVersion: IMAGE_GENERATION_INSTRUCTION_VERSION,
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      await transaction.insert(generationTaskUnits).values({
        id: generationUnitId,
        taskId: generationTaskId,
        position: 0,
        groupPosition: 0,
        variantPosition: 0,
        outputLayout: "separate_image",
        instruction: buildImageGenerationInstruction(
          repairedRequirement,
          {
            editBase: repairRequest.editBaseImageId ? 1 : 0,
            product: repairRequest.productImageIds.length,
            reference: repairRequest.referenceImageIds.length
          },
          {
            generationGoal: repairRequest.imageSettings.generationGoal,
            referenceGuidance: repairRequest.referenceGuidance
          }
        ),
        status: "queued",
        createdAt: now,
        updatedAt: now
      });
      if (repairPlanSources.length > 0) {
        await transaction.insert(generationTaskUnitSources).values(
          repairPlanSources.map((source) => ({
            unitId: generationUnitId,
            assetId: source.assetId,
            position: source.position,
            sourceRole: source.sourceRole,
            usage: source.usage
          }))
        );
      }
      const qualitySources = await transaction
        .select({ assetId: subjectConsistencyCheckSources.assetId })
        .from(subjectConsistencyCheckSources)
        .where(eq(subjectConsistencyCheckSources.checkId, checkId))
        .orderBy(asc(subjectConsistencyCheckSources.position));
      if (qualitySources.length > 0) {
        await transaction.insert(generationTaskUnitQualitySources).values(
          qualitySources.map((source, position) => ({
            unitId: generationUnitId,
            assetId: source.assetId,
            position
          }))
        );
        const originalEntities = check.generationUnitId
          ? await transaction
              .select({
                entityId: generationUnitSubjectEntities.id,
                productEntityId: generationUnitSubjectEntities.productEntityId,
                entityKey: generationUnitSubjectEntities.entityKey,
                label: generationUnitSubjectEntities.label,
                position: generationUnitSubjectEntities.position,
                assetId: generationUnitSubjectEntitySources.assetId,
                sourcePosition: generationUnitSubjectEntitySources.position
              })
              .from(generationUnitSubjectEntities)
              .leftJoin(
                generationUnitSubjectEntitySources,
                eq(generationUnitSubjectEntitySources.entityId, generationUnitSubjectEntities.id)
              )
              .where(eq(generationUnitSubjectEntities.unitId, check.generationUnitId))
              .orderBy(
                asc(generationUnitSubjectEntities.position),
                asc(generationUnitSubjectEntitySources.position)
              )
          : [];
        if (
          originalEntities.length === 0 ||
          originalEntities.some((entity) => entity.productEntityId === null)
        ) {
          throw new SubjectConsistencyTaskDataError(
            "QUALITY_ENTITY_LINEAGE_MISSING",
            "商品实体缺少可信血缘，请重新选择商品原图后生成"
          );
        }
        const entityDefinitions = originalEntities.filter(
          (entity, index, rows) =>
            rows.findIndex((candidate) => candidate.entityId === entity.entityId) === index
        );
        for (const entity of entityDefinitions) {
          const [storedEntity] = await transaction
            .insert(generationUnitSubjectEntities)
            .values({
              unitId: generationUnitId,
              productEntityId: entity.productEntityId,
              entityKey: entity.entityKey,
              label: entity.label,
              position: entity.position
            })
            .returning({ id: generationUnitSubjectEntities.id });
          const entitySources = originalEntities
            .filter((source) => source.entityId === entity.entityId && source.assetId !== null)
            .map((source) => source.assetId!);
          if (storedEntity && entitySources.length > 0) {
            await transaction.insert(generationUnitSubjectEntitySources).values(
              entitySources.map((assetId, position) => ({
                entityId: storedEntity.id,
                assetId,
                position
              }))
            );
          }
        }
      }
      await transaction.insert(subjectConsistencyRepairs).values({
        checkId,
        requirementRunId,
        generationTaskId,
        createdAt: now,
        updatedAt: now
      });
      await transaction
        .update(subjectConsistencyChecks)
        .set({
          status: "running",
          phase: "repair_generation",
          userMessage: "主体质检未通过，正在根据差异从原始商品图重新生成一次",
          updatedAt: now
        })
        .where(eq(subjectConsistencyChecks.id, checkId));
      await transaction
        .select({ id: creationRuns.id })
        .from(creationRuns)
        .where(eq(creationRuns.id, rootTask.creationRunId))
        .limit(1)
        .for("update");
      const [lastEvent] = await transaction
        .select({ sequence: workflowEvents.sequence })
        .from(workflowEvents)
        .where(eq(workflowEvents.runId, rootTask.creationRunId))
        .orderBy(desc(workflowEvents.sequence))
        .limit(1);
      await transaction.insert(workflowEvents).values({
        runId: rootTask.creationRunId,
        sequence: (lastEvent?.sequence ?? 0) + 1,
        eventType: "generation.unit.enqueue",
        entityType: "generation_unit",
        entityId: generationUnitId,
        payload: { taskId: generationTaskId, unitId: generationUnitId }
      });
      return { generationTaskId, generationUnitId, created: true };
    });
  }

  public async markRepairEnqueued(
    generationTaskId: string,
    generationUnitId?: string
  ): Promise<void> {
    await this.connection.db
      .update(workflowEvents)
      .set({ publishedAt: new Date(), lastError: null })
      .where(
        and(
          eq(
            workflowEvents.eventType,
            generationUnitId ? "generation.unit.enqueue" : "generation.task.enqueue"
          ),
          eq(workflowEvents.entityId, generationUnitId ?? generationTaskId),
          isNull(workflowEvents.publishedAt)
        )
      );
  }

  public async markSourceUnusable(checkId: string, message: string): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      const [check] = await transaction
        .select({ generatedAssetId: subjectConsistencyChecks.generatedAssetId })
        .from(subjectConsistencyChecks)
        .where(eq(subjectConsistencyChecks.id, checkId))
        .limit(1)
        .for("update");
      if (!check) return;
      await transaction
        .update(subjectConsistencyChecks)
        .set({
          status: "source_unusable",
          userMessage: message,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(subjectConsistencyChecks.id, checkId),
            inArray(subjectConsistencyChecks.status, ["queued", "running"])
          )
        );
      await rejectActiveCheckCandidates(
        transaction,
        checkId,
        check.generatedAssetId,
        "SOURCE_UNUSABLE"
      );
    });
    await this.runCoordinator.finalizeByCheckId(checkId);
  }

  public async complete(
    checkId: string,
    verdict: "passed" | "rejected",
    message: string,
    delivery?: {
      sourceAssetId: string;
      assetId: string;
      newAsset?: {
        id: string;
        userId: string;
        projectId: string;
        storageKey: string;
        mimeType: string;
        byteSize: number;
        originalFileName: string;
        createdAt: Date;
      };
    }
  ): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      const [activeCheck] = await transaction
        .select({
          status: subjectConsistencyChecks.status,
          generationTaskId: subjectConsistencyChecks.generationTaskId,
          generationUnitId: subjectConsistencyChecks.generationUnitId,
          generatedAssetId: subjectConsistencyChecks.generatedAssetId,
          requirementRunId: subjectConsistencyChecks.requirementRunId
        })
        .from(subjectConsistencyChecks)
        .where(eq(subjectConsistencyChecks.id, checkId))
        .limit(1)
        .for("update");
      if (!activeCheck || !["queued", "running"].includes(activeCheck.status)) {
        throw new SubjectConsistencyTaskDataError(
          "SUBJECT_CONSISTENCY_CHECK_CANCELLED",
          "主体质检任务已停止"
        );
      }
      if (delivery?.newAsset) {
        await transaction.insert(mediaAssets).values({
          ...delivery.newAsset,
          kind: "image",
          origin: "generated",
          contentSha256: null
        });
      }
      if (verdict === "passed" && delivery) {
        await transaction
          .update(generationTaskOutputs)
          .set({
            status: "deliverable",
            deliverableAssetId: delivery.assetId,
            rejectionCode: null,
            updatedAt: new Date()
          })
          .where(eq(generationTaskOutputs.assetId, delivery.sourceAssetId));
        const [task] = await transaction
          .select({ sessionId: generationTasks.sessionId })
          .from(generationTasks)
          .where(eq(generationTasks.id, activeCheck.generationTaskId))
          .limit(1);
        const [run] = await transaction
          .select({ sourceMessageId: requirementRuns.sourceMessageId })
          .from(requirementRuns)
          .where(eq(requirementRuns.id, activeCheck.requirementRunId))
          .limit(1);
        const [sourceMessage] = run?.sourceMessageId
          ? await transaction
              .select({ turnNumber: conversationMessages.turnNumber })
              .from(conversationMessages)
              .where(eq(conversationMessages.id, run.sourceMessageId))
              .limit(1)
          : [];
        const [assistantMessage] =
          task?.sessionId && sourceMessage
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
        if (assistantMessage) {
          const [unit] = activeCheck.generationUnitId
            ? await transaction
                .select({ position: generationTaskUnits.position })
                .from(generationTaskUnits)
                .where(eq(generationTaskUnits.id, activeCheck.generationUnitId))
                .limit(1)
            : [];
          await transaction
            .insert(conversationMessageAssets)
            .values({
              messageId: assistantMessage.id,
              assetId: delivery.assetId,
              role: "generated_result",
              position: 10_000 + (unit?.position ?? 0),
              relation: `delivery:${checkId}`,
              createdAt: new Date()
            })
            .onConflictDoNothing();
        }
      } else {
        await rejectActiveCheckCandidates(
          transaction,
          checkId,
          activeCheck.generatedAssetId,
          "SUBJECT_CONSISTENCY_REJECTED"
        );
      }
      await transaction
        .update(subjectConsistencyChecks)
        .set({
          status: "completed",
          verdict,
          deliverableAssetId: delivery?.assetId ?? null,
          userMessage: message,
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(subjectConsistencyChecks.id, checkId),
            inArray(subjectConsistencyChecks.status, ["queued", "running"])
          )
        );
    });
    await this.runCoordinator.finalizeByCheckId(checkId);
  }

  public async markExecutionFailed(
    checkId: string,
    error: { code: string; message: string }
  ): Promise<void> {
    await this.connection.db.transaction(async (transaction) => {
      const [check] = await transaction
        .select({ generatedAssetId: subjectConsistencyChecks.generatedAssetId })
        .from(subjectConsistencyChecks)
        .where(eq(subjectConsistencyChecks.id, checkId))
        .limit(1)
        .for("update");
      if (!check) return;
      await transaction
        .update(subjectConsistencyChecks)
        .set({
          status: "execution_failed",
          errorCode: error.code,
          errorMessage: error.message,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(subjectConsistencyChecks.id, checkId),
            inArray(subjectConsistencyChecks.status, ["queued", "running"])
          )
        );
      await rejectActiveCheckCandidates(transaction, checkId, check.generatedAssetId, error.code);
    });
    await this.runCoordinator.finalizeByCheckId(checkId);
  }

  public async findRecoverableIds(): Promise<string[]> {
    const rows = await this.connection.db
      .select({ id: subjectConsistencyChecks.id })
      .from(subjectConsistencyChecks)
      .where(inArray(subjectConsistencyChecks.status, ["queued", "running"]));
    return rows.map((row) => row.id);
  }
}

function sameIdSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

async function rejectActiveCheckCandidates(
  transaction: Pick<DatabaseConnection["db"], "select" | "update">,
  checkId: string,
  originalGeneratedAssetId: string,
  rejectionCode: string
) {
  const [repair] = await transaction
    .select({ generatedAssetId: subjectConsistencyRepairs.generatedAssetId })
    .from(subjectConsistencyRepairs)
    .where(eq(subjectConsistencyRepairs.checkId, checkId))
    .limit(1);
  const rejectedCandidateId = repair?.generatedAssetId ?? originalGeneratedAssetId;
  await transaction
    .update(generationTaskOutputs)
    .set({ status: "rejected", rejectionCode, updatedAt: new Date() })
    .where(
      and(
        eq(generationTaskOutputs.assetId, rejectedCandidateId),
        eq(generationTaskOutputs.status, "candidate")
      )
    );
}
