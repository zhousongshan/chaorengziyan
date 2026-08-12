import { describe, expect, it } from "vitest";

import type { ImageGenerationTask } from "@chaoren/contracts";

import { groupGenerationOutputFailures } from "./generation-failure-presentation";

type GenerationOutput = NonNullable<ImageGenerationTask["outputs"]>[number];

describe("groupGenerationOutputFailures", () => {
  it("groups positions that failed for the same user-safe reason", () => {
    const groups = groupGenerationOutputFailures([
      failedOutput(0, 1, "IMAGE_PROVIDER_TIMEOUT"),
      failedOutput(0, 2, "IMAGE_PROVIDER_TIMEOUT")
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      positions: ["1-2", "1-3"],
      presentation: { title: "本次生成等待时间过长" }
    });
  });

  it("uses a dedicated explanation for cancelled outputs", () => {
    const output = failedOutput(0, 0, null);
    output.generationStatus = "cancelled";

    expect(groupGenerationOutputFailures([output])[0]?.presentation).toMatchObject({
      title: "任务已停止"
    });
  });
});

function failedOutput(
  groupPosition: number,
  variantPosition: number,
  code: string | null
): GenerationOutput {
  return {
    unitId: crypto.randomUUID(),
    position: variantPosition,
    groupPosition,
    variantPosition,
    generationStatus: "failed",
    attemptCount: 2,
    stageStartedAt: "2026-08-11T00:00:00.000Z",
    completedAt: "2026-08-11T00:01:00.000Z",
    subjectConsistencyRequired: false,
    subjectConsistencyStatus: null,
    subjectConsistencyPhase: null,
    generatedAsset: null,
    deliverableAsset: null,
    error: code ? { code, message: "internal message" } : null
  };
}
