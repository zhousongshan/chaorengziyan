import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { generationStartRequests, type DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type {
  GenerationStartRequestRecord,
  GenerationStartRequestRepository
} from "./generation-start-request.repository.js";

@Injectable()
export class DrizzleGenerationStartRequestRepository implements GenerationStartRequestRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async claimPending(input: {
    now: Date;
    leaseDurationMs: number;
    limit: number;
  }): Promise<GenerationStartRequestRecord[]> {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
    return this.connection.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(generationStartRequests)
        .where(
          or(
            and(
              eq(generationStartRequests.status, "pending"),
              lte(generationStartRequests.availableAt, input.now)
            ),
            and(
              eq(generationStartRequests.status, "processing"),
              lte(generationStartRequests.leaseExpiresAt, input.now)
            )
          )
        )
        .orderBy(asc(generationStartRequests.createdAt))
        .limit(input.limit)
        .for("update", { skipLocked: true });
      const claimed: GenerationStartRequestRecord[] = [];
      for (const row of rows) {
        const leaseToken = randomUUID();
        const [updated] = await tx
          .update(generationStartRequests)
          .set({
            status: "processing",
            attemptCount: sql`${generationStartRequests.attemptCount} + 1`,
            leaseToken,
            leaseExpiresAt,
            updatedAt: input.now
          })
          .where(eq(generationStartRequests.requirementRunId, row.requirementRunId))
          .returning();
        if (!updated) continue;
        claimed.push({
          requirementRunId: updated.requirementRunId,
          userId: updated.userId,
          sessionId: updated.sessionId,
          idempotencyKey: updated.idempotencyKey,
          attemptCount: updated.attemptCount,
          leaseToken
        });
      }
      return claimed;
    });
  }

  public async markDispatched(requirementRunId: string, leaseToken: string): Promise<void> {
    await this.connection.db
      .update(generationStartRequests)
      .set({
        status: "dispatched",
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        dispatchedAt: new Date(),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(generationStartRequests.requirementRunId, requirementRunId),
          eq(generationStartRequests.status, "processing"),
          eq(generationStartRequests.leaseToken, leaseToken)
        )
      );
  }

  public async markRetry(input: {
    requirementRunId: string;
    leaseToken: string;
    availableAt: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    await this.connection.db
      .update(generationStartRequests)
      .set({
        status: "pending",
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: input.availableAt,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage.slice(0, 2_000),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(generationStartRequests.requirementRunId, input.requirementRunId),
          eq(generationStartRequests.status, "processing"),
          eq(generationStartRequests.leaseToken, input.leaseToken)
        )
      );
  }

  public async markFailed(input: {
    requirementRunId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    await this.connection.db
      .update(generationStartRequests)
      .set({
        status: "failed",
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        lastErrorMessage: input.errorMessage.slice(0, 2_000),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(generationStartRequests.requirementRunId, input.requirementRunId),
          eq(generationStartRequests.status, "processing"),
          eq(generationStartRequests.leaseToken, input.leaseToken)
        )
      );
  }
}
