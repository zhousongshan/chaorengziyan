import { describe, expect, it, vi } from "vitest";

import {
  emptyConversationState,
  environmentSchema,
  type RequirementResult
} from "@chaoren/contracts";

import type { AuthorizationPort } from "../src/authorization/authorization.port.js";
import { ImageModelCatalog } from "../src/image-models/image-model.catalog.js";
import type { MediaAssetService } from "../src/media-assets/media-asset.service.js";
import type { ProjectService } from "../src/projects/project.service.js";
import type {
  RepairConversationRequirementInput,
  RequirementAiPort
} from "../src/requirements/requirement-ai.port.js";
import { InMemoryRequirementRunRepository } from "../src/requirements/in-memory-requirement-run.repository.js";
import { RequirementResultValidator } from "../src/requirements/requirement-result.validator.js";
import { RequirementService } from "../src/requirements/requirement.service.js";

const projectId = "00000000-0000-4000-8000-000000000010";
const environment = environmentSchema.parse({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
  REDIS_URL: "redis://127.0.0.1:6379",
  REQUIREMENT_AI_API_KEY: "test-key",
  MAX_IMAGE_COUNT: 4,
  ALLOWED_ASPECT_RATIOS: "1:1,3:4,9:16"
});

function readyResult(): Extract<RequirementResult, { status: "ready" }> {
  return {
    schemaVersion: "1.0",
    status: "ready",
    finalRequirement: {
      imageCount: 1,
      aspectRatio: "1:1",
      intent: "生成简洁的电商商品图",
      scene: null,
      background: null,
      composition: null,
      lighting: null,
      style: null,
      mustKeep: [],
      mustAvoid: [],
      subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
    },
    conflictDecisions: []
  };
}

function createService(options: {
  conversationOutput: unknown;
  repairedConversationOutput?: unknown;
}) {
  const resolveConversation = vi.fn(() => Promise.resolve(options.conversationOutput));
  const repairConversation = vi.fn((_input: RepairConversationRequirementInput) =>
    Promise.resolve(
      options.repairedConversationOutput ?? {
        contractVersion: "3.0",
        action: "generate",
        assistantReply: "开始生成",
        requirements: readyResult().finalRequirement
      }
    )
  );
  const requirementAi: RequirementAiPort = { resolveConversation, repairConversation };
  const authorization: AuthorizationPort = {
    assertAccess: vi.fn(() => Promise.resolve())
  };
  const projects = {
    assertOwned: vi.fn(() => Promise.resolve({ id: projectId }))
  } as unknown as ProjectService;
  const mediaAssets = {
    getOwnedImages: vi.fn(() => Promise.resolve([])),
    assertProductAvailableIds: vi.fn(() => Promise.resolve())
  } as unknown as MediaAssetService;
  const service = new RequirementService(
    environment,
    authorization,
    requirementAi,
    new InMemoryRequirementRunRepository(),
    { save: vi.fn(() => Promise.resolve()) },
    new RequirementResultValidator(),
    new ImageModelCatalog(environment),
    projects,
    mediaAssets
  );
  return { service, resolveConversation, repairConversation };
}

const request = {
  projectId,
  modelId: "bytedance-image",
  userText: "把背景换成花园",
  imageSettings: { imageCount: 1, aspectRatio: "1:1" },
  productImageIds: [],
  referenceImageIds: []
};

const context = {
  sessionState: emptyConversationState,
  recentTurns: [],
  retrievedLongTermMemory: [],
  olderMemoryIndex: [],
  assetMemories: [],
  currentTurn: {
    text: request.userText,
    imageSettings: request.imageSettings,
    agentInstruction: "",
    attachments: []
  }
};

