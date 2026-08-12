import type { ImageGenerationTask } from "@chaoren/contracts";

import { presentUserErrorCode, type UserErrorPresentation } from "./user-error-catalog";

type GenerationOutput = NonNullable<ImageGenerationTask["outputs"]>[number];

export type GenerationFailureGroup = {
  positions: string[];
  presentation: UserErrorPresentation;
};

export function groupGenerationOutputFailures(outputs: GenerationOutput[]) {
  const grouped = new Map<string, GenerationFailureGroup>();

  for (const output of outputs) {
    const presentation = generationOutputFailurePresentation(output);
    const key = `${presentation.title}\u0000${presentation.message}`;
    const existing = grouped.get(key);
    const position = `${output.groupPosition + 1}-${output.variantPosition + 1}`;
    if (existing) existing.positions.push(position);
    else grouped.set(key, { positions: [position], presentation });
  }

  return [...grouped.values()];
}

export function generationOutputFailurePresentation(output: GenerationOutput) {
  if (output.generationStatus === "cancelled" || output.subjectConsistencyStatus === "cancelled") {
    return presentUserErrorCode("IMAGE_GENERATION_CANCELLED");
  }
  if (output.subjectConsistencyStatus === "source_unusable") {
    return presentUserErrorCode("SOURCE_IMAGE_REPLACEMENT_REQUIRED");
  }
  if (
    output.subjectConsistencyStatus === "completed" &&
    output.subjectConsistencyRequired &&
    !output.deliverableAsset
  ) {
    return presentUserErrorCode("SUBJECT_CONSISTENCY_FAILED");
  }
  return presentUserErrorCode(output.error?.code ?? "IMAGE_GENERATION_FAILED");
}
