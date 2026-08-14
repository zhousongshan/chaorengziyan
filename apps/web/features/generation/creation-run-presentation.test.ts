import { describe, expect, it } from "vitest";

import type { ImageGenerationTask, SubjectConsistencyCheck } from "@chaoren/contracts";

import {
  deriveGenerationStage,
  deriveWorkflowError,
  getDeliverableAssets
} from "./creation-run-presentation";

describe("creation run presentation", () => {
  it("turns internal quality repair into a user-safe optimization stage", () => {
    expect(
      deriveGenerationStage({
        resolving: false,
        creatingTask: false,
        task: task("succeeded"),
        checks: [check({ status: "running", phase: "repair_generation" })]
      })
    ).toBe("quality_reconciling");
  });

  it("only exposes images that passed the completed quality check", () => {
    const passed = check({ status: "completed", verdict: "passed" });
    const rejected = check({ status: "completed", verdict: "rejected", assetId: "asset-2" });
    expect(getDeliverableAssets(task("succeeded"), [passed, rejected])).toHaveLength(1);
  });

  it("delivers generation results directly when no product image requires subject checking", () => {
    const directTask = task("succeeded");
    directTask.subjectConsistencyRequired = false;
    directTask.resultAssets = [check({ status: "completed" }).generatedAsset];

    expect(
      deriveGenerationStage({
        resolving: false,
        creatingTask: false,
        task: directTask,
        checks: undefined
      })
    ).toBe("succeeded");
    expect(getDeliverableAssets(directTask, undefined)).toEqual(directTask.resultAssets);
  });

  it("maps insufficient source evidence to replacing the product image", () => {
    const input = check({ status: "source_unusable" });
    input.error = {
      code: "SOURCE_IMAGE_REPLACEMENT_REQUIRED",
      message: "商品事实原图无法提供可辨认的主体身份特征"
    };
    input.attempts = [
      {
        round: 1,
        createdAt: new Date().toISOString(),
        result: {
          schemaVersion: "2.0",
          verdict: "source_unusable",
          summary: "看不清商品主体",
          reason: "insufficient_source_evidence"
        }
      }
    ];
    expect(deriveWorkflowError(task("succeeded"), [input])?.action).toBe("replace_image");
  });

  it("keeps a successful output deliverable when another output failed", () => {
    const partial = task("succeeded");
    const asset = check({ status: "completed" }).generatedAsset;
    partial.workflowStatus = "partially_succeeded";
    partial.outputs = [
      {
        unitId: "00000000-0000-4000-8000-000000000201",
        position: 0,
        groupPosition: 0,
        variantPosition: 0,
        generationStatus: "succeeded",
        attemptCount: 1,
        stageStartedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:01:00.000Z",
        subjectConsistencyRequired: false,
        subjectConsistencyStatus: null,
        subjectConsistencyPhase: null,
        generatedAsset: asset,
        deliverableAsset: asset,
        error: null
      },
      {
        unitId: "00000000-0000-4000-8000-000000000202",
        position: 1,
        groupPosition: 1,
        variantPosition: 0,
        generationStatus: "failed",
        attemptCount: 2,
        stageStartedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:02:00.000Z",
        subjectConsistencyRequired: true,
        subjectConsistencyStatus: null,
        subjectConsistencyPhase: null,
        generatedAsset: null,
        deliverableAsset: null,
        error: { code: "IMAGE_PROVIDER_REQUEST_FAILED", message: "第二张生成失败" }
      }
    ];

    expect(getDeliverableAssets(partial, undefined)).toEqual([asset]);
    expect(
      deriveGenerationStage({ resolving: false, creatingTask: false, task: partial, checks: [] })
    ).toBe("succeeded");
    expect(deriveWorkflowError(partial, undefined)).toBeNull();
  });
});

function task(status: ImageGenerationTask["status"]): ImageGenerationTask {
  return {
    taskId: "00000000-0000-4000-8000-000000000101",
    requirementRunId: "00000000-0000-4000-8000-000000000102",
    projectId: "00000000-0000-4000-8000-000000000103",
    modelId: "image-model",
    executionConcurrency: 2,
    stageStartedAt: "2026-01-01T00:00:00.000Z",
    subjectConsistencyRequired: true,
    status,
    resultAssets: [],
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function check(
  input: Partial<SubjectConsistencyCheck> & {
    status: SubjectConsistencyCheck["status"];
    assetId?: string;
  }
): SubjectConsistencyCheck {
  const assetId = input.assetId ?? "00000000-0000-4000-8000-000000000104";
  const { assetId: ignoredAssetId, status, ...overrides } = input;
  void ignoredAssetId;
  return {
    checkId: "00000000-0000-4000-8000-000000000105",
    generationTaskId: "00000000-0000-4000-8000-000000000101",
    requirementRunId: "00000000-0000-4000-8000-000000000102",
    sourceProductAssetIds: ["00000000-0000-4000-8000-000000000106"],
    generatedAsset: {
      id: assetId,
      projectId: "00000000-0000-4000-8000-000000000103",
      kind: "image",
      mimeType: "image/png",
      byteSize: 100,
      createdAt: new Date().toISOString()
    },
    status,
    phase: input.phase ?? "initial_inspection",
    verdict: input.verdict ?? null,
    attempts: [],
    reconciliation: null,
    userMessage: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}
