import type { ConversationRequirementContext } from "../conversations/conversation-context.js";

export const REQUIREMENT_AI_PORT = Symbol("REQUIREMENT_AI_PORT");

export interface RequirementValidationIssue {
  field: string;
  message: string;
}

export interface RequirementExecutionConstraints {
  maxImageCount: number;
  allowedAspectRatios: string[];
}

export interface RequirementAiCallOptions {
  timeoutMs: number;
}

export interface RepairConversationRequirementInput {
  originalInput: ConversationRequirementContext;
  previousOutput: unknown;
  validationIssues: RequirementValidationIssue[];
  constraints: RequirementExecutionConstraints;
  images: ConversationRequirementImage[];
}

export interface ConversationRequirementImage {
  key: string;
  role:
    | "product_source"
    | "user_reference"
    | "edit_base"
    | "generated_result"
    | "selected_result"
    | "rejected_result";
  relation: string | null;
  productEntities: Array<{ id: string; label: string | null }>;
  mimeType: string;
  content: Buffer;
}

export interface RequirementAiPort {
  resolveConversation(
    input: ConversationRequirementContext,
    constraints: RequirementExecutionConstraints,
    images: ConversationRequirementImage[],
    options?: RequirementAiCallOptions
  ): Promise<unknown>;
  repairConversation(
    input: RepairConversationRequirementInput,
    options?: RequirementAiCallOptions
  ): Promise<unknown>;
}
