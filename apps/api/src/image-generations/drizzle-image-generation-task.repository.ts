import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import {
  creationRuns,
  generationTaskOutputs,
  generationTaskRegenerations,
  generationTaskUnitQualitySources,
  generationTaskUnits,
  generationTaskUnitSources,
  generationUnitSubjectEntities,
  generationUnitSubjectEntitySources,
  generationTasks,
  generationUnitAttempts,
  mediaAssets,
  productEntities,
  productEntitySources,
  requirementRuns,
  subjectConsistencyChecks,
  workflowEvents,
  type DatabaseConnection
} from "@chaoren/database";
import { finalRequirementSchema, type ImageGenerationError } from "@chaoren/contracts";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import {
  ActiveImageGenerationExistsError,
  ImageGenerationIdempotencyConflictError,
  ImageGenerationRegenerationSourceChangedError,
  ImageGenerationRegenerationSourceNotFoundError,
  ImageGenerationRegenerationSourceNotReadyError,
  InvalidImageGenerationTaskTransitionError,
  InvalidQualityEntityLineageError,
  type ImageGenerationRegenerationRecord,
  type ImageGenerationUnitRecord,
  type ImageGenerationTaskRecord,
  type ImageGenerationTaskRepository
} from "./image-generation-task.repository.js";

