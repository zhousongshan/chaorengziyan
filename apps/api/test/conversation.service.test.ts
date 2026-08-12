import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyConversationState,
  environmentSchema,
  type ConversationSession
} from "@chaoren/contracts";

import { ConversationService } from "../src/conversations/conversation.service.js";
import type { ConversationRepository } from "../src/conversations/conversation.repository.js";

const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379"
});
const agentA = "00000000-0000-4000-8000-000000000100";
const agentB = "00000000-0000-4000-8000-000000000101";
const sessionId = "00000000-0000-4000-8000-000000000200";

describe("ConversationService Agent isolation", () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let agents: { findById: ReturnType<typeof vi.fn> };
  let projects: { assertOwned: ReturnType<typeof vi.fn> };
  let service: ConversationService;

  beforeEach(() => {
    repository = {
      createSession: vi.fn(),
      ensureSession: vi.fn(),
      findSessionByAgent: vi.fn().mockResolvedValue(undefined),
      findSession: vi.fn(),
      findLatestSnapshot: vi.fn().mockResolvedValue(snapshot()),
      listContextMessages: vi.fn().mockResolvedValue([]),
      listMessagesForTurns: vi.fn().mockResolvedValue([]),
      listMessagePage: vi.fn().mockResolvedValue({
        messages: [],
        pageInfo: {
          limit: 20,
          oldestTurn: null,
          newestTurn: null,
          hasMore: false,
          nextBeforeTurn: null
        }
      }),
      listMemoryEntriesForContext: vi.fn().mockResolvedValue([]),
      findLatestRequirementRun: vi.fn().mockResolvedValue(undefined),
      listRequirementRunsForMessages: vi.fn().mockResolvedValue([]),
      startTurn: vi.fn(),
      restartFailedTurn: vi.fn(),
      claimTurnRun: vi.fn(),
      findDispatchableTurnMessageIds: vi.fn(),
      recordTurnEnqueueAttempt: vi.fn(),
      completeTurn: vi.fn(),
      failTurn: vi.fn()
    };
    agents = { findById: vi.fn().mockResolvedValue({ id: agentA }) };
    projects = { assertOwned: vi.fn().mockResolvedValue(undefined) };
    service = new ConversationService(
      environment,
      repository as unknown as ConversationRepository,
      agents as never,
      projects as never,
      { getOwnedImages: vi.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never
    );
  });

  it("scopes the current lookup to the selected Agent", async () => {
    repository.findSessionByAgent.mockResolvedValue(session(agentA));

    await expect(service.current({ agentId: agentA })).resolves.toMatchObject({
      session: { id: sessionId, agentId: agentA }
    });
    expect(repository.findSessionByAgent).toHaveBeenCalledWith(environment.LOCAL_USER_ID, agentA);
  });

  it("ensures the same Agent conversation through the idempotent repository path", async () => {
    repository.ensureSession.mockResolvedValue(session(agentA));

    await expect(
      service.create({
        projectId: session(agentA).projectId,
        agentId: agentA,
        title: "当前会话"
      })
    ).resolves.toMatchObject({ id: sessionId, agentId: agentA });
    expect(projects.assertOwned).toHaveBeenCalledWith(session(agentA).projectId);
    expect(agents.findById).toHaveBeenCalledWith(agentA);
    expect(repository.ensureSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: environment.LOCAL_USER_ID,
        projectId: session(agentA).projectId,
        agentId: agentA
      })
    );
  });

  it("rejects reusing an Agent conversation from a different project", async () => {
    repository.ensureSession.mockResolvedValue(session(agentA));

    await expect(
      service.create({
        projectId: "00000000-0000-4000-8000-000000000301",
        agentId: agentA,
        title: "错误项目"
      })
    ).rejects.toMatchObject({ response: { code: "CONVERSATION_PROJECT_MISMATCH" } });
  });

  it("does not open or send to a session owned by another Agent", async () => {
    repository.findSession.mockResolvedValue(session(agentB));

    await expect(service.getHistory(sessionId, { agentId: agentA })).rejects.toMatchObject({
      response: { code: "CONVERSATION_NOT_FOUND" }
    });
    await expect(
      service.sendMessage(sessionId, { agentId: agentA }, validMessageRequest())
    ).rejects.toMatchObject({ response: { code: "CONVERSATION_NOT_FOUND" } });
    expect(repository.startTurn).not.toHaveBeenCalled();
  });

  it("rejects an unbound legacy session instead of exposing it through an Agent", async () => {
    repository.findSession.mockResolvedValue(session(null));

    await expect(service.getHistory(sessionId, { agentId: agentA })).rejects.toMatchObject({
      response: { code: "CONVERSATION_NOT_FOUND" }
    });
  });

  it("loads twenty turns by default and forwards an older-turn cursor", async () => {
    repository.findSession.mockResolvedValue(session(agentA));

    await service.getHistory(sessionId, { agentId: agentA });
    await service.getMessages(sessionId, { agentId: agentA, beforeTurn: "21", limit: "20" });

    expect(repository.listMessagePage).toHaveBeenNthCalledWith(
      1,
      sessionId,
      environment.LOCAL_USER_ID,
      { limit: 20 }
    );
    expect(repository.listMessagePage).toHaveBeenNthCalledWith(
      2,
      sessionId,
      environment.LOCAL_USER_ID,
      { beforeTurn: 21, limit: 20 }
    );
  });
});

function session(agentId: string | null): ConversationSession & { userId: string } {
  return {
    id: sessionId,
    userId: environment.LOCAL_USER_ID,
    projectId: "00000000-0000-4000-8000-000000000300",
    agentId,
    title: "测试会话",
    mode: "image",
    status: "active",
    version: 0,
    processingMessageId: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z"
  };
}

function snapshot() {
  return {
    id: "00000000-0000-4000-8000-000000000400",
    sessionId,
    throughTurn: 0,
    version: 0,
    state: emptyConversationState,
    createdAt: "2026-08-10T00:00:00.000Z"
  };
}

function validMessageRequest() {
  return {
    expectedVersion: 0,
    idempotencyKey: "00000000-0000-4000-8000-000000000500",
    modelId: "test-model",
    text: "生成一张商品图",
    imageSettings: {},
    attachments: []
  };
}
