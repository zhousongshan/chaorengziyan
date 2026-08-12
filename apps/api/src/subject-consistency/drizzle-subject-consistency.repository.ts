import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, inArray } from "drizzle-orm";

import {
  generationTasks,
  mediaAssets,
  subjectConsistencyAttempts,
  subjectConsistencyCheckSources,
  subjectConsistencyChecks,
  subjectConsistencyRepairs,
  type DatabaseConnection
} from "@chaoren/database";
import {
  subjectInspectionResultSchema,
  subjectRequirementReconciliationSchema
} from "@chaoren/contracts";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type {
  SubjectConsistencyCheckRecord,
  SubjectConsistencyRepository
} from "./subject-consistency.repository.js";

@Injectable()
export class DrizzleSubjectConsistencyRepository implements SubjectConsistencyRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async findById(id: string): Promise<SubjectConsistencyCheckRecord | undefined> {
    const records = await this.load([id]);
    return records[0];
  }

  public async findByGenerationTaskId(taskId: string): Promise<SubjectConsistencyCheckRecord[]> {
    const rows = await this.connection.db
      .select({ id: subjectConsistencyChecks.id })
      .from(subjectConsistencyChecks)
      .where(eq(subjectConsistencyChecks.generationTaskId, taskId))
      .orderBy(asc(subjectConsistencyChecks.createdAt));
    return this.load(rows.map((row) => row.id));
  }

  public async findRecoverableIds(): Promise<string[]> {
    const rows = await this.connection.db
      .select({ id: subjectConsistencyChecks.id })
      .from(subjectConsistencyChecks)
      .where(inArray(subjectConsistencyChecks.status, ["queued", "running"]));
    return rows.map((row) => row.id);
  }

  private async load(ids: string[]): Promise<SubjectConsistencyCheckRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.connection.db
      .select({
        check: subjectConsistencyChecks,
        generatedAsset: {
          id: mediaAssets.id,
          projectId: mediaAssets.projectId,
          kind: mediaAssets.kind,
          mimeType: mediaAssets.mimeType,
          byteSize: mediaAssets.byteSize,
          createdAt: mediaAssets.createdAt
        }
      })
      .from(subjectConsistencyChecks)
      .innerJoin(mediaAssets, eq(subjectConsistencyChecks.generatedAssetId, mediaAssets.id))
      .where(inArray(subjectConsistencyChecks.id, ids));
    const order = new Map(ids.map((id, index) => [id, index]));
    const result: SubjectConsistencyCheckRecord[] = [];
    for (const row of rows) {
      const sourceRows = await this.connection.db
        .select({ assetId: subjectConsistencyCheckSources.assetId })
        .from(subjectConsistencyCheckSources)
        .where(eq(subjectConsistencyCheckSources.checkId, row.check.id))
        .orderBy(asc(subjectConsistencyCheckSources.position));
      const attempts = await this.connection.db
        .select()
        .from(subjectConsistencyAttempts)
        .where(eq(subjectConsistencyAttempts.checkId, row.check.id))
        .orderBy(asc(subjectConsistencyAttempts.round));
      const [repairRow] = await this.connection.db
        .select()
        .from(subjectConsistencyRepairs)
        .where(eq(subjectConsistencyRepairs.checkId, row.check.id))
        .limit(1);
      const [repairTask] = repairRow
        ? await this.connection.db
            .select()
            .from(generationTasks)
            .where(eq(generationTasks.id, repairRow.generationTaskId))
            .limit(1)
        : [];
      const [latestGeneratedAsset] = repairRow?.generatedAssetId
        ? await this.connection.db
            .select({
              id: mediaAssets.id,
              projectId: mediaAssets.projectId,
              kind: mediaAssets.kind,
              mimeType: mediaAssets.mimeType,
              byteSize: mediaAssets.byteSize,
              createdAt: mediaAssets.createdAt
            })
            .from(mediaAssets)
            .where(eq(mediaAssets.id, repairRow.generatedAssetId))
            .limit(1)
        : [];
      const [deliverableAsset] = row.check.deliverableAssetId
        ? await this.connection.db
            .select({
              id: mediaAssets.id,
              projectId: mediaAssets.projectId,
              kind: mediaAssets.kind,
              mimeType: mediaAssets.mimeType,
              byteSize: mediaAssets.byteSize,
              createdAt: mediaAssets.createdAt
            })
            .from(mediaAssets)
            .where(eq(mediaAssets.id, row.check.deliverableAssetId))
            .limit(1)
        : [];
      result.push({
        checkId: row.check.id,
        userId: row.check.userId,
        projectId: row.check.projectId,
        generationTaskId: row.check.generationTaskId,
        requirementRunId: row.check.requirementRunId,
        sourceProductAssetIds: sourceRows.map((source) => source.assetId),
        generatedAsset: {
          ...row.generatedAsset,
          createdAt: row.generatedAsset.createdAt.toISOString()
        },
        ...(latestGeneratedAsset
          ? {
              latestGeneratedAsset: {
                ...latestGeneratedAsset,
                createdAt: latestGeneratedAsset.createdAt.toISOString()
              }
            }
          : {}),
        ...(deliverableAsset
          ? {
              deliverableAsset: {
                ...deliverableAsset,
                createdAt: deliverableAsset.createdAt.toISOString()
              }
            }
          : {}),
        ...(repairTask
          ? {
              repair: {
                generationTaskId: repairTask.id,
                status: repairTask.status,
                error:
                  repairTask.errorCode && repairTask.errorMessage
                    ? { code: repairTask.errorCode, message: repairTask.errorMessage }
                    : null
              }
            }
          : {}),
        status: row.check.status,
        phase: row.check.phase,
        verdict: row.check.verdict,
        attempts: attempts.map((attempt) => ({
          round: attempt.round === 2 ? 2 : 1,
          result: subjectInspectionResultSchema.parse(attempt.result),
          createdAt: attempt.createdAt.toISOString()
        })),
        reconciliation: row.check.reconciliation
          ? subjectRequirementReconciliationSchema.parse(row.check.reconciliation)
          : null,
        userMessage: row.check.userMessage,
        error:
          row.check.errorCode && row.check.errorMessage
            ? { code: row.check.errorCode, message: row.check.errorMessage }
            : null,
        createdAt: row.check.createdAt.toISOString(),
        updatedAt: row.check.updatedAt.toISOString()
      });
    }
    return result.sort(
      (left, right) => (order.get(left.checkId) ?? 0) - (order.get(right.checkId) ?? 0)
    );
  }
}
