import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { requirementAiAttempts, type DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type {
  BeginRequirementAiAttemptInput,
  CompleteRequirementAiAttemptInput,
  FailRequirementAiAttemptInput,
  RequirementAiAttemptRepository
} from "./requirement-ai-attempt.repository.js";

@Injectable()
export class DrizzleRequirementAiAttemptRepository implements RequirementAiAttemptRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async begin(input: BeginRequirementAiAttemptInput): Promise<string> {
    const [created] = await this.connection.db
      .insert(requirementAiAttempts)
      .values({
        sessionId: input.sessionId,
        sourceMessageId: input.sourceMessageId,
        attemptNumber: input.attemptNumber,
        phase: input.phase,
        phaseAttemptNumber: input.phaseAttemptNumber,
        status: "running",
        rawOutput: null,
        validationIssues: [],
        aiModel: input.aiModel,
        promptVersion: input.promptVersion,
        contractVersion: input.contractVersion,
        startedAt: input.startedAt
      })
      .returning({ id: requirementAiAttempts.id });
    if (!created) throw new Error("REQUIREMENT_AI_ATTEMPT_CREATE_FAILED");
    return created.id;
  }

  public async complete(input: CompleteRequirementAiAttemptInput): Promise<void> {
    await this.connection.db
      .update(requirementAiAttempts)
      .set({
        status: input.status,
        rawOutput: toJsonValue(input.rawOutput),
        validationIssues: input.validationIssues,
        completedAt: input.completedAt,
        durationMs: input.durationMs,
        errorCode: null,
        errorPhase: null,
        errorDetails: null
      })
      .where(eq(requirementAiAttempts.id, input.id));
  }

  public async fail(input: FailRequirementAiAttemptInput): Promise<void> {
    await this.connection.db
      .update(requirementAiAttempts)
      .set({
        status: "request_failed",
        completedAt: input.completedAt,
        durationMs: input.durationMs,
        errorCode: input.errorCode,
        errorPhase: input.errorPhase,
        errorDetails: toJsonValue(input.errorDetails)
      })
      .where(eq(requirementAiAttempts.id, input.id));
  }
}

function toJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return value instanceof Error ? value.message : "UNSERIALIZABLE_AI_OUTPUT";
  }
}
