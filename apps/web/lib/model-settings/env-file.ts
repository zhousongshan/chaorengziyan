export const fixedModelConfiguration = {
  REQUIREMENT_AI_MODEL: "gpt-5.6-sol",
  SUBJECT_INSPECTION_AI_MODEL: "gpt-5.6-sol",
  OPENAI_IMAGE_MODEL: "gpt-image-2",
  OPENAI_IMAGE_API_MODE: "async-relay",
  ENABLED_IMAGE_MODELS: "openai-image"
} as const;

export interface ModelEnvironmentUpdate {
  requirementBaseUrl: string;
  requirementApiKey?: string | undefined;
  promptOptimizationBaseUrl?: string | undefined;
  promptOptimizationApiKey?: string | undefined;
  promptOptimizationModel?: string | undefined;
  imageBaseUrl: string;
  imageApiKey?: string | undefined;
  inspectionBaseUrl: string;
  inspectionApiKey?: string | undefined;
}

export function parseEnvironmentFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || rawValue === undefined) continue;
    values[key] = parseEnvironmentValue(rawValue);
  }
  return values;
}

export function updateModelEnvironmentFile(
  content: string,
  update: ModelEnvironmentUpdate
): string {
  const values: Record<string, string> = {
    REQUIREMENT_AI_BASE_URL: update.requirementBaseUrl,
    REQUIREMENT_AI_MODEL: fixedModelConfiguration.REQUIREMENT_AI_MODEL,
    SUBJECT_INSPECTION_AI_BASE_URL: update.inspectionBaseUrl,
    SUBJECT_INSPECTION_AI_MODEL: fixedModelConfiguration.SUBJECT_INSPECTION_AI_MODEL,
    OPENAI_IMAGE_BASE_URL: update.imageBaseUrl,
    OPENAI_IMAGE_MODEL: fixedModelConfiguration.OPENAI_IMAGE_MODEL,
    OPENAI_IMAGE_API_MODE: fixedModelConfiguration.OPENAI_IMAGE_API_MODE,
    ENABLED_IMAGE_MODELS: fixedModelConfiguration.ENABLED_IMAGE_MODELS
  };

  if (update.promptOptimizationBaseUrl) {
    values.PROMPT_OPTIMIZATION_AI_BASE_URL = update.promptOptimizationBaseUrl;
  }
  if (update.promptOptimizationModel) {
    values.PROMPT_OPTIMIZATION_AI_MODEL = update.promptOptimizationModel;
  }

  if (update.requirementApiKey) values.REQUIREMENT_AI_API_KEY = update.requirementApiKey;
  if (update.promptOptimizationApiKey) {
    values.PROMPT_OPTIMIZATION_AI_API_KEY = update.promptOptimizationApiKey;
  }
  if (update.imageApiKey) values.OPENAI_IMAGE_API_KEY = update.imageApiKey;
  if (update.inspectionApiKey) values.SUBJECT_INSPECTION_AI_API_KEY = update.inspectionApiKey;

  let next = content;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${serializeEnvironmentValue(value)}`;
    const expression = new RegExp(`^${key}=.*$`, "m");
    next = expression.test(next)
      ? next.replace(expression, line)
      : `${next.replace(/\s*$/, "")}\n${line}\n`;
  }
  return next.endsWith("\n") ? next : `${next}\n`;
}

function parseEnvironmentValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function serializeEnvironmentValue(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : JSON.stringify(value);
}
