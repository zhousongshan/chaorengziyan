import { z } from "zod";

import { mediaAssetResponseSchema } from "./media.js";
import { subjectConsistencyStatusSchema } from "./subject-consistency.js";
import { subjectConsistencyPhaseSchema } from "./subject-consistency.js";

export const IMAGE_GENERATION_UNIT_MAX_ATTEMPTS = 2;

export const createImageGenerationRequestSchema = z
  .object({
    requirementRunId: z.uuid(),
    idempotencyKey: z.uuid()
  })
  .strict();

export const regenerateImageGenerationOutputRequestSchema = z
  .object({ idempotencyKey: z.uuid(), sourceAssetId: z.uuid() })
  .strict();

export const imageGenerationSessionListQuerySchema = z
  .object({
    sessionId: z.uuid(),
    requirementRunIds: z.preprocess(
      (value) => (typeof value === "string" ? value.split(",").filter(Boolean) : value),
      z.array(z.uuid()).min(1).max(20)
    )
  })
  .strict();

export const imageGenerationStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);

export const imageGenerationWorkflowStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled"
]);

export const imageGenerationErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

export const imageGenerationUnitFailureSchema = z
  .object({
    position: z.number().int().nonnegative(),
    code: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

export const imageGenerationOutputSchema = z
  .object({
    unitId: z.uuid(),
    position: z.number().int().nonnegative(),
    groupPosition: z.number().int().nonnegative(),
    variantPosition: z.number().int().nonnegative(),
    generationStatus: imageGenerationStatusSchema,
    attemptCount: z.number().int().nonnegative(),
    stageStartedAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    subjectConsistencyRequired: z.boolean(),
    subjectConsistencyStatus: subjectConsistencyStatusSchema.nullable(),
    subjectConsistencyPhase: subjectConsistencyPhaseSchema.nullable(),
    generatedAsset: mediaAssetResponseSchema.nullable(),
    deliverableAsset: mediaAssetResponseSchema.nullable(),
    displayName: z.string().min(1).nullable().optional(),
    favorite: z.boolean().optional(),
    error: imageGenerationErrorSchema.nullable()
  })
  .strict();

export const imageGenerationLineageSchema = z
  .object({
    taskId: z.uuid(),
    unitId: z.uuid(),
    assetId: z.uuid()
  })
  .strict();

export const imageGenerationTaskSchema = z
  .object({
    taskId: z.uuid(),
    requirementRunId: z.uuid(),
    projectId: z.uuid(),
    modelId: z.string().min(1),
    executionConcurrency: z.number().int().positive(),
    stageStartedAt: z.iso.datetime(),
    subjectConsistencyRequired: z.boolean(),
    status: imageGenerationStatusSchema,
    workflowStatus: imageGenerationWorkflowStatusSchema.optional(),
    resultAssets: z.array(mediaAssetResponseSchema),
    outputs: z.array(imageGenerationOutputSchema).optional(),
    requestedOutputCount: z.number().int().nonnegative().optional(),
    succeededOutputCount: z.number().int().nonnegative().optional(),
    unitFailures: z.array(imageGenerationUnitFailureSchema).optional(),
    regeneratedFrom: imageGenerationLineageSchema.nullable().optional(),
    error: imageGenerationErrorSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export const imageGenerationCancellationSchema = z
  .object({
    taskId: z.uuid(),
    status: z.literal("cancelled"),
    cancelledAt: z.iso.datetime(),
    providerCancellationStatus: z.enum(["not_required", "not_supported"])
  })
  .strict();

export const createImageGenerationResponseSchema = imageGenerationTaskSchema.pick({
  taskId: true,
  status: true
});

export const regenerateImageGenerationOutputResponseSchema = imageGenerationTaskSchema.pick({
  taskId: true,
  requirementRunId: true,
  status: true,
  regeneratedFrom: true
});

export const imageGenerationTaskListResponseSchema = z
  .object({
    tasks: z.array(imageGenerationTaskSchema)
  })
  .strict();

export const activeImageGenerationResponseSchema = z
  .object({ task: imageGenerationTaskSchema.nullable() })
  .strict();

export const imageGenerationEventSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    taskId: z.uuid(),
    status: imageGenerationStatusSchema,
    workflowStatus: imageGenerationWorkflowStatusSchema.optional(),
    outputs: z.array(imageGenerationOutputSchema).optional(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export type CreateImageGenerationRequest = z.infer<typeof createImageGenerationRequestSchema>;
export type RegenerateImageGenerationOutputRequest = z.infer<
  typeof regenerateImageGenerationOutputRequestSchema
>;
export type ImageGenerationSessionListQuery = z.infer<typeof imageGenerationSessionListQuerySchema>;
export type ImageGenerationStatus = z.infer<typeof imageGenerationStatusSchema>;
export type ImageGenerationWorkflowStatus = z.infer<typeof imageGenerationWorkflowStatusSchema>;
export type ImageGenerationError = z.infer<typeof imageGenerationErrorSchema>;
export type ImageGenerationOutput = z.infer<typeof imageGenerationOutputSchema>;
export type ImageGenerationLineage = z.infer<typeof imageGenerationLineageSchema>;
export type ImageGenerationTask = z.infer<typeof imageGenerationTaskSchema>;
export type ImageGenerationCancellation = z.infer<typeof imageGenerationCancellationSchema>;
export type CreateImageGenerationResponse = z.infer<typeof createImageGenerationResponseSchema>;
export type RegenerateImageGenerationOutputResponse = z.infer<
  typeof regenerateImageGenerationOutputResponseSchema
>;
export type ImageGenerationTaskListResponse = z.infer<typeof imageGenerationTaskListResponseSchema>;
export type ActiveImageGenerationResponse = z.infer<typeof activeImageGenerationResponseSchema>;
export type ImageGenerationEvent = z.infer<typeof imageGenerationEventSchema>;
