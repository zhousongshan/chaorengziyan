import type { Environment } from "@chaoren/contracts";

export interface MultimodalAiConfiguration {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
}

export function getConversationRequirementConfiguration(
  environment: Environment
): MultimodalAiConfiguration {
  return {
    baseUrl: environment.REQUIREMENT_AI_BASE_URL,
    apiKey: environment.REQUIREMENT_AI_API_KEY,
    model: environment.REQUIREMENT_AI_MODEL,
    timeoutMs: environment.REQUIREMENT_AI_TIMEOUT_MS
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
