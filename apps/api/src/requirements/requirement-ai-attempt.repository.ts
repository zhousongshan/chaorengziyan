import type { RequirementValidationIssue } from "./requirement-ai.port.js";

export const REQUIREMENT_AI_ATTEMPT_REPOSITORY = Symbol("REQUIREMENT_AI_ATTEMPT_REPOSITORY");

export interface RequirementAiAttemptRecord {
  sessionId: string;
  sourceMessageId: string;
  attemptNumber: 1 | 2;
  status: "contract_valid" | "contract_invalid";
  rawOutput: unknown;
  validationIssues: RequirementValidationIssue[];
  aiModel: string;
  promptVersion: string;
  contractVersion: string;
}

export interface RequirementAiAttemptRepository {
  save(record: RequirementAiAttemptRecord): Promise<void>;
}
