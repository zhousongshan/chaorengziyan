import { Inject, Injectable } from "@nestjs/common";

import { requirementAiAttempts, type DatabaseConnection } from "@chaoren/database";

import { DATABASE_CONNECTION } from "../database/database.constants.js";
import type {
  RequirementAiAttemptRecord,
  RequirementAiAttemptRepository
} from "./requirement-ai-attempt.repository.js";

@Injectable()
export class DrizzleRequirementAiAttemptRepository implements RequirementAiAttemptRepository {
  public constructor(
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection
  ) {}

  public async save(record: RequirementAiAttemptRecord): Promise<void> {
    await this.connection.db.insert(requirementAiAttempts).values({
      sessionId: record.sessionId,
      sourceMessageId: record.sourceMessageId,
      attemptNumber: record.attemptNumber,
      status: record.status,
      rawOutput: toJsonValue(record.rawOutput),
      validationIssues: record.validationIssues,
      aiModel: record.aiModel,
      promptVersion: record.promptVersion,
      contractVersion: record.contractVersion
    });
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
