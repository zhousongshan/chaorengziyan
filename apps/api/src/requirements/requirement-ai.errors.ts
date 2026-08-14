export type RequirementAiErrorCode =
  | "REQUIREMENT_AI_TIMEOUT"
  | "REQUIREMENT_AI_RATE_LIMITED"
  | "REQUIREMENT_AI_SERVICE_UNAVAILABLE"
  | "REQUIREMENT_AI_AUTH_FAILED"
  | "REQUIREMENT_AI_NOT_CONFIGURED"
  | "REQUIREMENT_AI_CAPABILITY_UNSUPPORTED"
  | "REQUIREMENT_AI_INVALID_RESPONSE";

export type RequirementAiErrorPhase = "configuration" | "request" | "response";

export class RequirementAiError extends Error {
  public constructor(
    public readonly code: RequirementAiErrorCode,
    public readonly phase: RequirementAiErrorPhase,
    public readonly retryable: boolean,
    public readonly httpStatus: number,
    public readonly publicMessage: string,
    public readonly diagnostics: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(publicMessage, cause === undefined ? undefined : { cause });
    this.name = "RequirementAiError";
  }
}

export class RequirementAiConfigurationError extends RequirementAiError {
  public constructor(message = "需求理解服务尚未完成配置") {
    super("REQUIREMENT_AI_NOT_CONFIGURED", "configuration", false, 503, message);
    this.name = "RequirementAiConfigurationError";
  }
}

export function normalizeRequirementAiError(error: unknown): RequirementAiError {
  if (error instanceof RequirementAiError) return error;
  return new RequirementAiError(
    "REQUIREMENT_AI_SERVICE_UNAVAILABLE",
    "request",
    true,
    503,
    "需求理解服务暂时不可用",
    { errorName: error instanceof Error ? error.name : typeof error },
    error
  );
}