@Injectable()
export class DrizzleImageGenerationTaskRepository implements ImageGenerationTaskRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async createOrFind(record: ImageGenerationTaskRecord): Promise<{
    record: ImageGenerationTaskRecord;
    created: boolean;
  }> {
    return this.createOrFindInternal(record);
  }

  public async createRegenerationOrFind(
    input: ImageGenerationRegenerationRecord
  ): Promise<{ record: ImageGenerationTaskRecord; created: boolean }> {
    assertRegenerationRecordShape(input);
    const stored = await this.createOrFindInternal(input.task, input);
    assertSameRegenerationSource(stored.record, input.task.regeneratedFrom);
    return stored;
  }

  private async createOrFindInternal(
    record: ImageGenerationTaskRecord,
    regeneration?: ImageGenerationRegenerationRecord
  ): Promise<{ record: ImageGenerationTaskRecord; created: boolean }> {
    if (!record.units || record.units.length === 0) {
      throw new Error("生图任务必须包含至少一个冻结执行单元");
    }
    const units = record.units;
    const inserted = await this.connection.db.transaction(async (transaction) => {
      if (record.sessionId) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${record.userId}:${record.sessionId}`}))`
        );
      }
      const [idempotentTask] = await transaction
        .select({ id: generationTasks.id })
        .from(generationTasks)
        .where(
          and(
            eq(generationTasks.userId, record.userId),
            eq(generationTasks.idempotencyKey, record.idempotencyKey)
          )
        )
        .limit(1);
      if (idempotentTask) return [];

      if (regeneration) {
        const source = regeneration.task.regeneratedFrom;
        const [sourceTask] = await transaction
          .select({
            userId: generationTasks.userId,
            projectId: generationTasks.projectId,
            requirementRunId: generationTasks.requirementRunId,
            lifecycleStatus: creationRuns.status
          })
          .from(generationTasks)
          .innerJoin(creationRuns, eq(generationTasks.creationRunId, creationRuns.id))
          .where(eq(generationTasks.id, source.taskId))
          .limit(1);
        if (
          !sourceTask ||
          sourceTask.userId !== record.userId ||
          sourceTask.projectId !== record.projectId
        ) {
          throw new ImageGenerationRegenerationSourceNotFoundError();
        }
        if (sourceTask.lifecycleStatus !== "terminal") {
          throw new ImageGenerationRegenerationSourceNotReadyError();
        }
        const [sourceUnit] = await transaction
          .select({ status: generationTaskUnits.status })
          .from(generationTaskUnits)
          .where(
            and(
              eq(generationTaskUnits.id, source.unitId),
              eq(generationTaskUnits.taskId, source.taskId)
            )
          )
          .limit(1);
        if (!sourceUnit) throw new ImageGenerationRegenerationSourceNotFoundError();
        if (sourceUnit.status !== "succeeded") {
          throw new ImageGenerationRegenerationSourceNotReadyError();
        }
        const [output] = await transaction
          .select({
            status: generationTaskOutputs.status,
            deliverableAssetId: generationTaskOutputs.deliverableAssetId
          })
          .from(generationTaskOutputs)
          .where(
            and(
              eq(generationTaskOutputs.taskId, source.taskId),
              eq(generationTaskOutputs.unitId, source.unitId)
            )
          )
          .limit(1);
        const [check] = await transaction
          .select({ deliverableAssetId: subjectConsistencyChecks.deliverableAssetId })
          .from(subjectConsistencyChecks)
          .where(eq(subjectConsistencyChecks.generationUnitId, source.unitId))
          .orderBy(desc(subjectConsistencyChecks.updatedAt))
          .limit(1);
        const deliverableAssetId = check?.deliverableAssetId ?? output?.deliverableAssetId ?? null;
        const [eligibleOutput] = deliverableAssetId
          ? await transaction
              .select({ assetId: generationTaskOutputs.deliverableAssetId })
              .from(generationTaskOutputs)
              .where(
                and(
                  eq(generationTaskOutputs.status, "deliverable"),
                  eq(generationTaskOutputs.deliverableAssetId, deliverableAssetId)
                )
              )
              .limit(1)
          : [];
        if (!eligibleOutput) throw new ImageGenerationRegenerationSourceNotReadyError();
        if (deliverableAssetId !== source.assetId) {
          throw new ImageGenerationRegenerationSourceChangedError();
        }
        if (
          regeneration.requirementRun.id !== record.requirementRunId ||
          regeneration.requirementRun.parentRequirementRunId !== sourceTask.requirementRunId ||
          regeneration.requirementRun.userId !== record.userId ||
          regeneration.requirementRun.request.projectId !== record.projectId
        ) {
          throw new Error("再次生成的子需求记录与任务不一致");
        }
      }

      if (record.sessionId) {
        const [activeRun] = await transaction
          .select({ id: creationRuns.id })
          .from(creationRuns)
          .where(
            and(
              eq(creationRuns.userId, record.userId),
              eq(creationRuns.sessionId, record.sessionId),
              inArray(creationRuns.status, ["queued", "running", "cancelling"])
            )
          )
          .limit(1);
        if (activeRun) throw new ActiveImageGenerationExistsError();
      }
      if (regeneration) {
        await transaction.insert(requirementRuns).values({
          id: regeneration.requirementRun.id,
          parentRequirementRunId: regeneration.requirementRun.parentRequirementRunId,
          sessionId: regeneration.requirementRun.sessionId ?? null,
          sourceMessageId: regeneration.requirementRun.sourceMessageId ?? null,
          stateSnapshotId: regeneration.requirementRun.stateSnapshotId ?? null,
          userId: regeneration.requirementRun.userId,
          projectId: regeneration.requirementRun.request.projectId,
          request: regeneration.requirementRun.request,
          result: regeneration.requirementRun.result,
          executionPlan: regeneration.requirementRun.executionPlan,
          executionPlanHash: regeneration.requirementRun.executionPlanHash,
          aiModel: regeneration.requirementRun.aiModel,
          promptVersion: regeneration.requirementRun.promptVersion,
          createdAt: new Date(regeneration.requirementRun.createdAt)
        });
      }
      await transaction.insert(creationRuns).values({
        id: record.taskId,
        userId: record.userId,
        projectId: record.projectId,
        sessionId: record.sessionId ?? null,
        requirementRunId: record.requirementRunId,
        status: "queued",
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt)
      });
      const rows = await transaction
        .insert(generationTasks)
        .values({
          id: record.taskId,
          creationRunId: record.taskId,
          userId: record.userId,
          projectId: record.projectId,
          requirementRunId: record.requirementRunId,
          sessionId: record.sessionId ?? null,
          stateSnapshotId: record.stateSnapshotId ?? null,
          idempotencyKey: record.idempotencyKey,
          kind: "image",
          modelId: record.modelId,
          instruction: record.instruction,
          instructionVersion: record.instructionVersion,
          status: "queued",
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt)
        })
        .onConflictDoNothing({
          target: [generationTasks.userId, generationTasks.idempotencyKey]
        })
        .returning({ id: generationTasks.id });
      if (rows.length === 0) {
        await transaction.delete(creationRuns).where(eq(creationRuns.id, record.taskId));
        if (regeneration) {
          await transaction
            .delete(requirementRuns)
            .where(eq(requirementRuns.id, regeneration.requirementRun.id));
        }
        return rows;
      }
      if (rows.length === 1 && record.units && record.units.length > 0) {
        const entityDefinitions = new Map<
          string,
          NonNullable<ImageGenerationUnitRecord["subjectEntities"]>[number]
        >();
        for (const unit of record.units) {
          const sourceById = new Map(unit.sources.map((source) => [source.assetId, source]));
          for (const entity of unit.subjectEntities ?? []) {
            if (!entity.productEntityId) {
              throw new InvalidQualityEntityLineageError("商品实体缺少稳定身份");
            }
            const existingDefinition = entityDefinitions.get(entity.productEntityId);
            if (
              existingDefinition &&
              (!sameIdSet(existingDefinition.sourceAssetIds, entity.sourceAssetIds) ||
                existingDefinition.lineageKind !== entity.lineageKind)
            ) {
              throw new InvalidQualityEntityLineageError("同一商品实体对应了不同的原图血缘");
            }
            entityDefinitions.set(entity.productEntityId, entity);
            if (entity.lineageKind === "legacy_unverified") {
              throw new InvalidQualityEntityLineageError("旧结果缺少可信的商品实体血缘");
            }
            if (entity.lineageKind === "new_product_source") {
              const legal = entity.sourceAssetIds.every((assetId) => {
                const source = sourceById.get(assetId);
                return (
                  source?.sourceRole === "product_source" &&
                  source.usage !== "style_reference" &&
                  source.usage !== "layout_cell"
                );
              });
              if (!legal) {
                throw new InvalidQualityEntityLineageError("新商品实体只能使用本轮商品原图");
              }
              continue;
            }
            const inheritedSource = entity.inheritedFromAssetId
              ? sourceById.get(entity.inheritedFromAssetId)
              : undefined;
            const inheritedByRegeneration = Boolean(
              regeneration &&
              entity.inheritedFromAssetId === regeneration.task.regeneratedFrom.assetId
            );
            if (
              !inheritedByRegeneration &&
              (!inheritedSource ||
                inheritedSource.usage === "style_reference" ||
                inheritedSource.usage === "layout_cell" ||
                !["generated_result", "selected_result", "edit_base"].includes(
                  inheritedSource.sourceRole
                ))
            ) {
              throw new InvalidQualityEntityLineageError("继承商品实体必须来自所选历史成品");
            }
          }
        }
        for (const entity of entityDefinitions.values()) {
          const productEntityId = entity.productEntityId;
          if (!productEntityId) {
            throw new InvalidQualityEntityLineageError("商品实体缺少稳定身份");
          }
          if (entity.lineageKind === "new_product_source") {
            const insertedEntities = await transaction
              .insert(productEntities)
              .values({
                id: productEntityId,
                userId: record.userId,
                projectId: record.projectId,
                label: entity.label,
                status: "active",
                lineageStatus: "trusted",
                createdAt: new Date(record.createdAt),
                updatedAt: new Date(record.updatedAt)
              })
              .onConflictDoNothing({ target: productEntities.id })
              .returning({ id: productEntities.id });
            if (insertedEntities.length === 1) {
              await transaction.insert(productEntitySources).values(
                entity.sourceAssetIds.map((assetId, position) => ({
                  productEntityId,
                  assetId,
                  position
                }))
              );
              continue;
            }
            const [storedEntity] = await transaction
              .select({
                userId: productEntities.userId,
                projectId: productEntities.projectId,
                status: productEntities.status,
                lineageStatus: productEntities.lineageStatus
              })
              .from(productEntities)
              .where(eq(productEntities.id, productEntityId))
              .limit(1);
            const storedSources = await transaction
              .select({ assetId: productEntitySources.assetId })
              .from(productEntitySources)
              .where(eq(productEntitySources.productEntityId, productEntityId))
              .orderBy(asc(productEntitySources.position));
            if (
              !storedEntity ||
              storedEntity.userId !== record.userId ||
              storedEntity.projectId !== record.projectId ||
              storedEntity.status !== "active" ||
              storedEntity.lineageStatus !== "trusted" ||
              !sameIdSet(
                storedSources.map((source) => source.assetId),
                entity.sourceAssetIds
              )
            ) {
              throw new InvalidQualityEntityLineageError("商品实体身份已被不同的原图血缘占用");
            }
            continue;
          }
          const [storedEntity] = await transaction
            .select({
              userId: productEntities.userId,
              projectId: productEntities.projectId,
              status: productEntities.status,
              lineageStatus: productEntities.lineageStatus
            })
            .from(productEntities)
            .where(eq(productEntities.id, productEntityId))
            .limit(1);
          const storedSources = await transaction
            .select({ assetId: productEntitySources.assetId })
            .from(productEntitySources)
            .where(eq(productEntitySources.productEntityId, productEntityId))
            .orderBy(asc(productEntitySources.position));
          const [membership] = await transaction
            .select({ unitId: generationTaskOutputs.unitId })
            .from(generationTaskOutputs)
            .innerJoin(
              generationUnitSubjectEntities,
              eq(generationUnitSubjectEntities.unitId, generationTaskOutputs.unitId)
            )
            .where(
              and(
                eq(generationTaskOutputs.status, "deliverable"),
                eq(generationTaskOutputs.deliverableAssetId, entity.inheritedFromAssetId!),
                eq(generationUnitSubjectEntities.productEntityId, productEntityId)
              )
            )
            .limit(1);
          if (
            !storedEntity ||
            storedEntity.userId !== record.userId ||
            storedEntity.projectId !== record.projectId ||
            storedEntity.status !== "active" ||
            storedEntity.lineageStatus !== "trusted" ||
            !membership ||
            !sameIdSet(
              storedSources.map((source) => source.assetId),
              entity.sourceAssetIds
            )
          ) {
            throw new InvalidQualityEntityLineageError("历史商品实体血缘不完整或已经变化");
          }
        }
        await transaction.insert(generationTaskUnits).values(
          record.units.map((unit) => ({
            id: unit.unitId,
            taskId: record.taskId,
            position: unit.position,
            groupPosition: unit.groupPosition,
            variantPosition: unit.variantPosition,
            outputLayout: unit.outputLayout,
            instruction: unit.instruction,
            requirementSnapshot: unit.requirementSnapshot,
            status: "queued" as const,
            createdAt: new Date(record.createdAt),
            updatedAt: new Date(record.updatedAt)
          }))
        );
        const sources = record.units.flatMap((unit) =>
          unit.sources.map((source) => ({
            unitId: unit.unitId,
            assetId: source.assetId,
            position: source.position,
            sourceRole: source.sourceRole,
            usage: source.usage
          }))
        );
        if (sources.length > 0) await transaction.insert(generationTaskUnitSources).values(sources);
        const qualitySources = record.units.flatMap((unit) =>
          unit.qualitySourceAssetIds.map((assetId, position) => ({
            unitId: unit.unitId,
            assetId,
            position
          }))
        );
        if (qualitySources.length > 0) {
          await transaction.insert(generationTaskUnitQualitySources).values(qualitySources);
        }
        for (const unit of record.units) {
          for (const [position, entity] of (unit.subjectEntities ?? []).entries()) {
            const [storedEntity] = await transaction
              .insert(generationUnitSubjectEntities)
              .values({
                unitId: unit.unitId,
                productEntityId: entity.productEntityId,
                entityKey: entity.entityKey,
                label: entity.label,
                position
              })
              .returning({ id: generationUnitSubjectEntities.id });
            if (storedEntity && entity.sourceAssetIds.length > 0) {
              await transaction.insert(generationUnitSubjectEntitySources).values(
                entity.sourceAssetIds.map((assetId, sourcePosition) => ({
                  entityId: storedEntity.id,
                  assetId,
                  position: sourcePosition
                }))
              );
            }
          }
        }
      }
      if (rows.length === 1 && record.regeneratedFrom) {
        await transaction.insert(generationTaskRegenerations).values({
          taskId: record.taskId,
          sourceTaskId: record.regeneratedFrom.taskId,
          sourceUnitId: record.regeneratedFrom.unitId,
          sourceAssetId: record.regeneratedFrom.assetId,
          createdAt: new Date(record.createdAt)
        });
      }
      const events = units.map((unit, index) => ({
        runId: record.taskId,
        sequence: index + 1,
        eventType: "generation.unit.enqueue",
        entityType: "generation_unit",
        entityId: unit.unitId,
        payload: { taskId: record.taskId, unitId: unit.unitId }
      }));
      await transaction.insert(workflowEvents).values(events);
      return rows;
    });
    if (inserted.length === 1) return { record, created: true };

    const [existing] = await this.connection.db
      .select({ id: generationTasks.id })
      .from(generationTasks)
      .where(
        and(
          eq(generationTasks.userId, record.userId),
          eq(generationTasks.idempotencyKey, record.idempotencyKey)
        )
      )
      .limit(1);
    const existingRecord = existing ? await this.findById(existing.id) : undefined;
    if (!existingRecord) throw new Error("幂等生图任务写入后无法读取");
    return { record: existingRecord, created: false };
  }

  public async claimPendingDispatches(
    limit: number
  ): Promise<Array<{ eventId: string; eventType: string; taskId: string; unitId?: string }>> {
    return this.connection.db.transaction(async (transaction) => {
      const rows = await transaction
        .select({
          eventId: workflowEvents.id,
          eventType: workflowEvents.eventType,
          payload: workflowEvents.payload
        })
        .from(workflowEvents)
        .where(
          and(
            isNull(workflowEvents.publishedAt),
            lte(workflowEvents.availableAt, new Date()),
            eq(workflowEvents.eventType, "generation.unit.enqueue")
          )
        )
        .orderBy(asc(workflowEvents.createdAt))
        .limit(limit)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return [];
      await transaction
        .update(workflowEvents)
        .set({
          availableAt: new Date(Date.now() + 30_000),
          publishAttempts: sql`${workflowEvents.publishAttempts} + 1`
        })
        .where(
          inArray(
            workflowEvents.id,
            rows.map((row) => row.eventId)
          )
        );
      return rows.flatMap((row) => {
        const payload = asRecord(row.payload);
        const taskId = typeof payload?.taskId === "string" ? payload.taskId : undefined;
        const unitId = typeof payload?.unitId === "string" ? payload.unitId : undefined;
        if (!taskId) return [];
        return [
          {
            eventId: row.eventId,
            eventType: row.eventType,
            taskId,
            ...(unitId ? { unitId } : {})
          }
        ];
      });
    });
  }

  public async markDispatchPublished(eventId: string): Promise<void> {
    await this.connection.db
      .update(workflowEvents)
      .set({ publishedAt: new Date(), lastError: null })
      .where(and(eq(workflowEvents.id, eventId), isNull(workflowEvents.publishedAt)));
  }

  public async markDispatchFailed(eventId: string, error: string): Promise<void> {
    await this.connection.db
      .update(workflowEvents)
      .set({
        lastError: error.slice(0, 2_000),
        availableAt: new Date(Date.now() + 5_000)
      })
      .where(and(eq(workflowEvents.id, eventId), isNull(workflowEvents.publishedAt)));
  }

  public async findById(id: string): Promise<ImageGenerationTaskRecord | undefined> {
    const [joined] = await this.connection.db
      .select({
        task: generationTasks,
        lifecycleStatus: creationRuns.status,
        lifecycleUpdatedAt: creationRuns.updatedAt
      })
      .from(generationTasks)
      .innerJoin(creationRuns, eq(generationTasks.creationRunId, creationRuns.id))
      .where(eq(generationTasks.id, id))
      .limit(1);
    if (!joined) return undefined;
    const row = joined.task;

    const [regeneration] = await this.connection.db
      .select()
      .from(generationTaskRegenerations)
      .where(eq(generationTaskRegenerations.taskId, id))
      .limit(1);

    const outputs = await this.connection.db
      .select({
        unitId: generationTaskOutputs.unitId,
        position: generationTaskOutputs.position,
        outputStatus: generationTaskOutputs.status,
        deliverableAssetId: generationTaskOutputs.deliverableAssetId,
        id: mediaAssets.id,
        projectId: mediaAssets.projectId,
        kind: mediaAssets.kind,
        mimeType: mediaAssets.mimeType,
        byteSize: mediaAssets.byteSize,
        createdAt: mediaAssets.createdAt
      })
      .from(generationTaskOutputs)
      .innerJoin(mediaAssets, eq(generationTaskOutputs.assetId, mediaAssets.id))
      .where(eq(generationTaskOutputs.taskId, id))
      .orderBy(asc(generationTaskOutputs.position));
    const units = await this.connection.db
      .select()
      .from(generationTaskUnits)
      .where(eq(generationTaskUnits.taskId, id))
      .orderBy(asc(generationTaskUnits.position));
    const unitIds = units.map((unit) => unit.id);
    const [sourceRows, qualityRows, attemptRows, checkRows] =
      unitIds.length === 0
        ? [[], [], [], []]
        : await Promise.all([
            this.connection.db
              .select()
              .from(generationTaskUnitSources)
              .where(inArray(generationTaskUnitSources.unitId, unitIds))
              .orderBy(asc(generationTaskUnitSources.position)),
            this.connection.db
              .select()
              .from(generationTaskUnitQualitySources)
              .where(inArray(generationTaskUnitQualitySources.unitId, unitIds))
              .orderBy(asc(generationTaskUnitQualitySources.position)),
            this.connection.db
              .select({
                unitId: generationUnitAttempts.unitId,
                status: generationUnitAttempts.status,
                startedAt: generationUnitAttempts.startedAt,
                completedAt: generationUnitAttempts.completedAt
              })
              .from(generationUnitAttempts)
              .where(inArray(generationUnitAttempts.unitId, unitIds)),
            this.connection.db
              .select({
                unitId: subjectConsistencyChecks.generationUnitId,
                status: subjectConsistencyChecks.status,
                phase: subjectConsistencyChecks.phase,
                verdict: subjectConsistencyChecks.verdict,
                userMessage: subjectConsistencyChecks.userMessage,
                errorCode: subjectConsistencyChecks.errorCode,
                errorMessage: subjectConsistencyChecks.errorMessage,
                generatedAssetId: subjectConsistencyChecks.generatedAssetId,
                deliverableAssetId: subjectConsistencyChecks.deliverableAssetId,
                updatedAt: subjectConsistencyChecks.updatedAt
              })
              .from(subjectConsistencyChecks)
              .where(inArray(subjectConsistencyChecks.generationUnitId, unitIds))
          ]);
    const entityRows =
      unitIds.length === 0
        ? []
        : await this.connection.db
            .select({
              entityId: generationUnitSubjectEntities.id,
              productEntityId: generationUnitSubjectEntities.productEntityId,
              unitId: generationUnitSubjectEntities.unitId,
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
            .where(inArray(generationUnitSubjectEntities.unitId, unitIds))
            .orderBy(
              asc(generationUnitSubjectEntities.position),
              asc(generationUnitSubjectEntitySources.position)
            );
    const deliverableIds = [
      ...new Set([
        ...outputs.flatMap((output) =>
          output.outputStatus === "deliverable" && output.deliverableAssetId
            ? [output.deliverableAssetId]
            : []
        ),
        ...checkRows.flatMap((check) =>
          check.status === "completed" && check.deliverableAssetId ? [check.deliverableAssetId] : []
        )
      ])
    ];
    const deliverableRows =
      deliverableIds.length === 0
        ? []
        : await this.connection.db
            .select({
              id: mediaAssets.id,
              projectId: mediaAssets.projectId,
              kind: mediaAssets.kind,
              mimeType: mediaAssets.mimeType,
              byteSize: mediaAssets.byteSize,
              createdAt: mediaAssets.createdAt
            })
            .from(mediaAssets)
            .where(inArray(mediaAssets.id, deliverableIds));
    const publicAssets = new Map(
      [...outputs, ...deliverableRows].map((asset) => [
        asset.id,
        {
          id: asset.id,
          projectId: asset.projectId,
          kind: asset.kind,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          createdAt: asset.createdAt.toISOString()
        }
      ])
    );
    const outputByUnitId = new Map(
      outputs.flatMap((output) => (output.unitId ? [[output.unitId, output] as const] : []))
    );
    const checkByUnitId = new Map(
      checkRows.flatMap((check) => (check.unitId ? [[check.unitId, check] as const] : []))
    );
    const latestAttemptByUnitId = new Map<string, (typeof attemptRows)[number]>();
    for (const attempt of attemptRows) {
      const current = latestAttemptByUnitId.get(attempt.unitId);
      if (!current || attempt.startedAt > current.startedAt) {
        latestAttemptByUnitId.set(attempt.unitId, attempt);
      }
    }

    return {
      taskId: row.id,
      userId: row.userId,
      requirementRunId: row.requirementRunId,
      sessionId: row.sessionId,
      stateSnapshotId: row.stateSnapshotId,
      idempotencyKey: row.idempotencyKey,
      projectId: row.projectId,
      modelId: row.modelId,
      instruction: row.instruction,
      instructionVersion: row.instructionVersion,
      status: row.status,
      lifecycleStatus: joined.lifecycleStatus,
      lifecycleUpdatedAt: joined.lifecycleUpdatedAt.toISOString(),
      resultAssets: outputs.flatMap((output) => {
        if (output.outputStatus !== "deliverable" || !output.deliverableAssetId) return [];
        const asset = publicAssets.get(output.deliverableAssetId);
        return asset ? [asset] : [];
      }),
      units: units.map((unit) => {
        const output = outputByUnitId.get(unit.id);
        const check = checkByUnitId.get(unit.id);
        const latestAttempt = latestAttemptByUnitId.get(unit.id);
        const qualityActive = Boolean(
          check && (check.status === "queued" || check.status === "running")
        );
        const stageStartedAt = qualityActive
          ? check!.updatedAt
          : (latestAttempt?.startedAt ?? unit.createdAt);
        const completedAt = check
          ? ["completed", "source_unusable", "execution_failed", "cancelled"].includes(check.status)
            ? check.updatedAt
            : null
          : unit.status === "succeeded" || unit.status === "failed" || unit.status === "cancelled"
            ? (latestAttempt?.completedAt ?? unit.updatedAt)
            : null;
        return {
          unitId: unit.id,
          position: unit.position,
          groupPosition: unit.groupPosition,
          variantPosition: unit.variantPosition,
          outputLayout: unit.outputLayout as ImageGenerationUnitRecord["outputLayout"],
          instruction: unit.instruction,
          requirementSnapshot: unit.requirementSnapshot
            ? finalRequirementSchema.parse(unit.requirementSnapshot)
            : null,
          status: unit.status,
          attemptCount: attemptRows.filter((attempt) => attempt.unitId === unit.id).length,
          stageStartedAt: stageStartedAt.toISOString(),
          completedAt: completedAt?.toISOString() ?? null,
          qualitySourceAssetIds: qualityRows
            .filter((source) => source.unitId === unit.id)
            .map((source) => source.assetId),
          subjectEntities: entityRows
            .filter(
              (entity, index, rows) =>
                entity.unitId === unit.id &&
                rows.findIndex((candidate) => candidate.entityId === entity.entityId) === index
            )
            .map((entity) => ({
              entityKey: entity.entityKey,
              label: entity.label,
              productEntityId: entity.productEntityId,
              lineageKind: "inherited_product_entity" as const,
              inheritedFromAssetId: null,
              sourceAssetIds: entityRows
                .filter((source) => source.entityId === entity.entityId && source.assetId !== null)
                .map((source) => source.assetId!)
            })),
          sources: sourceRows
            .filter((source) => source.unitId === unit.id)
            .map((source) => ({
              assetId: source.assetId,
              sourceRole:
                source.sourceRole as ImageGenerationUnitRecord["sources"][number]["sourceRole"],
              usage: source.usage as ImageGenerationUnitRecord["sources"][number]["usage"],
              position: source.position
            })),
          generatedAsset: output ? (publicAssets.get(output.id) ?? null) : null,
          deliverableAsset: check?.deliverableAssetId
            ? (publicAssets.get(check.deliverableAssetId) ?? null)
            : output?.outputStatus === "deliverable" && output.deliverableAssetId
              ? (publicAssets.get(output.deliverableAssetId) ?? null)
              : null,
          subjectConsistencyStatus: check?.status ?? null,
          subjectConsistencyPhase: check?.phase ?? null,
          error:
            unit.errorCode && unit.errorMessage
              ? { code: unit.errorCode, message: unit.errorMessage }
              : check &&
                  (check.status === "source_unusable" ||
                    check.status === "execution_failed" ||
                    check.status === "cancelled" ||
                    (check.status === "completed" && check.verdict === "rejected"))
                ? {
                    code:
                      check.errorCode ??
                      (check.status === "source_unusable"
                        ? "SUBJECT_INSPECTION_INCONCLUSIVE"
                        : check.status === "completed"
                          ? "SUBJECT_CONSISTENCY_FAILED"
                          : "SUBJECT_CONSISTENCY_EXECUTION_FAILED"),
                    message: check.userMessage ?? check.errorMessage ?? "该图片未通过主体一致性检查"
                  }
                : null
        };
      }),
      requestedOutputCount: units.length || outputs.length,
      regeneratedFrom: regeneration
        ? {
            taskId: regeneration.sourceTaskId,
            unitId: regeneration.sourceUnitId,
            assetId: regeneration.sourceAssetId
          }
        : null,
      unitFailures: units.flatMap((unit) =>
        unit.status === "failed" && unit.errorCode && unit.errorMessage
          ? [{ position: unit.position, code: unit.errorCode, message: unit.errorMessage }]
          : []
      ),
      error:
        row.errorCode && row.errorMessage
          ? { code: row.errorCode, message: row.errorMessage }
          : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  public async findByRequirementRunId(
    requirementRunId: string,
    userId: string
  ): Promise<ImageGenerationTaskRecord | undefined> {
    const [row] = await this.connection.db
      .select({ id: generationTasks.id })
      .from(generationTasks)
      .where(
        and(
          eq(generationTasks.requirementRunId, requirementRunId),
          eq(generationTasks.userId, userId)
        )
      )
      .orderBy(desc(generationTasks.createdAt))
      .limit(1);
    return row ? this.findById(row.id) : undefined;
  }

  public async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<ImageGenerationTaskRecord | undefined> {
    const [row] = await this.connection.db
      .select({ id: generationTasks.id })
      .from(generationTasks)
      .where(
        and(eq(generationTasks.userId, userId), eq(generationTasks.idempotencyKey, idempotencyKey))
      )
      .limit(1);
    return row ? this.findById(row.id) : undefined;
  }

  public async findBySessionId(
    sessionId: string,
    userId: string,
    requirementRunIds: string[]
  ): Promise<ImageGenerationTaskRecord[]> {
    const rows = await this.connection.db
      .select({ id: generationTasks.id })
      .from(generationTasks)
      .where(
        and(
          eq(generationTasks.sessionId, sessionId),
          eq(generationTasks.userId, userId),
          inArray(generationTasks.requirementRunId, requirementRunIds)
        )
      )
      .orderBy(desc(generationTasks.createdAt));
    const records = await Promise.all(rows.map((row) => this.findById(row.id)));
    return records.filter((record): record is ImageGenerationTaskRecord => Boolean(record));
  }

  public async findActiveBySessionId(
    sessionId: string,
    userId: string
  ): Promise<ImageGenerationTaskRecord | undefined> {
    const [row] = await this.connection.db
      .select({ id: generationTasks.id })
      .from(generationTasks)
      .innerJoin(creationRuns, eq(generationTasks.creationRunId, creationRuns.id))
      .where(
        and(
          eq(creationRuns.sessionId, sessionId),
          eq(creationRuns.userId, userId),
          inArray(creationRuns.status, ["queued", "running", "cancelling"])
        )
      )
      .orderBy(desc(creationRuns.createdAt), desc(generationTasks.createdAt))
      .limit(1);
    return row ? this.findById(row.id) : undefined;
  }

  public async findRecoverableUnits(): Promise<Array<{ taskId: string; unitId: string }>> {
    const rows = await this.connection.db
      .select({ taskId: generationTaskUnits.taskId, unitId: generationTaskUnits.id })
      .from(generationTaskUnits)
      .innerJoin(generationTasks, eq(generationTaskUnits.taskId, generationTasks.id))
      .where(
        and(
          inArray(generationTasks.status, ["queued", "running"]),
          inArray(generationTaskUnits.status, ["queued", "running"])
        )
      );
    return rows;
  }

  public async cancel(
    id: string,
    userId: string
  ): Promise<{
    cancelled: boolean;
    unitIds: string[];
    relatedTasks: Array<{ taskId: string; unitIds: string[] }>;
    hadRunningAttempt: boolean;
  }> {
    return this.connection.db.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ status: creationRuns.status })
        .from(creationRuns)
        .where(and(eq(creationRuns.id, id), eq(creationRuns.userId, userId)))
        .limit(1)
        .for("update");
      if (!run || run.status === "terminal") {
        return { cancelled: false, unitIds: [], relatedTasks: [], hadRunningAttempt: false };
      }
      const taskRows = await transaction
        .select({ taskId: generationTasks.id })
        .from(generationTasks)
        .where(eq(generationTasks.creationRunId, id));
      const taskIds = taskRows.map((task) => task.taskId);
      const allUnits =
        taskIds.length === 0
          ? []
          : await transaction
              .select({ taskId: generationTaskUnits.taskId, unitId: generationTaskUnits.id })
              .from(generationTaskUnits)
              .where(inArray(generationTaskUnits.taskId, taskIds));
      const unitIds = allUnits.filter((unit) => unit.taskId === id).map((unit) => unit.unitId);
      const repairTaskIds = taskIds.filter((taskId) => taskId !== id);
      const allUnitIds = allUnits.map((unit) => unit.unitId);
      const runningAttempts =
        allUnitIds.length === 0
          ? []
          : await transaction
              .select({ id: generationUnitAttempts.id })
              .from(generationUnitAttempts)
              .where(
                and(
                  inArray(generationUnitAttempts.unitId, allUnitIds),
                  eq(generationUnitAttempts.status, "running")
                )
              );
      const now = new Date();
      if (run.status !== "cancelled") {
        await transaction
          .update(creationRuns)
          .set({
            status: "cancelling",
            cancelRequestedAt: now,
            cancelRequestedBy: userId,
            updatedAt: now
          })
          .where(eq(creationRuns.id, id));
        if (taskIds.length > 0) {
          await transaction
            .update(generationTasks)
            .set({ status: "cancelled", errorCode: null, errorMessage: null, updatedAt: now })
            .where(
              and(
                inArray(generationTasks.id, taskIds),
                inArray(generationTasks.status, ["queued", "running"])
              )
            );
        }
        if (allUnitIds.length > 0) {
          await transaction
            .update(generationTaskUnits)
            .set({ status: "cancelled", errorCode: null, errorMessage: null, updatedAt: now })
            .where(
              and(
                inArray(generationTaskUnits.id, allUnitIds),
                inArray(generationTaskUnits.status, ["queued", "running"])
              )
            );
          await transaction
            .update(generationUnitAttempts)
            .set({
              status: "cancelled",
              cancelRequestedAt: now,
              cancelledAt: now,
              providerCancellationStatus: "unsupported",
              completedAt: now
            })
            .where(
              and(
                inArray(generationUnitAttempts.unitId, allUnitIds),
                eq(generationUnitAttempts.status, "running")
              )
            );
        }
        await transaction
          .update(subjectConsistencyChecks)
          .set({ status: "cancelled", userMessage: "任务已由用户停止", updatedAt: now })
          .where(
            and(
              eq(subjectConsistencyChecks.generationTaskId, id),
              inArray(subjectConsistencyChecks.status, ["queued", "running"])
            )
          );
        if (taskIds.length > 0) {
          await transaction
            .update(generationTaskOutputs)
            .set({ status: "rejected", rejectionCode: "CANCELLED", updatedAt: now })
            .where(
              and(
                inArray(generationTaskOutputs.taskId, taskIds),
                eq(generationTaskOutputs.status, "candidate")
              )
            );
        }
        const [lastEvent] = await transaction
          .select({ sequence: workflowEvents.sequence })
          .from(workflowEvents)
          .where(eq(workflowEvents.runId, id))
          .orderBy(desc(workflowEvents.sequence))
          .limit(1);
        await transaction.insert(workflowEvents).values({
          runId: id,
          sequence: (lastEvent?.sequence ?? 0) + 1,
          eventType: "workflow.cancelled",
          entityType: "creation_run",
          entityId: id,
          payload: {
            requestedBy: userId,
            providerCancellationStatus: runningAttempts.length > 0 ? "unsupported" : "not_required"
          },
          publishedAt: now,
          createdAt: now
        });
        await transaction
          .update(creationRuns)
          .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
          .where(eq(creationRuns.id, id));
      }
      return {
        cancelled: true,
        unitIds,
        relatedTasks: repairTaskIds.map((taskId) => ({
          taskId,
          unitIds: allUnits.filter((unit) => unit.taskId === taskId).map((unit) => unit.unitId)
        })),
        hadRunningAttempt: runningAttempts.length > 0
      };
    });
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
    if (!updated) throw new InvalidImageGenerationTaskTransitionError(unitId);
    await this.refreshParentStatus(updated.taskId);
  }

  public async markFailed(id: string, error: ImageGenerationError): Promise<void> {
    const updated = await this.connection.db
      .update(generationTasks)
      .set({
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
        updatedAt: new Date()
      })
      .where(
        and(eq(generationTasks.id, id), inArray(generationTasks.status, ["queued", "running"]))
      )
      .returning({ id: generationTasks.id });
    if (updated.length !== 1) throw new InvalidImageGenerationTaskTransitionError(id);
  }

  private async refreshParentStatus(taskId: string): Promise<void> {
    const units = await this.connection.db
      .select({
        status: generationTaskUnits.status,
        errorCode: generationTaskUnits.errorCode,
        errorMessage: generationTaskUnits.errorMessage
      })
      .from(generationTaskUnits)
      .where(eq(generationTaskUnits.taskId, taskId));
    const pending = units.some((unit) => unit.status === "queued" || unit.status === "running");
    const succeeded = units.some((unit) => unit.status === "succeeded");
    const firstFailure = units.find((unit) => unit.status === "failed");
    await this.connection.db
      .update(generationTasks)
      .set({
        status: pending ? "running" : succeeded ? "succeeded" : "failed",
        errorCode:
          pending || succeeded ? null : (firstFailure?.errorCode ?? "IMAGE_GENERATION_FAILED"),
        errorMessage:
          pending || succeeded ? null : (firstFailure?.errorMessage ?? "所有图片生成均失败"),
        updatedAt: new Date()
      })
      .where(eq(generationTasks.id, taskId));
  }
}

function sameIdSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function assertSameRegenerationSource(
  task: ImageGenerationTaskRecord,
  expected: NonNullable<ImageGenerationTaskRecord["regeneratedFrom"]>
): void {
  if (
    task.regeneratedFrom?.taskId !== expected.taskId ||
    task.regeneratedFrom.unitId !== expected.unitId ||
    task.regeneratedFrom.assetId !== expected.assetId
  ) {
    throw new ImageGenerationIdempotencyConflictError();
  }
}

function assertRegenerationRecordShape(input: ImageGenerationRegenerationRecord): void {
  const { requirementRun, task } = input;
  if (
    task.units?.length !== 1 ||
    task.status !== "queued" ||
    task.resultAssets.length !== 0 ||
    requirementRun.result.status !== "ready" ||
    requirementRun.result.finalRequirement.imageCount !== 1 ||
    requirementRun.request.imageSettings.imageCount !== 1 ||
    requirementRun.sessionId !== (task.sessionId ?? null)
  ) {
    throw new Error("再次生成记录必须包含一个输出单元且生成数量为 1");
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
