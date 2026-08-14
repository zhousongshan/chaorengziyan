import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyConversationState, environmentSchema } from "@chaoren/contracts";

import { OpenAiCompatibleRequirementAiAdapter } from "../src/requirements/openai-compatible-requirement-ai.adapter.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAiCompatibleRequirementAiAdapter multimodal conversation", () => {
  it("sends text and images together through the configured GPT vision channel", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assistantReply: "需求已整理",
                    changedFields: ["background"],
                    assetMemories: [
                      {
                        key: "image_1",
                        caption: "白色服装商品图",
                        ocrText: null,
                        productFacts: { color: "white" },
                        creativeFacts: {}
                      }
                    ],
                    result: {
                      schemaVersion: "1.0",
                      status: "needs_clarification",
                      questions: ["请说明目标背景"],
                      conflictDecisions: []
                    }
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const environment = environmentSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
      REDIS_URL: "redis://127.0.0.1:6379",
      REQUIREMENT_AI_BASE_URL: "https://jennyapi.site/v1",
      REQUIREMENT_AI_API_KEY: "multimodal-key",
      REQUIREMENT_AI_MODEL: "gpt-5.6-sol",
      SUBJECT_INSPECTION_AI_BASE_URL: "https://jennyapi.site/v1",
      SUBJECT_INSPECTION_AI_API_KEY: "multimodal-key",
      SUBJECT_INSPECTION_AI_MODEL: "gpt-5.6-sol"
    });
    const adapter = new OpenAiCompatibleRequirementAiAdapter(environment);

    await adapter.resolveConversation(
      {
        sessionState: emptyConversationState,
        recentTurns: [],
        retrievedLongTermMemory: [],
        assetMemories: [],
        currentTurn: {
          text: "换成蓝色背景",
          imageSettings: {},
          attachments: []
        }
      },
      { maxImageCount: 4, allowedAspectRatios: ["1:1"] },
      [
        {
          key: "image_1",
          role: "product_source",
          relation: "本轮商品原图",
          mimeType: "image/png",
          content: Buffer.from("image-content")
        }
      ]
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://jennyapi.site/v1/chat/completions");
    const request = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(request.model).toBe("gpt-5.6-sol");
    expect(request.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "image_url",
          image_url: expect.objectContaining({
            url: expect.stringMatching(/^data:image\/png;base64,/)
          })
        })
      ])
    );
  });
});
