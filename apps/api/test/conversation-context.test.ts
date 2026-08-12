import { describe, expect, it } from "vitest";

import {
  emptyConversationState,
  type ConversationMessage,
  type CreateConversationMessageRequest
} from "@chaoren/contracts";

import {
  ConversationContextAssembler,
  ConversationContextLimitError
} from "../src/conversations/conversation-context.js";

const sessionId = "00000000-0000-4000-8000-000000000100";
const currentMessageId = "00000000-0000-4000-8000-000000000999";

function message(turnNumber: number, role: "user" | "assistant", content: string) {
  return {
    id: `00000000-0000-4000-8000-${String(turnNumber * 2 + (role === "assistant" ? 1 : 0)).padStart(12, "0")}`,
    sessionId,
    turnNumber,
    role,
    content,
    status: "completed",
    assets: [],
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(1_700_000_000_000 + turnNumber).toISOString()
  } satisfies ConversationMessage;
}

const currentRequest = {
  expectedVersion: 25,
  idempotencyKey: "00000000-0000-4000-8000-000000000998",
  modelId: "gpt-image-2",
  text: "继续刚才的方案",
  imageSettings: {},
  attachments: []
} satisfies CreateConversationMessageRequest;

describe("ConversationContextAssembler", () => {
  it("always includes the latest 20 completed turns in full", () => {
    const messages = Array.from({ length: 25 }, (_, index) => index + 1).flatMap((turn) => [
      message(turn, "user", `用户第${turn}轮完整文字`),
      message(turn, "assistant", `助手第${turn}轮完整文字`)
    ]);

    const context = new ConversationContextAssembler().assemble({
      messages,
      currentMessageId,
      currentRequest,
      state: emptyConversationState,
      recentTurnCount: 20,
      maximumCharacters: 1_000_000
    });

    expect(context.recentTurns).toHaveLength(20);
    expect(context.recentTurns[0]?.turnNumber).toBe(6);
    expect(context.recentTurns[19]?.turnNumber).toBe(25);
    expect(context.recentTurns[0]?.messages).toEqual([
      expect.objectContaining({ content: "用户第6轮完整文字" }),
      expect.objectContaining({ content: "助手第6轮完整文字" })
    ]);
  });

  it("retrieves an explicitly referenced turn older than the exact window", () => {
    const messages = Array.from({ length: 25 }, (_, index) => index + 1).flatMap((turn) => [
      message(turn, "user", `第${turn}轮内容`),
      message(turn, "assistant", `第${turn}轮回复`)
    ]);

    const context = new ConversationContextAssembler().assemble({
      messages,
      currentMessageId,
      currentRequest: { ...currentRequest, text: "恢复第 3 轮的背景方向" },
      state: emptyConversationState,
      recentTurnCount: 20,
      maximumCharacters: 1_000_000
    });

    expect(context.retrievedLongTermMemory).toContainEqual(
      expect.objectContaining({ turnNumber: 3, reason: "explicit_turn_reference" })
    );
  });

  it("provides a structured older-memory index even when the current turn shares no keyword", () => {
    const messages = Array.from({ length: 25 }, (_, index) => index + 1).flatMap((turn) => [
      message(turn, "user", `第${turn}轮内容`),
      message(turn, "assistant", `第${turn}轮回复`)
    ]);
    const sourceMessageId = message(3, "user", "").id;
    const context = new ConversationContextAssembler().assemble({
      messages,
      currentMessageId,
      currentRequest: { ...currentRequest, text: "还是用以前那个感觉" },
      state: {
        ...emptyConversationState,
        fieldSources: { style: { messageId: sourceMessageId, turnNumber: 3 } }
      },
      recentTurnCount: 20,
      maximumCharacters: 1_000_000,
      memoryEntries: [
        {
          turnNumber: 3,
          content: "早期创意方向",
          structuredData: {
            summary: "甜美柔和的户外花园风格",
            changedFields: ["style"],
            assetIds: []
          },
          status: "active"
        }
      ]
    });

    expect(context.olderMemoryIndex).toEqual([
      expect.objectContaining({
        turnNumber: 3,
        summary: "甜美柔和的户外花园风格",
        fieldChanges: [{ field: "style", status: "active" }]
      })
    ]);
  });

  it("never silently truncates the required exact window", () => {
    const messages = Array.from({ length: 20 }, (_, index) => index + 1).flatMap((turn) => [
      message(turn, "user", "很长的完整内容".repeat(100)),
      message(turn, "assistant", "必须完整保留".repeat(100))
    ]);

    expect(() =>
      new ConversationContextAssembler().assemble({
        messages,
        currentMessageId,
        currentRequest,
        state: emptyConversationState,
        recentTurnCount: 20,
        maximumCharacters: 1_000
      })
    ).toThrow(ConversationContextLimitError);
  });

  it("excludes failed turns from the 20 completed turns", () => {
    const failed = { ...message(1, "user", "失败输入"), status: "failed" as const };
    const context = new ConversationContextAssembler().assemble({
      messages: [failed, message(2, "user", "成功输入"), message(2, "assistant", "成功回复")],
      currentMessageId,
      currentRequest,
      state: emptyConversationState,
      recentTurnCount: 20,
      maximumCharacters: 100_000
    });

    expect(context.recentTurns.map((turn) => turn.turnNumber)).toEqual([2]);
  });
});
