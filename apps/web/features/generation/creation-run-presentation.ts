import type { ImageGenerationTask, SubjectConsistencyCheck } from "@chaoren/contracts";

import type { GenerationStage } from "./generation-stage";
import { presentUserErrorCode, type UserErrorPresentation } from "./user-error-catalog";

export function deriveGenerationStage(input: {
  resolving: boolean;
  creatingTask: boolean;
  task: ImageGenerationTask | undefined;
  checks: SubjectConsistencyCheck[] | undefined;
}): GenerationStage {
  if (input.resolving) return "requirement_resolving";
  if (input.creatingTask) return "generation_queued";
  if (!input.task) return "draft";
  if (input.task.workflowStatus === "partially_succeeded") return "succeeded";
  if (input.task.workflowStatus === "failed" || input.task.workflowStatus === "cancelled") {
    return "failed";
  }
  if (input.task.status === "queued") return "generation_queued";
  if (input.task.status === "running") return "generation_running";
  if (input.task.status === "failed" || input.task.status === "cancelled") return "failed";
  if (!input.task.subjectConsistencyRequired) return "succeeded";
  if (!input.checks || input.checks.length === 0) return "quality_initial";
  if (input.checks.some((check) => check.status === "source_unusable")) return "failed";
  if (input.checks.some((check) => check.status === "execution_failed")) return "failed";
  if (input.checks.some((check) => check.phase === "repair_generation")) {
    return "quality_reconciling";
  }
  if (
    input.checks.some(
      (check) => check.phase === "requirement_reconciliation" && check.status === "running"
    )
  ) {
    return "quality_reconciling";
  }
  if (
    input.checks.some((check) => check.phase === "final_inspection" && check.status === "running")
  ) {
    return "quality_final";
  }
  if (input.checks.some((check) => check.status === "queued" || check.status === "running")) {
    return "quality_initial";
  }
  if (input.checks.some((check) => check.verdict === "passed")) return "succeeded";
  return "failed";
}

export function getDeliverableAssets(
  task: ImageGenerationTask | undefined,
  checks: SubjectConsistencyCheck[] | undefined
) {
  if (!task) return [];
  if (task.outputs) {
    return task.outputs.flatMap((output) =>
      output.deliverableAsset ? [output.deliverableAsset] : []
    );
  }
  if (task.status !== "succeeded") return [];
  if (!task.subjectConsistencyRequired) return task.resultAssets;
  if (!checks) return [];
  return checks.flatMap((check) =>
    check.status === "completed" && check.verdict === "passed"
      ? [check.deliverableAsset ?? check.latestGeneratedAsset ?? check.generatedAsset]
      : []
  );
}

export function deriveWorkflowError(
  task: ImageGenerationTask | undefined,
  checks: SubjectConsistencyCheck[] | undefined
): UserErrorPresentation | null {
  if (task?.workflowStatus === "partially_succeeded") return null;
  if (task?.workflowStatus === "failed") {
    return presentUserErrorCode(task.outputs?.find((output) => output.error)?.error?.code);
  }
  if (task?.status === "cancelled") {
    return presentUserErrorCode("IMAGE_GENERATION_CANCELLED");
  }
  if (task?.status === "failed") {
    return presentUserErrorCode(task.error?.code);
  }
  const executionFailure = checks?.find((check) => check.status === "execution_failed");
  if (executionFailure) return presentUserErrorCode(executionFailure.error?.code);
  const insufficientSource = checks?.find((check) => check.status === "source_unusable");
  if (insufficientSource) {
    return presentUserErrorCode(
      insufficientSource.error?.code ?? "SUBJECT_INSPECTION_INCONCLUSIVE"
    );
  }
  if (
    checks?.length &&
    checks.every((check) => ["completed", "cancelled"].includes(check.status)) &&
    !checks.some((check) => check.verdict === "passed")
  ) {
    return presentUserErrorCode("SUBJECT_CONSISTENCY_FAILED");
  }
  return null;
}
