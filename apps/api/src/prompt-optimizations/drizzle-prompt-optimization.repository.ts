import { Inject, Injectable } from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";

import {
  promptOptimizationAssets,
  promptOptimizations,
  type DatabaseConnection
} from "@chaoren/database";
import { promptOptimizationInputRevisionSchema, type PromptOptimization } from "@chaoren/contracts";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type {
  CreatePromptOptimizationRecordInput,
  CreatePromptOptimizationRecordResult,
  PromptOptimizationRecord,
  PromptOptimizationRepository
} from "./prompt-optimization.repository.js";

@Injectable()
export class DrizzlePromptOptimizationRepository implements PromptOptimizationRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async createOrFind(
    input: CreatePromptOptimizationRecordInput
  ): Promise<CreatePromptOptimizationRecordResult> {
    return this.connection.db.transaction(async (tx) => {
      if (input.request.parentOptimizationId) {
        const [parent] = await tx
          .select({
            id: promptOptimizations.id,
            optimizedText: promptOptimizations.optimizedText,
            inputRevision: promptOptimizations.inputRevision
          })
          .from(promptOptimizations)
          .where(
            and(
              eq(promptOptimizations.id, input.request.parentOptimizationId),
              eq(promptOptimizations.userId, input.userId),
              eq(promptOptimizations.projectId, input.projectId),
              eq(promptOptimizations.sessionId, input.sessionId),
              eq(promptOptimizations.status, "succeeded")
            )
          )
          .limit(1);
        const parentRevision = promptOptimizationInputRevisionSchema.safeParse(
          parent?.inputRevision
        );
        if (!parent || !parentRevision.success || parent.optimizedText === null) {
          return { status: "parent_not_available" as const };
        }
      }

      const [created] = await tx
        .insert(promptOptimizations)
        .values({
          id: input.id,
          userId: input.userId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          parentOptimizationId: input.request.parentOptimizationId,
          operation: input.request.operation,
          status: "processing",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          executionToken: input.executionToken,
          originalText: input.request.text,
          revisionInstruction: input.request.revisionInstruction,
          inputRevision: input.inputRevision,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.createdAt)
        })
        .onConflictDoNothing({
          target: [promptOptimizations.userId, promptOptimizations.idempotencyKey]
        })
        .returning();

      if (created) {
        if (input.inputRevision.candidateImages.length > 0) {
          await tx.insert(promptOptimizationAssets).values(
            input.inputRevision.candidateImages.map((attachment, position) => ({
              optimizationId: created.id,
              assetId: attachment.assetId,
              role: attachment.role,
              position,
              relation: attachment.relation
            }))
          );
        }
        return { status: "created" as const, record: toRecord(created) };
      }

      const [existing] = await tx
        .select()
        .from(promptOptimizations)
        .where(
          and(
            eq(promptOptimizations.userId, input.userId),
            eq(promptOptimizations.idempotencyKey, input.idempotencyKey)
          )
        )
        .limit(1);
      if (!existing || existing.requestHash !== input.requestHash) {
        return { status: "idempotency_conflict" as const };
      }
      if (existing.status === "processing" && existing.updatedAt < new Date(input.staleBefore)) {
        const [reclaimed] = await tx
          .update(promptOptimizations)
          .set({ executionToken: input.executionToken, updatedAt: new Date(input.createdAt) })
          .where(
            and(
              eq(promptOptimizations.id, existing.id),
              eq(promptOptimizations.status, "processing"),
              eq(promptOptimizations.executionToken, existing.executionToken),
              lt(promptOptimizations.updatedAt, new Date(input.staleBefore))
            )
          )
          .returning();
        if (reclaimed) return { status: "reclaimed" as const, record: toRecord(reclaimed) };
      }
      return { status: "duplicate" as const, record: toRecord(existing) };
    });
  }

  public async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<PromptOptimizationRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(promptOptimizations)
      .where(
        and(
          eq(promptOptimizations.userId, userId),
          eq(promptOptimizations.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  public async findById(id: string, userId: string): Promise<PromptOptimizationRecord | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(promptOptimizations)
      .where(and(eq(promptOptimizations.id, id), eq(promptOptimizations.userId, userId)))
      .limit(1);
    return row ? toRecord(row) : undefined;
  }

  public async complete(input: {
    id: string;
    userId: string;
    executionToken: string;
    optimizedText: string;
    imageDecisionStatus: "not_needed" | "resolved";
    selectedImageKeys: string[];
    aiModel: string;
    promptVersion: string;
    completedAt: string;
  }): Promise<PromptOptimizationRecord | undefined> {
    const [row] = await this.connection.db
      .update(promptOptimizations)
      .set({
        status: "succeeded",
        optimizedText: input.optimizedText,
        imageDecisionStatus: input.imageDecisionStatus,
        selectedImageKeys: input.selectedImageKeys,
        aiModel: input.aiModel,
        promptVersion: input.promptVersion,
        errorCode: null,
        completedAt: new Date(input.completedAt),
        updatedAt: new Date(input.completedAt)
      })
      .where(
        and(
          eq(promptOptimizations.id, input.id),
          eq(promptOptimizations.userId, input.userId),
          eq(promptOptimizations.executionToken, input.executionToken),
          eq(promptOptimizations.status, "processing")
        )
      )
      .returning();
    if (row) return toRecord(row);
    return this.findById(input.id, input.userId);
  }

  public async fail(input: {
    id: string;
    userId: string;
    executionToken: string;
    errorCode: string;
    imageDecisionStatus?: "missing" | "ambiguous";
    selectedImageKeys: string[];
    completedAt: string;
  }): Promise<PromptOptimizationRecord | undefined> {
    const [row] = await this.connection.db
      .update(promptOptimizations)
      .set({
        status: "failed",
        errorCode: input.errorCode,
        imageDecisionStatus: input.imageDecisionStatus ?? null,
        selectedImageKeys: input.selectedImageKeys,
        completedAt: new Date(input.completedAt),
        updatedAt: new Date(input.completedAt)
      })
      .where(
        and(
          eq(promptOptimizations.id, input.id),
          eq(promptOptimizations.userId, input.userId),
          eq(promptOptimizations.executionToken, input.executionToken),
          eq(promptOptimizations.status, "processing")
        )
      )
      .returning();
    if (row) return toRecord(row);
    return this.findById(input.id, input.userId);
  }
}

function toRecord(row: typeof promptOptimizations.$inferSelect): PromptOptimizationRecord {
  const publicRecord: PromptOptimization = {
    id: row.id,
    sessionId: row.sessionId,
    operation: row.operation,
    status: row.status,
    parentOptimizationId: row.parentOptimizationId,
    originalText: row.originalText,
    optimizedText: row.optimizedText,
    revisionInstruction: row.revisionInstruction,
    inputRevision: promptOptimizationInputRevisionSchema.parse(row.inputRevision),
    adoptedMessageId: row.adoptedMessageId,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    imageDecisionStatus: row.imageDecisionStatus,
    selectedImageKeys: parseSelectedImageKeys(row.selectedImageKeys)
  };
  return {
    ...publicRecord,
    userId: row.userId,
    projectId: row.projectId,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    aiModel: row.aiModel,
    promptVersion: row.promptVersion,
    executionToken: row.executionToken
  };
}

function parseSelectedImageKeys(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
