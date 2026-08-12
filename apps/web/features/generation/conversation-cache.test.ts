import { describe, expect, it } from "vitest";

import {
  emptyConversationState,
  type ConversationHistoryResponse,
  type CreateConversationMessageResponse
} from "@chaoren/contracts";

import { mergeAcceptedConversationTurn } from "./conversation-cache";

describe("conversation cache", () => {
  it("adds an accepted user message once and updates the session", () => {
    const response = acceptedTurnResponse();
    const history: ConversationHistoryResponse = {
      session: { ...response.session, processingMessageId: null },
      messages: [],
      requirementRuns: [],
      latestSnapshot: {
        id: "00000000-0000-4000-8000-000000000004",
        sessionId: response.session.id,
        throughTurn: 0,
        version: 0,
        state: emptyConversationState,
        createdAt: "2026-08-10T08:00:00.000Z"
      },
      latestRequirementRun: null,
      messagePage: {
        limit: 20,
        oldestTurn: null,
        newestTurn: null,
        hasMore: false,
        nextBeforeTurn: null
      }
    };

    const merged = mergeAcceptedConversationTurn(history, response);
    expect(merged?.session.processingMessageId).toBe(response.userMessage.id);
    expect(merged?.messages).toEqual([response.userMessage]);
    expect(mergeAcceptedConversationTurn(merged, response)?.messages).toHaveLength(1);
  });
});

function acceptedTurnResponse(): CreateConversationMessageResponse {
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const messageId = "00000000-0000-4000-8000-000000000002";
  return {
    status: "processing",
    session: {
      id: sessionId,
      projectId: "00000000-0000-4000-8000-000000000003",
      agentId: "00000000-0000-4000-8000-000000000010",
      title: "缓存测试",
      mode: "image",
      status: "active",
      version: 0,
      processingMessageId: messageId,
      createdAt: "2026-08-10T08:00:00.000Z",
      updatedAt: "2026-08-10T08:00:01.000Z"
    },
    userMessage: {
      id: messageId,
      sessionId,
      turnNumber: 1,
      role: "user",
      content: "生成商品主图",
      status: "processing",
      assets: [],
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-10T08:00:01.000Z"
    }
  };
}
