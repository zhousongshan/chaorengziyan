import { describe, expect, it } from "vitest";

import type { ImageGenerationTask } from "@chaoren/contracts";

import { resolveGenerationViewModel } from "./generation-view-model";

describe("generation view model", () => {
  it("keeps polling and busy while the authoritative endpoint returns a terminal-looking task", () => {
    const activeTask = task("succeeded");

    expect(resolve({ activeTask, historicalTasks: [task("succeeded")] })).toMatchObject({
      displayTask: activeTask,
      sessionHasActiveGeneration: true,
      stage: "succeeded",
      generationProcessing: true
    });
  });

  it("unlocks an authoritative idle session despite stale running history", () => {
    const staleTask = task("running");

    expect(resolve({ activeTask: null, historicalTasks: [staleTask] })).toMatchObject({
      displayTask: undefined,
      sessionHasActiveGeneration: false,
      stage: "draft",
      generationProcessing: false
    });
  });

  it("keeps a selected historical result visible without letting its stale stage lock submission", () => {
    const staleTask = task("running", true);

    expect(
      resolve({ activeTask: null, historicalTasks: [staleTask], queriedTask: staleTask })
    ).toMatchObject({
      displayTask: staleTask,
      sessionHasActiveGeneration: false,
      stage: "succeeded",
      generationProcessing: false
    });
  });

  it("falls back conservatively while the authoritative query has not succeeded", () => {
    const staleTask = task("running");

    expect(
      resolve({ activeQuerySucceeded: false, activeTask: undefined, historicalTasks: [staleTask] })
    ).toMatchObject({
      displayTask: staleTask,
      sessionHasActiveGeneration: true,
      stage: "generation_running",
      generationProcessing: true
    });
  });
});

function resolve(
  overrides: Partial<Parameters<typeof resolveGenerationViewModel>[0]>
): ReturnType<typeof resolveGenerationViewModel> {
  return resolveGenerationViewModel({
    activeQuerySucceeded: true,
    activeTask: null,
    historicalTasks: [],
    queriedTask: undefined,
    matchingRequirementTask: undefined,
    resolving: false,
    creatingTask: false,
    checks: undefined,
    ...overrides
  });
}

function task(status: ImageGenerationTask["status"], deliverable = false): ImageGenerationTask {
  const asset = {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    kind: "image" as const,
    mimeType: "image/png",
    byteSize: 1,
    createdAt: "2026-08-12T00:00:00.000Z"
  };
  return {
    taskId: crypto.randomUUID(),
    requirementRunId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    modelId: "openai-image",
    executionConcurrency: 2,
    stageStartedAt: "2026-08-12T00:00:00.000Z",
    subjectConsistencyRequired: false,
    status,
    workflowStatus: status,
    resultAssets: deliverable ? [asset] : [],
    error: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z"
  };
}
