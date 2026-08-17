export const GENERATION_START_REQUEST_REPOSITORY = Symbol("GENERATION_START_REQUEST_REPOSITORY");

export interface GenerationStartRequestRecord {
  requirementRunId: string;
  userId: string;
  sessionId: string | null;
  idempotencyKey: string;
  attemptCount: number;
  leaseToken: string;
}

export interface GenerationStartRequestRepository {
  claimPending(input: {
    now: Date;
    leaseDurationMs: number;
    limit: number;
  }): Promise<GenerationStartRequestRecord[]>;
  markDispatched(requirementRunId: string, leaseToken: string): Promise<void>;
  markRetry(input: {
    requirementRunId: string;
    leaseToken: string;
    availableAt: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  markFailed(input: {
    requirementRunId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}
