import type {
  ConversationMessage,
  ConversationMessagePageInfo,
  ConversationMessageAsset,
  ConversationRequirementRun,
  ConversationSession,
  ConversationState,
  ConversationStateSnapshot,
  CreateConversationMessageRequest,
  RequirementResult,
  ResolveRequirementRequest,
  ResolvedGenerationPlan
} from "@chaoren/contracts";

export const CONVERSATION_REPOSITORY = Symbol("CONVERSATION_REPOSITORY");

export interface ConversationSessionRecord extends ConversationSession {
  userId: string;
}

export interface StartConversationTurnInput {
  sessionId: string;
  userId: string;
  expectedVersion: number;
  messageId: string;
  idempotencyKey: string;
  content: string;
  assets: ConversationMessageAsset[];
  request: CreateConversationMessageRequest;
}

export interface ConversationTurnRunRecord {
  messageId: string;
  sessionId: string;
  userId: string;
  request: CreateConversationMessageRequest;
  status: "queued" | "processing" | "completed" | "failed";
  leaseToken: string;
}

export type StartConversationTurnResult =
  | {
      status: "started";
      session: ConversationSessionRecord;
      message: ConversationMessage;
      snapshot: ConversationStateSnapshot;
    }
  | { status: "not_found" }
  | { status: "version_conflict"; actualVersion: number }
  | { status: "busy"; processingMessageId: string }
  | { status: "duplicate"; message: ConversationMessage }
  | { status: "idempotency_conflict" }
  | { status: "prompt_optimization_not_adoptable" };

export type RestartConversationTurnResult =
  | { status: "started"; session: ConversationSessionRecord; message: ConversationMessage }
  | { status: "not_found" }
  | { status: "not_failed" }
  | { status: "busy"; processingMessageId: string }
  | { status: "version_conflict"; actualVersion: number };

export interface CompleteConversationTurnInput {
  sessionId: string;
  userId: string;
  sourceMessageId: string;
  leaseToken: string;
  assistantMessageId: string;
  assistantContent: string;
  snapshotId: string;
  baseVersion: number;
  turnNumber: number;
  state: ConversationState;
  memoryContent: string;
  memoryStructuredData?: Record<string, unknown>;
  memorySearchText?: string;
  requirementRun?: {
    id: string;
    request: ResolveRequirementRequest;
    result: RequirementResult;
    executionPlan: ResolvedGenerationPlan;
    executionPlanHash: string;
    aiModel: string;
    promptVersion: string;
  } | null;
}

export interface ConversationMemoryEntryRecord {
  turnNumber: number;
  content: string;
  structuredData: Record<string, unknown>;
  status: "active" | "superseded" | "rejected" | "historical";
}

export interface ConversationMessagePageRecord {
  messages: ConversationMessage[];
  pageInfo: ConversationMessagePageInfo;
}

export interface ConversationRepository {
  createSession(input: {
    id: string;
    snapshotId: string;
    userId: string;
    projectId: string;
    agentId: string;
    title: string;
    state: ConversationState;
    createdAt: string;
  }): Promise<ConversationSessionRecord>;
  ensureSession(input: {
    id: string;
    snapshotId: string;
    userId: string;
    projectId: string;
    agentId: string;
    title: string;
    state: ConversationState;
    createdAt: string;
  }): Promise<ConversationSessionRecord>;
  findSessionByAgent(
    userId: string,
    agentId: string
  ): Promise<ConversationSessionRecord | undefined>;
  findSession(sessionId: string, userId: string): Promise<ConversationSessionRecord | undefined>;
  findLatestSnapshot(
    sessionId: string,
    userId: string
  ): Promise<ConversationStateSnapshot | undefined>;
  findSnapshot(
    snapshotId: string,
    sessionId: string,
    userId: string
  ): Promise<ConversationStateSnapshot | undefined>;
  listContextMessages(
    sessionId: string,
    userId: string,
    input: { currentMessageId: string; recentCompletedTurnCount: number }
  ): Promise<ConversationMessage[]>;
  listMessagesForTurns(
    sessionId: string,
    userId: string,
    turnNumbers: number[]
  ): Promise<ConversationMessage[]>;
  listMessagePage(
    sessionId: string,
    userId: string,
    input: { beforeTurn?: number; limit: number }
  ): Promise<ConversationMessagePageRecord>;
  listMemoryEntriesForContext(
    sessionId: string,
    userId: string,
    input: { relevantTurnNumbers: number[]; beforeTurn: number; olderLimit: number }
  ): Promise<ConversationMemoryEntryRecord[]>;
  findLatestRequirementRun(
    sessionId: string,
    userId: string
  ): Promise<
    { sourceMessageId: string; requirementRunId: string; result: RequirementResult } | undefined
  >;
  listRequirementRunsForMessages(
    sessionId: string,
    userId: string,
    sourceMessageIds: string[]
  ): Promise<ConversationRequirementRun[]>;
  startTurn(input: StartConversationTurnInput): Promise<StartConversationTurnResult>;
  restartFailedTurn(input: {
    sessionId: string;
    userId: string;
    messageId: string;
  }): Promise<RestartConversationTurnResult>;
  claimTurnRun(
    messageId: string,
    input: { leaseExpiresAt: string }
  ): Promise<ConversationTurnRunRecord | undefined>;
  renewTurnLease(input: {
    messageId: string;
    leaseToken: string;
    leaseExpiresAt: string;
  }): Promise<boolean>;
  findDispatchableTurnMessageIds(input: {
    now: string;
    maxAttempts: number;
    limit: number;
  }): Promise<string[]>;
  recordTurnEnqueueAttempt(messageId: string, errorMessage?: string): Promise<void>;
  completeTurn(input: CompleteConversationTurnInput): Promise<{
    session: ConversationSessionRecord;
    assistantMessage: ConversationMessage;
    snapshot: ConversationStateSnapshot;
  }>;
  failTurn(input: {
    sessionId: string;
    userId: string;
    messageId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<boolean>;
}