describe("RequirementService conversation contract", () => {
  it("uses explicit text quantity over the UI and repairs one wrong AI decision", async () => {
    const userText = "生成的商品主图是4张完整且独立的";
    const wrongOutput = {
      contractVersion: "4.0",
      action: "generate",
      assistantReply: "开始生成三张",
      requirements: { imageCount: 3, intent: userText },
      quantityDecision: { source: "ui_control", value: 3, rule: "采用页面控件" },
      generationPlan: {
        schemaVersion: "2.0",
        summary: "错误的三张计划",
        groups: [
          { sourceImages: [], outputCount: 3, outputLayout: "separate_image", instruction: null }
        ]
      }
    };
    const evidenceQuote = "生成的商品主图是4张";
    const { service, repairConversation } = createService({
      conversationOutput: wrongOutput,
      repairedConversationOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "开始生成四张",
        requirements: { imageCount: 4, intent: userText },
        quantityDecision: {
          source: "explicit_user_text",
          value: 4,
          evidenceQuote,
          evidenceStart: 0,
          evidenceEnd: evidenceQuote.length
        },
        generationPlan: {
          schemaVersion: "2.0",
          summary: "四张独立输出",
          groups: [
            { sourceImages: [], outputCount: 4, outputLayout: "separate_image", instruction: null }
          ]
        }
      }
    });
    const currentRequest = {
      ...request,
      userText,
      imageSettings: { imageCount: 3, aspectRatio: "1:1" }
    };
    const currentContext = {
      ...context,
      currentTurn: {
        ...context.currentTurn,
        text: userText,
        imageSettings: currentRequest.imageSettings
      }
    };

    const response = await service.resolveConversationOutput(currentRequest, currentContext, []);

    expect(repairConversation).toHaveBeenCalledOnce();
    expect(response.output.result).toMatchObject({
      status: "ready",
      finalRequirement: { imageCount: 4 }
    });
  });

  it("stops after one repair when AI still contradicts explicit text quantity", async () => {
    const userText = "生成的商品主图是4张完整且独立的";
    const wrongOutput = {
      contractVersion: "4.0",
      action: "generate",
      assistantReply: "开始生成三张",
      requirements: { imageCount: 3, intent: userText },
      quantityDecision: { source: "ui_control", value: 3, rule: "采用页面控件" },
      generationPlan: {
        schemaVersion: "2.0",
        summary: "错误的三张计划",
        groups: [
          { sourceImages: [], outputCount: 3, outputLayout: "separate_image", instruction: null }
        ]
      }
    };
    const { service, repairConversation } = createService({
      conversationOutput: wrongOutput,
      repairedConversationOutput: wrongOutput
    });
    const currentRequest = {
      ...request,
      userText,
      imageSettings: { imageCount: 3, aspectRatio: "1:1" }
    };
    const currentContext = {
      ...context,
      currentTurn: {
        ...context.currentTurn,
        text: userText,
        imageSettings: currentRequest.imageSettings
      }
    };

    await expect(
      service.resolveConversationOutput(currentRequest, currentContext, [])
    ).rejects.toMatchObject({
      response: { code: "INVALID_CONVERSATION_REQUIREMENT_AI_OUTPUT" }
    });
    expect(repairConversation).toHaveBeenCalledOnce();
  });

  it("returns normal chat without creating a requirement result", async () => {
    const { service } = createService({
      conversationOutput: {
        contractVersion: "3.0",
        action: "respond_only",
        responseType: "normal",
        assistantReply: "你好，我可以帮你生成或修改商品图。"
      }
    });

    const response = await service.resolveConversationOutput(request, context, []);

    expect(response.output).toMatchObject({
      action: "respond_only",
      responseType: "normal",
      targetImageKey: null,
      result: null
    });
  });

  it("keeps unsupported capability as a normal assistant response", async () => {
    const { service } = createService({
      conversationOutput: {
        contractVersion: "3.0",
        action: "respond_only",
        responseType: "unsupported_capability",
        assistantReply: "普通模式暂不支持图片反推提示词。"
      }
    });

    const response = await service.resolveConversationOutput(request, context, []);
    expect(response.output.responseType).toBe("unsupported_capability");
  });

  it("accepts a generated-result image key as the edit target", async () => {
    const { service, repairConversation } = createService({
      conversationOutput: {
        contractVersion: "3.0",
        action: "generate",
        assistantReply: "我会修改上一张结果。",
        targetImageKey: "image_1",
        quantityDecision: { source: "ui_control", value: 1, rule: "采用页面数量控件" },
        requirements: { intent: "把背景换成花园", background: "户外花园" },
        generationPlan: {
          schemaVersion: "2.0",
          summary: "修改上一张结果",
          groups: [
            {
              sourceImages: [{ imageKey: "image_1", usage: "edit_target" }],
              outputCount: 1,
              outputLayout: "separate_image",
              instruction: "只更换背景"
            }
          ]
        }
      }
    });
    const response = await service.resolveConversationOutput(request, context, [
      {
        key: "image_1",
        role: "generated_result",
        relation: "上一轮生成结果",
        mimeType: "image/png",
        content: Buffer.from("image"),
        productEntities: []
      }
    ]);

    expect(response.output.targetImageKey).toBe("image_1");
    expect(response.output.action).toBe("generate");
    expect(repairConversation).not.toHaveBeenCalled();
  });

  it("repairs an unknown target image key once", async () => {
    const { service, repairConversation } = createService({
      conversationOutput: {
        contractVersion: "3.0",
        action: "generate",
        assistantReply: "开始修改。",
        targetImageKey: "invented_image",
        requirements: {}
      },
      repairedConversationOutput: {
        contractVersion: "3.0",
        action: "ask_user",
        assistantReply: "你想修改哪一张结果？",
        questions: ["你想修改哪一张结果？"]
      }
    });

    const response = await service.resolveConversationOutput(request, context, []);

    expect(repairConversation).toHaveBeenCalledOnce();
    expect(response.output.action).toBe("ask_user");
  });
});
