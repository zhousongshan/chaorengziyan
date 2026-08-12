import { describe, expect, it } from "vitest";

import type { ImageGenerationTask } from "@chaoren/contracts";

import {
  estimateWorkflowProgress,
  formatProgressDuration,
  hasActiveSessionGeneration,
  resolveSessionGenerationActivity
} from "./workflow-progress";

describe("workflow progress", () => {
  it("never completes an active stage from simulated elapsed time", () => {
    const progress = estimateWorkflowProgress({
      stage: "generation_running",
      elapsedMs: 30 * 60_000,
      modelId: "openai-image",
      outputCount: 4
    });

    expect(progress.percent).toBeLessThan(70);
    expect(progress.slowerThanExpected).toBe(true);
  });

  it("adapts the generation estimate to output waves and retries", () => {
    const single = estimateWorkflowProgress({
      stage: "generation_running",
      elapsedMs: 120_000,
      outputCount: 1
    });
    const multiple = estimateWorkflowProgress({
      stage: "generation_running",
      elapsedMs: 120_000,
      outputCount: 4,
      maximumAttemptCount: 2
    });

    expect(multiple.percent).toBeLessThan(single.percent);
    expect(multiple.expectedRemainingMs).toBeGreaterThan(single.expectedRemainingMs ?? 0);
  });

  it("uses the server-provided worker concurrency for the overall estimate", () => {
    const serial = estimateWorkflowProgress({
      stage: "generation_running",
      elapsedMs: 120_000,
      outputCount: 4,
      concurrency: 1
    });
    const parallel = estimateWorkflowProgress({
      stage: "generation_running",
      elapsedMs: 120_000,
      outputCount: 4,
      concurrency: 4
    });

    expect(parallel.percent).toBeGreaterThan(serial.percent);
    expect(parallel.expectedRemainingMs).toBeNull();
    expect(serial.expectedRemainingMs).toBeGreaterThan(0);
  });

  it("detects active tasks by the derived workflow status", () => {
    expect(hasActiveSessionGeneration([task("running")])).toBe(true);
    expect(hasActiveSessionGeneration([task("succeeded")])).toBe(false);
  });

  it("prefers an authoritative idle response over a stale running history task", () => {
    expect(
      resolveSessionGenerationActivity({
        activeQuerySucceeded: true,
        activeTask: null,
        historicalTasks: [task("running")]
      })
    ).toBe(false);
    expect(
      resolveSessionGenerationActivity({
        activeQuerySucceeded: false,
        activeTask: undefined,
        historicalTasks: [task("running")]
      })
    ).toBe(true);
  });

  it("formats a stable minute and second duration", () => {
    expect(formatProgressDuration(61_000)).toBe("01:01");
  });
});

function task(status: ImageGenerationTask["status"]): ImageGenerationTask {
  return {
    taskId: "00000000-0000-4000-8000-000000000101",
    requirementRunId: "00000000-0000-4000-8000-000000000102",
    projectId: "00000000-0000-4000-8000-000000000103",
    modelId: "openai-image",
    executionConcurrency: 2,
    stageStartedAt: "2026-01-01T00:00:00.000Z",
    subjectConsistencyRequired: false,
    status,
    workflowStatus: status,
    resultAssets: [],
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
