import { describe, expect, it } from "vitest";

import type {
  ConversationHistoryResponse,
  ConversationMessage,
  ConversationMessagesPageResponse
} from "@chaoren/contracts";

import {
  mergeLatestConversationHistory,
  mergeOlderConversationHistory
} from "./conversation-history-pagination";

describe("conversation history pagination", () => {
  it("keeps loaded older turns when the latest window advances", () => {
    const initial = history([message(21), message(22)], true, 21);
    const older = page([message(1), message(2)], false, null);
    const loaded = mergeOlderConversationHistory(
      mergeLatestConversationHistory(null, initial),
      older
    );
    const refreshed = mergeLatestConversationHistory(
      loaded,
      history([message(22), message(23)], true, 22)
    );

    expect(refreshed.messages.map((item) => item.turnNumber)).toEqual([1, 2, 21, 22, 23]);
    expect(refreshed.messagePage.hasMore).toBe(false);
  });

  it("deduplicates a polled message already merged after submission", () => {
    const initial = mergeLatestConversationHistory(null, history([message(20)], true, 20));
    const refreshed = mergeLatestConversationHistory(
      initial,
      history([message(20), message(21)], true, 20)
    );
    const repeated = mergeLatestConversationHistory(refreshed, history([message(21)], true, 21));

    expect(repeated.messages.map((item) => item.turnNumber)).toEqual([20, 21]);
  });
});

function history(
  messages: ConversationMessage[],
  hasMore: boolean,
  nextBeforeTurn: number | null
): ConversationHistoryResponse {
  return {
    session: {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: "00000000-0000-4000-8000-000000000002",
      agentId: "00000000-0000-4000-8000-000000000003",
      title: "分页测试",
      mode: "image",
      status: "active",
      version: 23,
      processingMessageId: null,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z"
    },
    messages,
    latestSnapshot: {} as ConversationHistoryResponse["latestSnapshot"],
    requirementRuns: [],
    latestRequirementRun: null,
    messagePage: {
      limit: 20,
      oldestTurn: messages.at(0)?.turnNumber ?? null,
      newestTurn: messages.at(-1)?.turnNumber ?? null,
      hasMore,
      nextBeforeTurn
    }
  };
}

function page(
  messages: ConversationMessage[],
  hasMore: boolean,
  nextBeforeTurn: number | null
): ConversationMessagesPageResponse {
  return {
    messages,
    requirementRuns: [],
    messagePage: {
      limit: 20,
      oldestTurn: messages.at(0)?.turnNumber ?? null,
      newestTurn: messages.at(-1)?.turnNumber ?? null,
      hasMore,
      nextBeforeTurn
    }
  };
}

function message(turnNumber: number): ConversationMessage {
  return {
    id: `00000000-0000-4000-8000-${turnNumber.toString().padStart(12, "0")}`,
    sessionId: "00000000-0000-4000-8000-000000000001",
    turnNumber,
    role: "user",
    content: `第 ${turnNumber} 轮`,
    status: "completed",
    assets: [],
    errorCode: null,
    errorMessage: null,
    createdAt: `2026-08-10T00:00:${turnNumber.toString().padStart(2, "0")}.000Z`
  };
}
