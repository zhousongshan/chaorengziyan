import type { ImageGenerationTask } from "@chaoren/contracts";

import type { GenerationStage } from "./generation-stage";

type ActiveStage = Exclude<GenerationStage, "draft" | "succeeded" | "failed">;

const stageRanges: Record<ActiveStage, { start: number; end: number; expectedMs: number }> = {
  requirement_resolving: { start: 4, end: 20, expectedMs: 75_000 },
  generation_queued: { start: 20, end: 27, expectedMs: 20_000 },
  generation_running: { start: 27, end: 70, expectedMs: 120_000 },
  quality_initial: { start: 70, end: 85, expectedMs: 90_000 },
  quality_reconciling: { start: 85, end: 94, expectedMs: 120_000 },
  quality_final: { start: 94, end: 99, expectedMs: 90_000 }
};

export interface WorkflowProgressEstimate {
  percent: number;
  elapsedMs: number;
  expectedRemainingMs: number | null;
  slowerThanExpected: boolean;
}

export function hasActiveSessionGeneration(tasks: ImageGenerationTask[] | undefined): boolean {
  return Boolean(
    tasks?.some((task) => ["queued", "running"].includes(task.workflowStatus ?? task.status))
  );
}

export function resolveSessionGenerationActivity(input: {
  activeQuerySucceeded: boolean;
  activeTask: ImageGenerationTask | null | undefined;
  historicalTasks: ImageGenerationTask[] | undefined;
}): boolean {
  return input.activeQuerySucceeded
    ? Boolean(input.activeTask)
    : hasActiveSessionGeneration(input.historicalTasks);
}

export function estimateWorkflowProgress(input: {
  stage: GenerationStage;
  elapsedMs: number;
  modelId?: string;
  outputCount?: number;
  maximumAttemptCount?: number;
  concurrency?: number;
}): WorkflowProgressEstimate {
  const elapsedMs = Math.max(0, input.elapsedMs);
  if (input.stage === "draft") {
    return { percent: 0, elapsedMs, expectedRemainingMs: null, slowerThanExpected: false };
  }
  if (input.stage === "succeeded" || input.stage === "failed") {
    return { percent: 100, elapsedMs, expectedRemainingMs: 0, slowerThanExpected: false };
  }

  const stage: ActiveStage = input.stage;
  const range = stageRanges[stage];
  const expectedMs = adaptiveExpectedDuration(range.expectedMs, {
    stage,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.outputCount ? { outputCount: input.outputCount } : {}),
    ...(input.maximumAttemptCount ? { maximumAttemptCount: input.maximumAttemptCount } : {}),
    ...(input.concurrency ? { concurrency: input.concurrency } : {})
  });
  const elapsedRatio = elapsedMs / expectedMs;
  const phaseRatio =
    elapsedRatio <= 1
      ? elapsedRatio * 0.82
      : Math.min(0.98, 0.82 + (1 - Math.exp(-(elapsedRatio - 1))) * 0.16);
  return {
    percent: Math.round(range.start + (range.end - range.start) * phaseRatio),
    elapsedMs,
    expectedRemainingMs: elapsedMs < expectedMs ? expectedMs - elapsedMs : null,
    slowerThanExpected: elapsedMs >= expectedMs
  };
}

export function formatProgressDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function adaptiveExpectedDuration(
  baseMs: number,
  input: {
    stage: ActiveStage;
    modelId?: string;
    outputCount?: number;
    maximumAttemptCount?: number;
    concurrency?: number;
  }
): number {
  if (input.stage !== "generation_running" && !input.stage.startsWith("quality_")) return baseMs;
  const outputCount = Math.max(1, input.outputCount ?? 1);
  const waves = Math.ceil(outputCount / Math.max(1, input.concurrency ?? 1));
  const providerFactor = input.modelId === "openai-image" ? 1.2 : 1;
  const retryFactor = (input.maximumAttemptCount ?? 1) > 1 ? 1.25 : 1;
  return Math.round(baseMs * waves * providerFactor * retryFactor);
}
