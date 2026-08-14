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
    expect(instruction).toContain("输入图片5-5为设计语言参考图，不作为商品事实");
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

  it("compiles the complete reference analysis into the provider instruction", () => {
    const instruction = buildImageGenerationInstruction(
      requirement,
      { product: 1, reference: 1 },
      {
        orderedSourceRoles: ["product", "reference"],
        referenceAnalyses: [
          {
            assetId: "00000000-0000-4000-8000-000000000012",
            sourceImageNumber: 2,
            observedDesign: {
              sellingPointPresentation: "左侧用标题和标签表达卖点",
              composition: "信息左置、商品右置",
              informationHierarchy: "品牌、主标题、辅助卖点分三级",
              typography: "粗体主标题搭配圆角标签",
              colorAndLighting: "绿色主色与柔和棚拍光",
              spacingAndRhythm: "左右分区并保留充足边距",
              propsAndScene: "桌面道具形成前后层次"
            },
            transferPlan: {
              adopt: ["采用左右分栏和三级信息层级"],
              adapt: ["将参考商品替换为当前商品"],
              avoid: ["不复制参考品牌和原文案"],
              userPriority: ["优先参考版式"]
            }
          }
        ]
      }
    );

    expect(instruction).toContain("输入图片2的结构化参考分析");
    expect(instruction).toContain("构图布局：信息左置、商品右置");
    expect(instruction).toContain("信息层级：品牌、主标题、辅助卖点分三级");
    expect(instruction).toContain("文字与字体：粗体主标题搭配圆角标签");
    expect(instruction).toContain("必须采用：采用左右分栏和三级信息层级");
    expect(instruction).toContain("用户指定的优先参考项：优先参考版式");
    expect(instruction).toContain("不得成为当前商品事实");
  });
});
