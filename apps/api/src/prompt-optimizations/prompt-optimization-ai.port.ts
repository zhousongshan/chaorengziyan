import type {
  CreatePromptOptimizationRequest,
  PromptOptimizationOperation
} from "@chaoren/contracts";

export const PROMPT_OPTIMIZATION_AI_PORT = Symbol("PROMPT_OPTIMIZATION_AI_PORT");

export interface PromptOptimizationImage {
  key: string;
  role: CreatePromptOptimizationRequest["attachments"][number]["role"];
  relation: string | null;
  mimeType: string;
  content: Buffer;
}

export interface PromptOptimizationAiInput {
  operation: PromptOptimizationOperation;
  text: string;
  revisionInstruction: string | null;
  imageSettings: CreatePromptOptimizationRequest["imageSettings"];
  limitedContext: {
    currentRequirement: unknown;
    agentInstruction: string;
  };
  generationModel: {
    id: string;
    provider: string;
    maxImageCount: number;
    supportedAspectRatios: string[];
  };
  images: PromptOptimizationImage[];
}

export interface PromptOptimizationRepairInput extends PromptOptimizationAiInput {
  previousOutput: unknown;
  validationIssues: Array<{ field: string; message: string }>;
}

export interface PromptOptimizationAiPort {
  optimize(input: PromptOptimizationAiInput): Promise<unknown>;
  repair(input: PromptOptimizationRepairInput): Promise<unknown>;
  getModelName(): string;
}
