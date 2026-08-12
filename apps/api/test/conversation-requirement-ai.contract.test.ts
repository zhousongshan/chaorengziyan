import { describe, expect, it } from "vitest";

import type { FinalRequirement } from "@chaoren/contracts";

import { normalizeConversationRequirementAiOutput } from "../src/requirements/conversation-requirement-ai.contract.js";

const defaults = {
  userText: "只换背景，商品主体保持不变",
  imageCount: 1,
  aspectRatio: "1:1"
};

const currentRequirement: FinalRequirement = {
  imageCount: 1,
  aspectRatio: "1:1",
  intent: "只更换商品背景",
  scene: null,
  background: "纯白背景",
  composition: null,
  lighting: null,
  style: null,
  mustKeep: [],
  mustAvoid: [],
  additionalRequirements: [
    { key: "atmosphere", instruction: "清爽明亮", value: "清爽明亮" },
    { key: "props", instruction: "白色花瓶", value: ["白色花瓶"] }
  ],
  subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
};

describe("conversation requirement AI contract", () => {
  it("preserves separate quality lineage for multiple product entities", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults,
      availableImageKeys: ["cauliflower_front", "drumstick_front"],
      availableProductSourceImageKeys: ["cauliflower_front", "drumstick_front"],
      availableTargetImageKeys: [],
      maxOutputCount: 4,
      rawOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "开始生成",
        requirements: {},
        quantityDecision: {
          source: "previous_requirement",
          value: 1,
          rule: "文字和页面均无新数量，沿用当前需求"
        },
        generationPlan: {
          schemaVersion: "2.0",
          summary: "两个商品共同生成一张主图",
          groups: [
            {
              sourceImages: [
                { imageKey: "cauliflower_front", usage: "subject_fact" },
                { imageKey: "drumstick_front", usage: "subject_fact" }
              ],
              subjectEntities: [
                {
                  entityKey: "cauliflower_chicken",
                  label: "菜花鸡",
                  lineageKind: "new_product_source",
                  sourceImageKeys: ["cauliflower_front"]
                },
                {
                  entityKey: "drumstick_chicken",
                  label: "鸡腿鸡",
                  lineageKind: "new_product_source",
                  sourceImageKeys: ["drumstick_front"]
                }
              ],
              outputCount: 1,
              outputLayout: "separate_image",
              instruction: "鸡腿鸡应更高更大"
            }
          ]
        }
      }
    });

    expect(normalized.success).toBe(true);
    if (!normalized.success) return;
    expect(normalized.data.generationPlan?.groups[0]?.subjectEntities).toEqual([
      {
        entityKey: "cauliflower_chicken",
        label: "菜花鸡",
        lineageKind: "new_product_source",
        sourceImageKeys: ["cauliflower_front"]
      },
      {
        entityKey: "drumstick_chicken",
        label: "鸡腿鸡",
        lineageKind: "new_product_source",
        sourceImageKeys: ["drumstick_front"]
      }
    ]);
  });

  it("接受AI按图片分组的四张独立输出计划", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults: { ...defaults, userText: "生成4张完整且独立的商品图" },
      availableImageKeys: ["image_1", "image_2", "image_3", "image_4"],
      availableProductSourceImageKeys: ["image_1", "image_2", "image_3", "image_4"],
      availableTargetImageKeys: [],
      maxOutputCount: 4,
      rawOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "开始分别优化四张商品图。",
        quantityDecision: {
          source: "explicit_user_text",
          value: 4,
          evidenceQuote: "生成4张",
          evidenceStart: 0,
          evidenceEnd: 4
        },
        requirements: {},
        generationPlan: {
          schemaVersion: "2.0",
          summary: "四张原图各自生成一张独立结果",
          groups: ["image_1", "image_2", "image_3", "image_4"].map((imageKey) => ({
            sourceImages: [{ imageKey, usage: "edit_target" }],
            subjectEntities: [
              {
                entityKey: `product_${imageKey}`,
                label: "商品",
                lineageKind: "new_product_source",
                sourceImageKeys: [imageKey]
              }
            ],
            outputCount: 1,
            outputLayout: "separate_image",
            instruction: "只处理对应原图"
          }))
        }
      }
    });

    expect(normalized.success).toBe(true);
    if (!normalized.success || normalized.data.result?.status !== "ready") return;
    expect(normalized.data.generationPlan?.groups).toHaveLength(4);
    expect(normalized.data.result.finalRequirement.imageCount).toBe(4);
    expect(normalized.data.changedFields).toContain("imageCount");
  });

  it("asks the user to adjust when itemized deliverables exceed the output limit", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults: { ...defaults, userText: "输出2张主图、2张详情图、1张卖点图" },
      availableImageKeys: [],
      availableTargetImageKeys: [],
      maxOutputCount: 4,
      rawOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "开始生成"
      }
    });

    expect(normalized).toMatchObject({
      success: true,
      data: {
        action: "ask_user",
        result: {
          status: "needs_clarification",
          questions: [expect.stringContaining("你要求生成 5 张")]
        }
      }
    });
  });

  it("uses the corrected quantity instead of an obsolete over-limit quantity", () => {
    const userText = "不要5张了，改成2张";
    const evidenceQuote = "改成2张";
    const evidenceStart = userText.indexOf(evidenceQuote);
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults: { ...defaults, userText },
      availableImageKeys: [],
      availableTargetImageKeys: [],
      maxOutputCount: 4,
      rawOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "按修改后的数量生成两张",
        requirements: { imageCount: 2 },
        quantityDecision: {
          source: "explicit_user_text",
          value: 2,
          evidenceQuote,
          evidenceStart,
          evidenceEnd: evidenceStart + evidenceQuote.length
        },
        generationPlan: {
          schemaVersion: "2.0",
          summary: "生成两张独立结果",
          groups: [
            {
              sourceImages: [],
              outputCount: 2,
              outputLayout: "separate_image"
            }
          ]
        }
      }
    });

    expect(normalized).toMatchObject({
      success: true,
      data: {
        action: "generate",
        quantityDecision: { source: "explicit_user_text", value: 2 },
        result: { status: "ready", finalRequirement: { imageCount: 2 } }
      }
    });
  });

  it("accepts a minimal quantity quote when it overlaps the program-validated command", () => {
    const userText = "请基于原图生成明确的2张完整且独立的1:1白底商品主图";
    const evidenceQuote = "2张";
    const evidenceStart = userText.indexOf(evidenceQuote);
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults: { ...defaults, userText },
      availableImageKeys: [],
      availableTargetImageKeys: [],
      maxOutputCount: 4,
      rawOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "开始生成两张",
        requirements: { imageCount: 2 },
        quantityDecision: {
          source: "explicit_user_text",
          value: 2,
          evidenceQuote,
          evidenceStart,
          evidenceEnd: evidenceStart + evidenceQuote.length
        },
        generationPlan: {
          schemaVersion: "2.0",
          summary: "生成两张独立结果",
          groups: [
            {
              sourceImages: [],
              outputCount: 2,
              outputLayout: "separate_image"
            }
          ]
        }
      }
    });

    expect(normalized).toMatchObject({
      success: true,
      data: { quantityDecision: { source: "explicit_user_text", value: 2 } }
    });
  });

  it("rejects an exact quote that does not overlap the validated output quantity", () => {
    const userText = "商品型号是2X，生成4张商品图";
    const evidenceQuote = "2";
    const evidenceStart = userText.indexOf(evidenceQuote);
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults: { ...defaults, userText },
      availableImageKeys: [],
      availableTargetImageKeys: [],
      maxOutputCount: 4,
      rawOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "开始生成四张",
        requirements: { imageCount: 4 },
        quantityDecision: {
          source: "explicit_user_text",
          value: 4,
          evidenceQuote,
          evidenceStart,
          evidenceEnd: evidenceStart + evidenceQuote.length
        },
        generationPlan: {
          schemaVersion: "2.0",
          summary: "生成四张独立结果",
          groups: [
            {
              sourceImages: [],
              outputCount: 4,
              outputLayout: "separate_image"
            }
          ]
        }
      }
    });

    expect(normalized).toMatchObject({
      success: false,
      issues: [{ field: "quantityDecision.evidenceQuote" }]
    });
  });

  it("rejects a plan whose output total disagrees with the AI-decided quantity", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults: { ...defaults, imageCount: 3 },
      availableImageKeys: ["image_1"],
      availableTargetImageKeys: [],
      maxOutputCount: 4,
      rawOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "按文字要求生成四张",
        requirements: { imageCount: 4 },
        generationPlan: {
          schemaVersion: "2.0",
          summary: "错误地只规划三张",
          groups: [
            {
              sourceImages: [{ imageKey: "image_1", usage: "edit_target" }],
              outputCount: 3,
              outputLayout: "separate_image"
            }
          ]
        }
      }
    });

    expect(normalized).toMatchObject({ success: false });
  });

  it("拒绝生图计划引用AI虚构的图片句柄", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults,
      availableImageKeys: ["image_1"],
      availableTargetImageKeys: [],
      maxOutputCount: 4,
      rawOutput: {
        contractVersion: "4.0",
        action: "generate",
        assistantReply: "开始生成",
        requirements: {},
        generationPlan: {
          schemaVersion: "2.0",
          summary: "处理一张图",
          groups: [
            {
              sourceImages: [{ imageKey: "image_99", usage: "edit_target" }],
              outputCount: 1,
              outputLayout: "separate_image"
            }
          ]
        }
      }
    });

    expect(normalized).toMatchObject({ success: false });
  });

  it("supplies a safe program reply when the model omits the nonessential assistant reply", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults,
      availableTargetImageKeys: [],
      rawOutput: {
        contractVersion: "3.0",
        action: "update_requirement",
        requirements: { background: "户外花园" }
      }
    });

    expect(normalized).toMatchObject({
      success: true,
      data: { assistantReply: "已收到，需求已更新。" }
    });
  });

  it("normalizes provider-shaped open fields without rejecting new creative dimensions", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement: null,
      defaults,
      availableTargetImageKeys: [],
      rawOutput: {
        contractVersion: "3.0",
        action: "update_requirement",
        assistantReply: "需求已整理",
        requirements: {
          imageCount: "1",
          aspectRatio: "1:1",
          intent: "只换成户外花园背景",
          visualStyle: "真实摄影",
          atmosphere: "甜美柔和",
          props: ["小型绿植", "几何陈列块"],
          camera: { lens: "50mm", angle: "平视" },
          requirements: ["主体保持不变"],
          avoid: "不要添加文字或水印",
          allowedChanges: ["posture"],
          generationGoal: "营销海报"
        },
        conflictDecisions: ["以用户本轮的背景要求为准"]
      }
    });

    expect(normalized.success).toBe(true);
    if (!normalized.success) return;
    expect(normalized.data.result).toMatchObject({
      status: "ready",
      finalRequirement: {
        imageCount: 1,
        aspectRatio: "1:1",
        style: "真实摄影",
        mustAvoid: ["不要添加文字或水印"],
        subjectPolicy: {
          defaultAction: "preserve",
          allowedChanges: [{ feature: "posture", instruction: "仅允许修改 posture" }]
        }
      }
    });
    if (normalized.data.result.status !== "ready") return;
    expect(normalized.data.result.finalRequirement).not.toHaveProperty("generationGoal");
    expect(normalized.data.result.finalRequirement.additionalRequirements).toEqual([
      {
        key: "atmosphere",
        label: "atmosphere",
        instruction: "甜美柔和",
        value: "甜美柔和"
      },
      {
        key: "props",
        label: "props",
        instruction: '["小型绿植","几何陈列块"]',
        value: ["小型绿植", "几何陈列块"]
      },
      {
        key: "camera",
        label: "camera",
        instruction: '{"lens":"50mm","angle":"平视"}',
        value: { lens: "50mm", angle: "平视" }
      },
      {
        key: "requirements",
        label: "requirements",
        instruction: '["主体保持不变"]',
        value: ["主体保持不变"]
      }
    ]);
  });

  it("replaces a previous extension by key and removes an explicitly cleared extension", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults,
      availableTargetImageKeys: [],
      rawOutput: {
        contractVersion: "3.0",
        action: "update_requirement",
        assistantReply: "氛围已更新",
        requirements: {
          atmosphere: "温暖黄昏",
          props: null
        }
      }
    });

    expect(normalized.success).toBe(true);
    if (!normalized.success || normalized.data.result.status !== "ready") return;
    expect(normalized.data.result.finalRequirement.additionalRequirements).toEqual([
      {
        key: "atmosphere",
        label: "atmosphere",
        instruction: "温暖黄昏",
        value: "温暖黄昏"
      }
    ]);
  });

  it("rejects AI attempts to write program-controlled identity and asset fields", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults,
      availableTargetImageKeys: [],
      rawOutput: {
        contractVersion: "3.0",
        action: "update_requirement",
        assistantReply: "需求已更新",
        requirements: {
          background: "户外花园",
          productImageIds: ["00000000-0000-4000-8000-000000000099"]
        }
      }
    });

    expect(normalized).toEqual({
      success: false,
      issues: [
        {
          field: "requirements.productImageIds",
          message: "AI不得输出程序控制字段"
        }
      ]
    });
  });

  it("keeps malformed optional image observations from blocking an ask-user command", () => {
    const normalized = normalizeConversationRequirementAiOutput({
      currentRequirement,
      defaults,
      availableTargetImageKeys: [],
      rawOutput: {
        contractVersion: "3.0",
        action: "ask_user",
        assistantReply: "需要确认指代的图片",
        questions: [{ text: "你说的‘上一张’是哪张图？" }],
        imageObservations: [{ key: "image_1" }, "invalid"]
      }
    });

    expect(normalized).toMatchObject({
      success: true,
      data: {
        assetMemories: [],
        result: {
          status: "needs_clarification",
          questions: ["你说的‘上一张’是哪张图？"]
        }
      }
    });
  });
});
