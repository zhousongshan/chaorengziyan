import type { Environment } from "@chaoren/contracts";

export const MULTIMODAL_REQUIREMENT_MODEL = "gpt-5.6-sol";

export interface MultimodalAiConfiguration {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
}

export function getConversationRequirementConfiguration(
  environment: Environment
): MultimodalAiConfiguration {
  if (
    environment.REQUIREMENT_AI_MODEL === MULTIMODAL_REQUIREMENT_MODEL &&
    environment.REQUIREMENT_AI_API_KEY
  ) {
    return {
      baseUrl: environment.REQUIREMENT_AI_BASE_URL,
      apiKey: environment.REQUIREMENT_AI_API_KEY,
      model: environment.REQUIREMENT_AI_MODEL,
      timeoutMs: environment.REQUIREMENT_AI_TIMEOUT_MS
    };
  }
  return {
    baseUrl: environment.SUBJECT_INSPECTION_AI_BASE_URL,
    apiKey: environment.SUBJECT_INSPECTION_AI_API_KEY,
    model: environment.SUBJECT_INSPECTION_AI_MODEL,
    timeoutMs: environment.SUBJECT_INSPECTION_AI_TIMEOUT_MS
  };
}

export function getPromptOptimizationConfiguration(
  environment: Environment
): MultimodalAiConfiguration {
  const inherited = getConversationRequirementConfiguration(environment);
  if (!environment.PROMPT_OPTIMIZATION_AI_API_KEY) return inherited;

  return {
    baseUrl: environment.PROMPT_OPTIMIZATION_AI_BASE_URL ?? inherited.baseUrl,
    apiKey: environment.PROMPT_OPTIMIZATION_AI_API_KEY,
    model: environment.PROMPT_OPTIMIZATION_AI_MODEL ?? inherited.model,
    timeoutMs: environment.PROMPT_OPTIMIZATION_AI_TIMEOUT_MS ?? inherited.timeoutMs
  };
}
