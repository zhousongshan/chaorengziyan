import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config } from "dotenv";
import { describe, expect, it } from "vitest";

import { emptyConversationState, environmentSchema } from "@chaoren/contracts";
import {
  buildImageGenerationInstruction,
  getEnabledImageModel,
  OpenAiImageAdapter
} from "@chaoren/image-generation";

import { normalizeConversationRequirementAiOutput } from "../src/requirements/conversation-requirement-ai.contract.js";
import { OpenAiCompatibleRequirementAiAdapter } from "../src/requirements/openai-compatible-requirement-ai.adapter.js";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const runRealTests = process.env.RUN_REQUIREMENT_AI_REAL_TESTS === "1";
const realDescribe = runRealTests ? describe : describe.skip;
const productAssetId = "14223723-7b6e-4441-8287-bd689ccf3631";
const referenceAssetId = "7b688414-ce58-4589-8de4-809c27a47efa";

realDescribe(
  "diagnostic real reference-image requirement AI (not formal workflow acceptance)",
  () => {
    it("extracts transferable design rules and compiles them into the provider instruction", async () => {
      const environment = environmentSchema.parse({ ...process.env, NODE_ENV: "test" });
      const adapter = new OpenAiCompatibleRequirementAiAdapter(environment);
      const productPath =
        process.env.REAL_REFERENCE_PRODUCT_IMAGE ??
        resolve(
          process.cwd(),
          "../../.local-data/media/generated/31b18f5d-a400-4f44-89e8-20d2693fcfb8/640af2fd-6c82-4765-8e80-9ccf508a27aa/14223723-7b6e-4441-8287-bd689ccf3631.png"
        );
      const referencePath =
        process.env.REAL_REFERENCE_DESIGN_IMAGE ??
        resolve(
          process.cwd(),
          "../../.local-data/media/source/31b18f5d-a400-4f44-89e8-20d2693fcfb8/7b688414-ce58-4589-8de4-809c27a47efa.png"
        );
      const currentTurnText =
        "使用当前商品图生成1张1:1电商营销图。参考图只迁移卖点表达、左右版式、信息层级、字体层级、留白节奏和道具层次，不要复制参考商品、品牌和原文案。";
      const context = {
        sessionState: emptyConversationState,
        recentTurns: [],
        retrievedLongTermMemory: [],
        olderMemoryIndex: [],
        assetMemories: [],
        currentTurn: {
          text: currentTurnText,
          imageSettings: { imageCount: 1, aspectRatio: "1:1" },
          agentInstruction: "",
          attachments: [
            { assetId: productAssetId, role: "product_source" as const, relation: null },
            {
              assetId: referenceAssetId,
              role: "user_reference" as const,
              relation: "优先参考卖点表达、左右版式、信息层级、字体和留白"
            }
          ]
        }
      };
      const images = [
        {
          key: "current_product",
          role: "product_source" as const,
          relation: "本轮当前商品事实图",
          productEntities: [],
          mimeType: "image/png",
          content: await readFile(productPath)
        },
        {
          key: "design_reference",
          role: "user_reference" as const,
          relation: "优先参考卖点表达、左右版式、信息层级、字体和留白",
          productEntities: [],
          mimeType: "image/png",
          content: await readFile(referencePath)
        }
      ];
      const constraints = { maxImageCount: 4, allowedAspectRatios: ["1:1", "3:4", "9:16"] };
      let rawOutput = await adapter.resolveConversation(context, constraints, images);
      let normalized = normalizeConversationRequirementAiOutput({
        rawOutput,
        currentRequirement: null,
        defaults: {
          userText: currentTurnText,
          imageCount: 1,
          uiImageCount: 1,
          aspectRatio: "1:1",
          sourceImageCount: 1
        },
        availableImageKeys: images.map((image) => image.key),
        availableTargetImageKeys: [],
        availableProductSourceImageKeys: ["current_product"],
        availableReferenceImageKeys: ["design_reference"],
        availableProductEntityIdsByImageKey: {},
        hasCurrentProductAttachments: true,
        maxOutputCount: 4
      });
      if (!normalized.success) {
        rawOutput = await adapter.repairConversation({
          originalInput: context,
          previousOutput: rawOutput,
          validationIssues: normalized.issues,
          constraints,
          images
        });
        normalized = normalizeConversationRequirementAiOutput({
          rawOutput,
          currentRequirement: null,
          defaults: {
            userText: currentTurnText,
            imageCount: 1,
            uiImageCount: 1,
            aspectRatio: "1:1",
            sourceImageCount: 1
          },
          availableImageKeys: images.map((image) => image.key),
          availableTargetImageKeys: [],
          availableProductSourceImageKeys: ["current_product"],
          availableReferenceImageKeys: ["design_reference"],
          availableProductEntityIdsByImageKey: {},
          hasCurrentProductAttachments: true,
          maxOutputCount: 4
        });
      }

      expect(normalized.success).toBe(true);
      if (!normalized.success) return;
      expect(normalized.data.action).toBe("generate");
      expect(normalized.data.result?.status).toBe("ready");
      if (normalized.data.result?.status !== "ready") return;
      const group = normalized.data.generationPlan?.groups[0];
      const analysis = group?.referenceAnalyses[0];
      expect(group?.sourceImages).toEqual(
        expect.arrayContaining([
          { imageKey: "current_product", usage: expect.any(String) },
          {
            imageKey: "design_reference",
            usage: expect.stringMatching(/style_reference|layout_cell/)
          }
        ])
      );
      expect(analysis?.imageKey).toBe("design_reference");
      expect(Object.values(analysis?.observedDesign ?? {})).toHaveLength(7);
      expect(Object.values(analysis?.observedDesign ?? {}).every((value) => value.length > 0)).toBe(
        true
      );
      expect(analysis?.transferPlan.adopt.length).toBeGreaterThan(0);
      expect(analysis?.transferPlan.adapt.length).toBeGreaterThan(0);
      expect(analysis?.transferPlan.avoid.length).toBeGreaterThan(0);
      const designEvidence = JSON.stringify({
        instruction: group?.instruction,
        observedDesign: analysis?.observedDesign,
        transferPlan: analysis?.transferPlan
      });
      expect(designEvidence).toMatch(/左|右|分栏|分区/);
      expect(designEvidence).toMatch(/信息|标题|层级|卖点/);
      expect(designEvidence).toMatch(/字体|文字|字重|排版/);
      expect(designEvidence).not.toMatch(/小猪|草莓猪|马赛克/);

      if (!analysis) throw new Error("真实需求AI没有返回参考图分析");
      const providerInstruction = buildImageGenerationInstruction(
        normalized.data.result.finalRequirement,
        { product: 1, reference: 1 },
        {
          orderedSourceRoles: ["product", "reference"],
          referenceAnalyses: [
            {
              assetId: referenceAssetId,
              sourceImageNumber: 2,
              observedDesign: analysis.observedDesign,
              transferPlan: analysis.transferPlan
            }
          ],
          referenceDesignPlan: group?.referenceDesignPlan,
          copyPlan: group?.copyPlan
        }
      );
      expect(providerInstruction).toContain(analysis.observedDesign.informationHierarchy);
      expect(providerInstruction).toContain(analysis.observedDesign.typography);
      expect(providerInstruction).toContain(analysis.transferPlan.adopt[0]);
      expect(providerInstruction).not.toMatch(/小猪|草莓猪|马赛克/);

      if (process.env.RUN_REFERENCE_IMAGE_GENERATION_REAL_TESTS === "1") {
        const generated = await new OpenAiImageAdapter(environment).generate({
          requestId: "reference-image-product-rule-real-v1",
          model: getEnabledImageModel(environment, "openai-image"),
          requirement: normalized.data.result.finalRequirement,
          renderSettings: { resolutionPreset: "1k", providerQuality: "high" },
          instruction: providerInstruction,
          sources: [
            {
              assetId: productAssetId,
              role: "product",
              mimeType: "image/png",
              content: images[0]!.content
            },
            {
              assetId: referenceAssetId,
              role: "reference",
              mimeType: "image/png",
              content: images[1]!.content
            }
          ]
        });
        const artifactDirectory = resolve(process.cwd(), "../../.local-data/test-artifacts");
        const artifactPath = resolve(artifactDirectory, "reference-image-product-rule-real-v1.png");
        await mkdir(artifactDirectory, { recursive: true });
        await writeFile(artifactPath, generated[0]!.content);
        expect(generated).toHaveLength(1);
        expect(generated[0]?.mimeType).toMatch(/^image\//);
        console.info(`REAL_REFERENCE_IMAGE_ARTIFACT=${artifactPath}`);
      }
    }, 360_000);
  }
);
