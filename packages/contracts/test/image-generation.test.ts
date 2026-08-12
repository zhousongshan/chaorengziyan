import { describe, expect, it } from "vitest";

import {
  imageGenerationOutputSchema,
  regenerateImageGenerationOutputRequestSchema
} from "../src/image-generation.js";

describe("image generation contracts", () => {
  it("requires the clicked deliverable asset for output regeneration", () => {
    expect(
      regenerateImageGenerationOutputRequestSchema.parse({
        idempotencyKey: "00000000-0000-4000-8000-000000000101",
        sourceAssetId: "00000000-0000-4000-8000-000000000102"
      })
    ).toEqual({
      idempotencyKey: "00000000-0000-4000-8000-000000000101",
      sourceAssetId: "00000000-0000-4000-8000-000000000102"
    });
  });

  it("rejects a regeneration request without a source asset", () => {
    expect(
      regenerateImageGenerationOutputRequestSchema.safeParse({
        idempotencyKey: "00000000-0000-4000-8000-000000000101"
      }).success
    ).toBe(false);
  });

  it("rejects unknown regeneration request fields", () => {
    expect(
      regenerateImageGenerationOutputRequestSchema.safeParse({
        idempotencyKey: "00000000-0000-4000-8000-000000000101",
        sourceAssetId: "00000000-0000-4000-8000-000000000102",
        outputCount: 2
      }).success
    ).toBe(false);
  });

  it("preserves group and variant positions in generation outputs", () => {
    expect(
      imageGenerationOutputSchema.parse({
        unitId: "00000000-0000-4000-8000-000000000103",
        position: 3,
        groupPosition: 1,
        variantPosition: 2,
        generationStatus: "queued",
        attemptCount: 0,
        stageStartedAt: "2026-08-11T00:00:00.000Z",
        completedAt: null,
        subjectConsistencyRequired: false,
        subjectConsistencyStatus: null,
        subjectConsistencyPhase: null,
        generatedAsset: null,
        deliverableAsset: null,
        error: null
      })
    ).toMatchObject({ position: 3, groupPosition: 1, variantPosition: 2 });
  });
});
