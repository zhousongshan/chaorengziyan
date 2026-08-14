import type { RequirementAiErrorCode, RequirementAiErrorPhase } from "./requirement-ai.errors.js";
import type { RequirementValidationIssue } from "./requirement-ai.port.js";

export const REQUIREMENT_AI_ATTEMPT_REPOSITORY = Symbol("REQUIREMENT_AI_ATTEMPT_REPOSITORY");

export type RequirementAiAttemptPhase = "resolve" | "repair";

export interface BeginRequirementAiAttemptInput {
  sessionId: string;
  sourceMessageId: string;
  attemptNumber: number;
  phase: RequirementAiAttemptPhase;
  phaseAttemptNumber: number;
  aiModel: string;
  promptVersion: string;
  contractVersion: string;
  startedAt: Date;
}

export interface CompleteRequirementAiAttemptInput {
  id: string;
  status: "contract_valid" | "contract_invalid";
  rawOutput: unknown;
  validationIssues: RequirementValidationIssue[];
  completedAt: Date;
  durationMs: number;
}

export interface FailRequirementAiAttemptInput {
  id: string;
  errorCode: RequirementAiErrorCode;
  errorPhase: RequirementAiErrorPhase;
  errorDetails: Record<string, unknown>;
  completedAt: Date;
  durationMs: number;
}

export interface RequirementAiAttemptRepository {
  begin(input: BeginRequirementAiAttemptInput): Promise<string>;
  complete(input: CompleteRequirementAiAttemptInput): Promise<void>;
  fail(input: FailRequirementAiAttemptInput): Promise<void>;
}
