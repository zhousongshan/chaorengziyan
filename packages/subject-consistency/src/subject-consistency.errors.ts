export class SubjectConsistencyConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SubjectConsistencyConfigurationError";
  }
}

export class SubjectConsistencyProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "SubjectConsistencyProviderError";
  }
}
