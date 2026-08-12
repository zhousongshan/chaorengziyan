export class RequirementAiConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RequirementAiConfigurationError";
  }
}
