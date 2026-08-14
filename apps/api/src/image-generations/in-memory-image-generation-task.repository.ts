import { Injectable } from "@nestjs/common";

import type { RequirementRunRepository } from "../requirements/requirement-run.repository.js";
import type {
  ImageGenerationRegenerationRecord,
  ImageGenerationTaskRecord,
  ImageGenerationTaskRepository
} from "./image-generation-task.repository.js";
import { ImageGenerationIdempotencyConflictError } from "./image-generation-task.repository.js";
import { ImageGenerationRegenerationSourceChangedError } from "./image-generation-task.repository.js";
import { ImageGenerationRegenerationSourceNotFoundError } from "./image-generation-task.repository.js";
import { ImageGenerationRegenerationSourceNotReadyError } from "./image-generation-task.repository.js";
import { InvalidImageGenerationTaskTransitionError } from "./image-generation-task.repository.js";
import { ActiveImageGenerationExistsError } from "./image-generation-task.repository.js";

@Injectable()
export class InMemoryImageGenerationTaskRepository implements ImageGenerationTaskRepository {
  private readonly records = new Map<string, ImageGenerationTaskRecord>();

  public constructor(private readonly requirementRuns?: RequirementRunRepository) {}

  public createOrFind(record: ImageGenerationTaskRecord): Promise<{
    record: ImageGenerationTaskRecord;
    created: boolean;
  }> {
    if (!record.units || record.units.length === 0) {
      throw new Error("生图任务必须包含至少一个冻结执行单元");
    }
    const existing = [...this.records.values()].find(
      (candidate) =>
        candidate.userId === record.userId && candidate.idempotencyKey === record.idempotencyKey
    );
    if (existing) {
      return Promise.resolve({ record: structuredClone(existing), created: false });
    }
    if (
      record.sessionId &&
      [...this.records.values()].some(
        (candidate) =>
          candidate.userId === record.userId &&
          candidate.sessionId === record.sessionId &&
          ["queued", "running", "cancelling"].includes(
            candidate.lifecycleStatus ?? candidate.status
          )
      )
    ) {
      throw new ActiveImageGenerationExistsError();
    }
    const stored = {
      ...structuredClone(record),
      lifecycleStatus: record.lifecycleStatus ?? ("queued" as const),
      lifecycleUpdatedAt: record.lifecycleUpdatedAt ?? record.updatedAt
    };
    this.records.set(record.taskId, stored);
    return Promise.resolve({ record: structuredClone(stored), created: true });
  }

  public async createRegenerationOrFind(
    input: ImageGenerationRegenerationRecord
  ): Promise<{ record: ImageGenerationTaskRecord; created: boolean }> {
    const { task, requirementRun } = input;
    assertRegenerationRecordShape(input);
    const existing = [...this.records.values()].find(
      (candidate) =>
        candidate.userId === task.userId && candidate.idempotencyKey === task.idempotencyKey
    );
    if (existing) {
      assertSameRegenerationSource(existing, task.regeneratedFrom);
      return { record: structuredClone(existing), created: false };
    }

    const sourceTask = this.records.get(task.regeneratedFrom.taskId);
    if (
      !sourceTask ||
      sourceTask.userId !== task.userId ||
      sourceTask.projectId !== task.projectId
    ) {
      throw new ImageGenerationRegenerationSourceNotFoundError();
    }
    if (sourceTask.lifecycleStatus !== "terminal") {
      throw new ImageGenerationRegenerationSourceNotReadyError();
    }
    const sourceUnit = sourceTask.units?.find(
      (unit) => unit.unitId === task.regeneratedFrom.unitId
    );
    if (!sourceUnit) throw new ImageGenerationRegenerationSourceNotFoundError();
    if (sourceUnit.status !== "succeeded" || !sourceUnit.deliverableAsset) {
      throw new ImageGenerationRegenerationSourceNotReadyError();
    }
    if (sourceUnit.deliverableAsset.id !== task.regeneratedFrom.assetId) {
      throw new ImageGenerationRegenerationSourceChangedError();
    }
    if (
      requirementRun.id !== task.requirementRunId ||
      requirementRun.parentRequirementRunId !== sourceTask.requirementRunId ||
      requirementRun.userId !== task.userId ||
      requirementRun.request.projectId !== task.projectId
    ) {
      throw new Error("再次生成的子需求记录与任务不一致");
    }
    if (
      task.sessionId &&
      [...this.records.values()].some(
        (candidate) =>
          candidate.userId === task.userId &&
          candidate.sessionId === task.sessionId &&
          ["queued", "running", "cancelling"].includes(
            candidate.lifecycleStatus ?? candidate.status
          )
      )
    ) {
      throw new ActiveImageGenerationExistsError();
    }
    if (!this.requirementRuns) {
      throw new Error("内存再次生成仓储未配置需求仓储");
    }

    const stored: ImageGenerationTaskRecord = {
      ...structuredClone(task),
      lifecycleStatus: "queued",
      lifecycleUpdatedAt: task.updatedAt
    };
    const requirementSave = this.requirementRuns.save(structuredClone(requirementRun));
    this.records.set(task.taskId, stored);
    try {
      await requirementSave;
    } catch (error) {
      this.records.delete(task.taskId);
      throw error;
    }
    return { record: structuredClone(stored), created: true };
  }

