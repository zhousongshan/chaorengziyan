import type { ImageGenerationTask, SubjectConsistencyCheck } from "@chaoren/contracts";

import { deriveGenerationStage } from "./creation-run-presentation";
import type { GenerationStage } from "./generation-stage";
import { resolveSessionGenerationActivity } from "./workflow-progress";

const activeStages = new Set<GenerationStage>([
  "generation_queued",
  "generation_running",
  "quality_initial",
  "quality_reconciling",
  "quality_final"
]);

export interface GenerationViewModel {
  displayTask: ImageGenerationTask | undefined;
  sessionHasActiveGeneration: boolean;
  stage: GenerationStage;
  generationProcessing: boolean;
}

export function resolveGenerationViewModel(input: {
  activeQuerySucceeded: boolean;
  activeTask: ImageGenerationTask | null | undefined;
  historicalTasks: ImageGenerationTask[];
  queriedTask: ImageGenerationTask | undefined;
  matchingRequirementTask: ImageGenerationTask | undefined;
  resolving: boolean;
  creatingTask: boolean;
  checks: SubjectConsistencyCheck[] | undefined;
}): GenerationViewModel {
  const historicalActiveTask = input.historicalTasks.find((task) =>
    ["queued", "running"].includes(task.workflowStatus ?? task.status)
  );
  const sessionHasActiveGeneration = resolveSessionGenerationActivity({
    activeQuerySucceeded: input.activeQuerySucceeded,
    activeTask: input.activeTask,
    historicalTasks: input.historicalTasks
  });

  const displayTask =
    input.queriedTask ??
    input.matchingRequirementTask ??
    input.activeTask ??
    (!input.activeQuerySucceeded ? historicalActiveTask : undefined);
  const derivedStage = deriveGenerationStage({
    resolving: input.resolving,
    creatingTask: input.creatingTask,
    task: displayTask,
    checks: input.checks
  });
  const stage =
    input.activeQuerySucceeded && !input.activeTask && activeStages.has(derivedStage)
      ? terminalStage(displayTask)
      : derivedStage;

  return {
    displayTask,
    sessionHasActiveGeneration,
    stage,
    generationProcessing:
      sessionHasActiveGeneration ||
      input.creatingTask ||
      (!input.activeQuerySucceeded && activeStages.has(stage))
  };
}

function terminalStage(task: ImageGenerationTask | undefined): GenerationStage {
  if (!task) return "draft";
  const status = task.workflowStatus ?? task.status;
  if (status === "failed" || status === "cancelled") return "failed";
  if (status === "succeeded" || status === "partially_succeeded") return "succeeded";
  if (
    task.outputs?.some((output) => output.deliverableAsset) ||
    (!task.subjectConsistencyRequired && task.resultAssets.length > 0)
  ) {
    return "succeeded";
  }
  return "draft";
}
