import { describe, expect, it } from "vitest";

import { emptyConversationState } from "@chaoren/contracts";

import { parsePersistedConversationState } from "../src/conversations/persisted-conversation-state.js";
import {
  parseExecutableGenerationPlan,
  parsePersistedGenerationPlan
} from "../src/persistence/persisted-generation-plan.js";

const productAssetId = "00000000-0000-4000-8000-000000000001";

const commonGroup = {
  sourceImages: [
    {
      assetId: productAssetId,
      sourceRole: "product_source",
      usage: "subject_fact",
      position: 0
    }
  ],
  subjectEntities: [],
  subjectPolicy: { defaultAction: "preserve", allowedChanges: [] },
  referenceAnalyses: [],
  outputCount: 1,
  outputLayout: "separate_image",
  instruction: "保持当前商品事实并生成一张图片"
};

describe("parsePersistedConversationState", () => {
  it("loads an early v3 snapshot as non-executable legacy context", () => {
    const parsed = parsePersistedConversationState({
      ...emptyConversationState,
      currentGenerationPlan: {
        schemaVersion: "3.0",
        summary: "早期 v3 计划",
        groups: [commonGroup]
      }
    });

    expect(parsed.currentGenerationPlan).toMatchObject({
      schemaVersion: "2.0",
      summary: "早期 v3 计划",
      groups: [
        {
          sourceImages: commonGroup.sourceImages,
          subjectEntities: [],
          outputCount: 1,
          outputLayout: "separate_image",
          instruction: commonGroup.instruction
        }
      ]
    });
  });

  it("preserves a complete current v3 plan", () => {
    const currentPlan = {
      schemaVersion: "3.0",
      summary: "当前 v3 计划",
      groups: [
        {
          ...commonGroup,
          referenceDesignPlan: null,
          copyPlan: { blocks: [], forbiddenFacts: [] }
        }
      ]
    };

    const parsed = parsePersistedConversationState({
      ...emptyConversationState,
      currentGenerationPlan: currentPlan
    });

    expect(parsed.currentGenerationPlan).toEqual(currentPlan);
  });

  it("does not downgrade a malformed current v3 plan", () => {
    expect(() =>
      parsePersistedConversationState({
        ...emptyConversationState,
        currentGenerationPlan: {
          schemaVersion: "3.0",
          summary: "损坏的当前计划",
          groups: [
            {
              ...commonGroup,
              instruction: "",
              referenceDesignPlan: null,
              copyPlan: { blocks: [], forbiddenFacts: [] }
            }
          ]
        }
      })
    ).toThrow();
  });
});

describe("persisted generation plan boundaries", () => {
  it("allows early v3 only through the persisted read boundary", () => {
    const earlyV3 = {
      schemaVersion: "3.0",
      summary: "早期 v3 计划",
      groups: [commonGroup]
    };

    expect(parsePersistedGenerationPlan(earlyV3)).toMatchObject({ schemaVersion: "2.0" });
    expect(() => parseExecutableGenerationPlan(earlyV3)).toThrow();
  });
});
