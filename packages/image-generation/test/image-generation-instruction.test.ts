import { describe, expect, it } from "vitest";

import type { FinalRequirement } from "@chaoren/contracts";

import { buildImageGenerationInstruction } from "../src/image-generation-instruction.js";

const requirement: FinalRequirement = {
  imageCount: 1,
  aspectRatio: "1:1",
  intent: "只更换商品背景",
  scene: null,
  background: "夏日海边",
  composition: null,
  lighting: null,
  style: null,
  mustKeep: [],
  mustAvoid: [],
  subjectPolicy: { defaultAction: "preserve", allowedChanges: [] }
};

describe("buildImageGenerationInstruction", () => {
  it("preserves every unmentioned subject feature by default", () => {
    const instruction = buildImageGenerationInstruction(requirement, {
      product: 1,
      reference: 0
    });

    expect(instruction).toContain("以输入商品图作为唯一商品事实来源");
    expect(instruction).toContain("不得为了强化场景语义");
    expect(instruction).toContain("用户没有授权修改任何商品主体特征");
  });

  it("treats all product views as one ordered fact source set", () => {
    const instruction = buildImageGenerationInstruction(requirement, {
      product: 4,
      reference: 1
    });

    expect(instruction).toContain("输入图片1-4为同一商品的多角度或细节图");
    expect(instruction).toContain("输入图片5-5为参考图");
  });

  it("only permits explicitly authorized subject changes", () => {
    const instruction = buildImageGenerationInstruction(
      {
        ...requirement,
        subjectPolicy: {
          defaultAction: "preserve",
          allowedChanges: [{ feature: "color", instruction: "把瓶盖改成蓝色" }]
        }
      },
      { product: 1, reference: 0 }
    );

    expect(instruction).toContain("仅允许以下用户明确授权的商品主体变化");
    expect(instruction).toContain("颜色：把瓶盖改成蓝色");
    expect(instruction).toContain("未列出的主体特征仍必须保持不变");
  });

  it("passes open creative requirements without granting subject changes", () => {
    const instruction = buildImageGenerationInstruction(
      {
        ...requirement,
        additionalRequirements: [
          { key: "petal_motion", label: "花瓣轨迹", instruction: "花瓣围绕商品形成环形轨迹" }
        ]
      },
      { product: 1, reference: 0 }
    );

    expect(instruction).toContain("补充创作要求");
    expect(instruction).toContain("花瓣轨迹：花瓣围绕商品形成环形轨迹");
    expect(instruction).toContain("不得借此扩大商品主体修改权限");
  });

  it("uses the program-controlled generation goal in the executable instruction", () => {
    const instruction = buildImageGenerationInstruction(
      requirement,
      { product: 1, reference: 0 },
      { generationGoal: "商品主图" }
    );

    expect(instruction).toContain("生成目标：商品主图");
  });

  it("describes only the images actually present in one output unit", () => {
    const instruction = buildImageGenerationInstruction(
      requirement,
      { editBase: 1, product: 0, reference: 0 },
      { orderedSourceRoles: ["edit_base"] }
    );

    expect(instruction).toContain("输入图片1为本执行单元的编辑目标");
    expect(instruction).not.toContain("输入图片1-4为同一商品");
  });
});
