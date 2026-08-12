import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { requirementRuns, type DatabaseConnection } from "@chaoren/database";
import {
  requirementResultSchema,
  resolveRequirementRequestSchema,
  resolvedGenerationPlanSchema
} from "@chaoren/contracts";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type {
  RequirementRunRecord,
  RequirementRunRepository
} from "./requirement-run.repository.js";

@Injectable()
export class DrizzleRequirementRunRepository implements RequirementRunRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async save(record: RequirementRunRecord): Promise<void> {
    await this.connection.db.insert(requirementRuns).values({
      id: record.id,
      parentRequirementRunId: record.parentRequirementRunId,
      sessionId: record.sessionId ?? null,
      sourceMessageId: record.sourceMessageId ?? null,
      stateSnapshotId: record.stateSnapshotId ?? null,
      userId: record.userId,
      projectId: record.request.projectId,
      request: record.request,
      result: record.result,
      executionPlan: record.executionPlan,
      executionPlanHash: record.executionPlanHash,
      aiModel: record.aiModel,
      promptVersion: record.promptVersion,
      createdAt: new Date(record.createdAt)
    });
  }

  public async findById(id: string): Promise<RequirementRunRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(requirementRuns)
      .where(eq(requirementRuns.id, id))
      .limit(1);
    return row
      ? {
          id: row.id,
          parentRequirementRunId: row.parentRequirementRunId,
          sessionId: row.sessionId,
          sourceMessageId: row.sourceMessageId,
          stateSnapshotId: row.stateSnapshotId,
          userId: row.userId,
          request: resolveRequirementRequestSchema.parse(row.request),
          result: requirementResultSchema.parse(row.result),
          executionPlan: row.executionPlan
            ? resolvedGenerationPlanSchema.parse(row.executionPlan)
            : null,
          executionPlanHash: row.executionPlanHash,
          aiModel: row.aiModel,
          promptVersion: row.promptVersion,
          createdAt: row.createdAt.toISOString()
        }
      : undefined;
  }
}
