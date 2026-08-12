import { describe, expect, it } from "vitest";

import type { ImageGenerationTask } from "@chaoren/contracts";

import { indexHistoricalGenerationResults } from "./historical-generation-results";

const assetId = "00000000-0000-4000-8000-000000000001";

function output(
  unitId: string,
  deliverableAssetId: string | null
): NonNullable<ImageGenerationTask["outputs"]>[number] {
  return {
    unitId,
    position: 0,
    groupPosition: 0,
    variantPosition: 0,
    generationStatus: "succeeded",
    attemptCount: 1,
    stageStartedAt: "2026-08-11T00:00:00.000Z",
    completedAt: "2026-08-11T00:00:01.000Z",
    subjectConsistencyRequired: false,
    subjectConsistencyStatus: null,
    subjectConsistencyPhase: null,
    generatedAsset: null,
    deliverableAsset: deliverableAssetId
      ? {
          id: deliverableAssetId,
          projectId: "00000000-0000-4000-8000-000000000010",
          kind: "image",
          mimeType: "image/png",
          byteSize: 1,
          createdAt: "2026-08-11T00:00:01.000Z"
        }
      : null,
    error: null
  };
}

function task(
  taskId: string,
  outputs: NonNullable<ImageGenerationTask["outputs"]>
): Pick<ImageGenerationTask, "taskId" | "modelId" | "outputs" | "regeneratedFrom"> {
  return { taskId, modelId: "test-model", outputs, regeneratedFrom: null };
}

describe("indexHistoricalGenerationResults", () => {
  it("indexes a deliverable by its exact task and unit", () => {
    const taskId = "00000000-0000-4000-8000-000000000020";
    const unitId = "00000000-0000-4000-8000-000000000021";

    const indexed = indexHistoricalGenerationResults([task(taskId, [output(unitId, assetId)])]);

    expect(indexed.get(assetId)).toMatchObject({
      taskId,
      modelId: "test-model",
      regenerated: false,
      output: { unitId, deliverableAsset: { id: assetId } }
    });
  });

  it("does not index legacy outputs without a deliverable asset", () => {
    const indexed = indexHistoricalGenerationResults([
      task("00000000-0000-4000-8000-000000000030", [
        output("00000000-0000-4000-8000-000000000031", null)
      ])
    ]);

    expect(indexed).toHaveLength(0);
  });

  it("keeps an asset read-only when more than one task-unit pair claims it", () => {
    const indexed = indexHistoricalGenerationResults([
      task("00000000-0000-4000-8000-000000000040", [
        output("00000000-0000-4000-8000-000000000041", assetId)
      ]),
      task("00000000-0000-4000-8000-000000000050", [
        output("00000000-0000-4000-8000-000000000051", assetId)
      ])
    ]);

    expect(indexed.has(assetId)).toBe(false);
  });
});
