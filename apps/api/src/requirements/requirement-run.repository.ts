import type {
  RequirementResult,
  ResolveRequirementRequest,
  ResolvedGenerationPlan
} from "@chaoren/contracts";

export const REQUIREMENT_RUN_REPOSITORY = Symbol("REQUIREMENT_RUN_REPOSITORY");

export interface RequirementRunRecord {
  id: string;
  parentRequirementRunId: string | null;
  sessionId?: string | null;
  sourceMessageId?: string | null;
  stateSnapshotId?: string | null;
  userId: string;
  request: ResolveRequirementRequest;
  result: RequirementResult;
  executionPlan?: ResolvedGenerationPlan | null;
  executionPlanHash?: string | null;
  aiModel: string;
  promptVersion: string;
  createdAt: string;
}

export interface RequirementRunRepository {
  save(record: RequirementRunRecord): Promise<void>;
  findById(id: string): Promise<RequirementRunRecord | undefined>;
}
