import type {
  CreatePromptOptimizationRequest,
  PromptOptimization,
  PromptOptimizationImageDecisionStatus,
  PromptOptimizationInputRevision
} from "@chaoren/contracts";

export const PROMPT_OPTIMIZATION_REPOSITORY = Symbol("PROMPT_OPTIMIZATION_REPOSITORY");

export interface PromptOptimizationRecord extends PromptOptimization {
  userId: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
  aiModel: string | null;
  promptVersion: string | null;
  executionToken: string;
}

export interface CreatePromptOptimizationRecordInput {
  id: string;
  userId: string;
  projectId: string;
  sessionId: string;
  idempotencyKey: string;
  requestHash: string;
  executionToken: string;
  staleBefore: string;
  request: CreatePromptOptimizationRequest;
  inputRevision: PromptOptimizationInputRevision;
  createdAt: string;
}

export type CreatePromptOptimizationRecordResult =
  | { status: "created" | "reclaimed" | "duplicate"; record: PromptOptimizationRecord }
  | { status: "idempotency_conflict" }
  | { status: "parent_not_available" };

export interface PromptOptimizationRepository {
  createOrFind(
    input: CreatePromptOptimizationRecordInput
  ): Promise<CreatePromptOptimizationRecordResult>;
  findByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<PromptOptimizationRecord | undefined>;
  findById(id: string, userId: string): Promise<PromptOptimizationRecord | undefined>;
  complete(input: {
    id: string;
    userId: string;
    executionToken: string;
    optimizedText: string;
    imageDecisionStatus: PromptOptimizationImageDecisionStatus;
    selectedImageKeys: string[];
    aiModel: string;
    promptVersion: string;
    completedAt: string;
  }): Promise<PromptOptimizationRecord | undefined>;
  fail(input: {
    id: string;
    userId: string;
    executionToken: string;
    errorCode: string;
    imageDecisionStatus?: Extract<PromptOptimizationImageDecisionStatus, "missing" | "ambiguous">;
    selectedImageKeys: string[];
    completedAt: string;
  }): Promise<PromptOptimizationRecord | undefined>;
}
