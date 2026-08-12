import { describe, expect, it } from "vitest";

import {
  currentConversationResponseSchema,
  conversationHistoryQuerySchema,
  createConversationRequestSchema
} from "../src/conversation.js";

describe("conversation contracts", () => {
  it("requires an Agent for every newly created conversation", () => {
    expect(
      createConversationRequestSchema.safeParse({
        projectId: "00000000-0000-4000-8000-000000000030"
      }).success
    ).toBe(false);
    expect(
      createConversationRequestSchema.safeParse({
        projectId: "00000000-0000-4000-8000-000000000030",
        agentId: "00000000-0000-4000-8000-000000000100"
      }).success
    ).toBe(true);
  });

  it("parses the one current conversation returned for an Agent", () => {
    expect(
      currentConversationResponseSchema.parse({
        session: {
          id: "00000000-0000-4000-8000-000000000020",
          projectId: "00000000-0000-4000-8000-000000000030",
          agentId: "00000000-0000-4000-8000-000000000100",
          title: "夏季商品主图",
          mode: "image",
          status: "active",
          version: 2,
          processingMessageId: null,
          createdAt: "2026-08-09T08:00:00.000Z",
          updatedAt: "2026-08-10T08:00:00.000Z"
        }
      })
    ).toMatchObject({ session: { title: "夏季商品主图" } });
  });

  it("defaults history pages to twenty turns and parses an older-turn cursor", () => {
    expect(
      conversationHistoryQuerySchema.parse({
        agentId: "00000000-0000-4000-8000-000000000100"
      })
    ).toMatchObject({ limit: 20 });
    expect(
      conversationHistoryQuerySchema.parse({
        agentId: "00000000-0000-4000-8000-000000000100",
        beforeTurn: "41",
        limit: "20"
      })
    ).toMatchObject({ beforeTurn: 41, limit: 20 });
    expect(
      conversationHistoryQuerySchema.safeParse({
        agentId: "00000000-0000-4000-8000-000000000100",
        limit: 51
      }).success
    ).toBe(false);
  });
});