  public findById(id: string): Promise<ImageGenerationTaskRecord | undefined> {
    const record = this.records.get(id);
    return Promise.resolve(record ? structuredClone(record) : undefined);
  }

  public findByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<ImageGenerationTaskRecord | undefined> {
    const record = [...this.records.values()].find(
      (candidate) => candidate.userId === userId && candidate.idempotencyKey === idempotencyKey
    );
    return Promise.resolve(record ? structuredClone(record) : undefined);
  }

  public findBySessionId(
    sessionId: string,
    userId: string,
    requirementRunIds: string[]
  ): Promise<ImageGenerationTaskRecord[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter(
          (record) =>
            record.sessionId === sessionId &&
            record.userId === userId &&
            requirementRunIds.includes(record.requirementRunId)
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => structuredClone(record))
    );
  }

  public findActiveBySessionId(
    sessionId: string,
    userId: string
  ): Promise<ImageGenerationTaskRecord | undefined> {
    const record = [...this.records.values()]
      .filter(
        (candidate) =>
          candidate.sessionId === sessionId &&
          candidate.userId === userId &&
          ["queued", "running", "cancelling"].includes(
            candidate.lifecycleStatus ?? candidate.status
          )
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return Promise.resolve(record ? structuredClone(record) : undefined);
  }

  public findRecoverableUnits(): Promise<Array<{ taskId: string; unitId: string }>> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((record) => record.status === "queued" || record.status === "running")
        .flatMap((record) =>
          (record.units ?? [])
            .filter(
              (unit) =>
                unit.status === undefined || unit.status === "queued" || unit.status === "running"
            )
            .map((unit) => ({ taskId: record.taskId, unitId: unit.unitId }))
        )
    );
  }

  public cancel(
    id: string,
    userId: string
  ): Promise<{
    cancelled: boolean;
    unitIds: string[];
    relatedTasks: Array<{ taskId: string; unitIds: string[] }>;
    hadRunningAttempt: boolean;
  }> {
    const record = this.records.get(id);
    const unitIds = record?.units?.map((unit) => unit.unitId) ?? [];
    if (
      !record ||
      record.userId !== userId ||
      (record.status !== "queued" && record.status !== "running")
    ) {
      return Promise.resolve({
        cancelled: false,
        unitIds,
        relatedTasks: [],
        hadRunningAttempt: false
      });
    }
    const now = new Date().toISOString();
    this.records.set(id, {
      ...record,
      status: "cancelled",
      lifecycleStatus: "cancelled",
      lifecycleUpdatedAt: now,
      error: null,
      updatedAt: now,
      ...(record.units
        ? {
            units: record.units.map((unit) =>
              unit.status === "succeeded" || unit.status === "failed"
                ? unit
                : { ...unit, status: "cancelled", completedAt: now }
            )
          }
        : {})
    });
    return Promise.resolve({
      cancelled: true,
      unitIds,
      relatedTasks: [],
      hadRunningAttempt: Boolean(record.units?.some((unit) => unit.status === "running"))
    });
  }

  public markUnitFailed(
    unitId: string,
    error: NonNullable<ImageGenerationTaskRecord["error"]>
  ): Promise<void> {
    const entry = [...this.records.entries()].find(([, record]) =>
      record.units?.some((unit) => unit.unitId === unitId)
    );
    if (!entry) throw new InvalidImageGenerationTaskTransitionError(unitId);
    const [taskId, record] = entry;
    const units = (record.units ?? []).map((unit) =>
      unit.unitId === unitId
        ? { ...unit, status: "failed" as const, error: structuredClone(error) }
        : unit
    );
    const pending = units.some(
      (unit) => unit.status === undefined || unit.status === "queued" || unit.status === "running"
    );
    const succeeded = units.some((unit) => unit.status === "succeeded");
    this.records.set(taskId, {
      ...record,
      units,
      status: pending ? record.status : succeeded ? "succeeded" : "failed",
      error: pending || succeeded ? null : structuredClone(error),
      updatedAt: new Date().toISOString()
    });
    return Promise.resolve();
  }

  public markFailed(
    id: string,
    error: NonNullable<ImageGenerationTaskRecord["error"]>
  ): Promise<void> {
    const record = this.requireRecord(id);
    if (record.status !== "queued" && record.status !== "running") {
      throw new InvalidImageGenerationTaskTransitionError(id);
    }
    this.records.set(id, {
      ...record,
      status: "failed",
      resultAssets: [],
      error: structuredClone(error),
      updatedAt: new Date().toISOString()
    });
    return Promise.resolve();
  }

  private requireRecord(id: string): ImageGenerationTaskRecord {
    const record = this.records.get(id);
    if (!record) throw new InvalidImageGenerationTaskTransitionError(id);
    return record;
  }
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
