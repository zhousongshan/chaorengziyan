import { describe, expect, it } from "vitest";

import {
  emptyConversationState,
  type ConversationRequirementAiOutput,
  type ConversationState,
  type CreateConversationMessageRequest,
  type FinalRequirement
} from "@chaoren/contracts";

import { ConversationStateReducer } from "../src/conversations/conversation-state.reducer.js";

const messageId = "00000000-0000-4000-8000-000000000001";
const idempotencyKey = "00000000-0000-4000-8000-000000000002";

const requirement: FinalRequirement = {
  imageCount: 1,
  aspectRatio: "1:1",
  intent: "生成商品主图",
  scene: "桌面",
  background: "白色",
  composition: "居中",
  lighting: "柔光",
  style: "真实摄影",
  mustKeep: ["商品主体颜色不变"],
  mustAvoid: [],
  subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
};

function request(text: string): CreateConversationMessageRequest {
  return {
    expectedVersion: 1,
    idempotencyKey,
    modelId: "gpt-image-2",
    text,
    imageSettings: {},
    attachments: []
  };
}

function readyOutput(
  changedFields: ConversationRequirementAiOutput["changedFields"],
  finalRequirement: FinalRequirement
): ConversationRequirementAiOutput {
  return {
    action: "update_requirement",
    responseType: "normal",
    assistantReply: "已更新",
    targetImageKey: null,
    changedFields,
    result: {
      schemaVersion: "1.0",
      status: "ready",
      finalRequirement,
      conflictDecisions: []
    }
  };
}

describe("ConversationStateReducer", () => {
  it("keeps all four ordered product images as the current product fact set", () => {
    const currentRequest = request("这四张是同一商品的不同角度");
    currentRequest.attachments = [1, 2, 3, 4].map((index) => ({
      assetId: `00000000-0000-4000-8000-00000000001${index}`,
      role: "product_source" as const,
      relation: `商品图 ${index}`
    }));

    const reduced = new ConversationStateReducer().reduce({
      previous: emptyConversationState,
      request: currentRequest,
      output: readyOutput([], requirement),
      messageId,
      turnNumber: 1
    });

    expect(reduced.state.activeProductAssetIds).toEqual(
      currentRequest.attachments.map((attachment) => attachment.assetId)
    );
  });

  it("clears the persisted product image when the user explicitly removes it", () => {
    const previous: ConversationState = {
      ...emptyConversationState,
      activeProductAssetIds: ["00000000-0000-4000-8000-000000000010"],
      currentRequirement: requirement
    };
    const currentRequest = request("不使用商品图，直接生成创意画面");
    currentRequest.clearProductImage = true;

    const reduced = new ConversationStateReducer().reduce({
      previous,
      request: currentRequest,
      output: readyOutput([], requirement),
      messageId,
      turnNumber: 2
    });

    expect(reduced.state.activeProductAssetIds).toEqual([]);
  });

  it("only applies fields explicitly changed in the current turn", () => {
    const previous: ConversationState = {
      ...emptyConversationState,
      currentRequirement: requirement
    };
    const candidate: FinalRequirement = {
      ...requirement,
      background: "蓝色渐变",
      style: "错误地变化的风格",
      subjectPolicy: {
        defaultAction: "preserve",
        allowedChanges: [{ feature: "color", instruction: "改成红色" }]
      }
    };

    const reduced = new ConversationStateReducer().reduce({
      previous,
      request: request("只把背景换成蓝色渐变"),
      output: readyOutput(["background"], candidate),
      messageId,
      turnNumber: 2
    });

    expect(reduced.state.currentRequirement?.background).toBe("蓝色渐变");
    expect(reduced.state.currentRequirement?.style).toBe("真实摄影");
    expect(reduced.state.currentRequirement?.subjectPolicy.allowedChanges).toEqual([]);
    expect(reduced.state.fieldSources.background).toEqual({ messageId, turnNumber: 2 });
  });

  it("keeps the previous effective requirement while clarification is pending", () => {
    const previous: ConversationState = {
      ...emptyConversationState,
      currentRequirement: requirement
    };
    const output: ConversationRequirementAiOutput = {
      action: "ask_user",
      responseType: "normal",
      assistantReply: "请说明是哪一张图",
      targetImageKey: null,
      changedFields: [],
      result: {
        schemaVersion: "1.0",
        status: "needs_clarification",
        questions: ["你指的是哪一张生成图？"],
        conflictDecisions: []
      }
    };

    const reduced = new ConversationStateReducer().reduce({
      previous,
      request: request("用那张继续"),
      output,
      messageId,
      turnNumber: 2
    });

    expect(reduced.state.currentRequirement).toEqual(requirement);
    expect(reduced.state.unresolvedQuestions).toEqual(["你指的是哪一张生成图？"]);
  });

  it("does not carry an edit target into a later turn unless it is selected again", () => {
    const previous: ConversationState = {
      ...emptyConversationState,
      editBaseAssetId: "00000000-0000-4000-8000-000000000099",
      currentRequirement: requirement
    };
    const reduced = new ConversationStateReducer().reduce({
      previous,
      request: request("生成一个新的商品方案"),
      output: readyOutput([], requirement),
      messageId,
      turnNumber: 3
    });

    expect(reduced.state.editBaseAssetId).toBeNull();
  });
});
