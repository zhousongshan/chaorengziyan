import { z } from "zod";

import { mediaAssetResponseSchema } from "./media.js";
import { subjectFeatureSchema } from "./requirement.js";

export const subjectConsistencyStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "source_unusable",
  "execution_failed",
  "cancelled"
]);

export const subjectConsistencyPhaseSchema = z.enum([
  "initial_inspection",
  "requirement_reconciliation",
  "repair_generation",
  "final_inspection"
]);

export const subjectConsistencyVerdictSchema = z.enum(["passed", "rejected"]);

export const subjectFeatureGroupSchema = z.enum([
  "identity",
  "geometry",
  "component",
  "surface",
  "marking",
  "packaging",
  "pose_expression",
  "appearance_detail",
  "other"
]);

export const subjectChangeKindSchema = z.enum([
  "changed",
  "added",
  "removed",
  "deformed",
  "uncertain",
  "other"
]);

export type SubjectFeatureGroup = z.infer<typeof subjectFeatureGroupSchema>;
export type SubjectChangeKind = z.infer<typeof subjectChangeKindSchema>;

const featureGroupByKey: Record<string, SubjectFeatureGroup> = {
  identity: "identity",
  shape: "geometry",
  structure: "geometry",
  pose: "pose_expression",
  orientation: "pose_expression",
  facial_expression: "pose_expression",
  eye_state: "appearance_detail",
  parts: "component",
  component: "component",
  color: "surface",
  material: "surface",
  pattern: "surface",
  texture: "surface",
  logo: "marking",
  text: "marking",
  packaging: "packaging"
};

const canonicalFeatureByAlias: Record<string, string> = {
  eye: "eye_state",
  eyes: "eye_state",
  eye_open: "eye_state",
  eye_expression: "eye_state",
  expression: "facial_expression",
  face: "facial_expression",
  posture: "pose",
  action: "pose",
  body_pose: "pose",
  direction: "orientation",
  facing: "orientation"
};

function normalizeFeatureKey(feature: string): string {
  return canonicalFeatureByAlias[feature] ?? feature;
}

function normalizeFeatureGroup(value: string | undefined, feature: string): SubjectFeatureGroup {
  const parsed = subjectFeatureGroupSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return featureGroupByKey[feature] ?? "other";
}

function normalizeChangeKind(value: string | undefined, type: string): SubjectChangeKind {
  const parsed = subjectChangeKindSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (/(ADDED|ADD)$/.test(type)) return "added";
  if (/(MISSING|REMOVED|REMOVE)$/.test(type)) return "removed";
  if (/(DEFORMED|DEFORMATION|MUTATION)$/.test(type)) return "deformed";
  if (/UNCERTAIN/.test(type)) return "uncertain";
  if (/CHANGED$/.test(type)) return "changed";
  return "other";
}

function humanizeFeature(feature: string): string {
  return feature.replaceAll("_", " ");
}

// The specific change code is intentionally open. featureGroup/changeKind are
// the stable business categories; feature/type preserve the model's precise
// observation for display, auditing, and future taxonomy growth.
export const subjectDifferenceTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z][A-Z0-9_]*$/, "差异类型必须为大写英文、数字或下划线");

const subjectDifferenceInputSchema = z
  .object({
    feature: subjectFeatureSchema,
    featureGroup: z.string().trim().min(1).max(100).optional(),
    featureLabel: z.string().trim().min(1).max(200).nullable().optional(),
    type: subjectDifferenceTypeSchema,
    changeKind: z.string().trim().min(1).max(100).optional(),
    severity: z.enum(["minor", "major", "critical"]),
    sourceObservation: z.string().trim().min(1).max(2_000),
    generatedObservation: z.string().trim().min(1).max(2_000),
    authorization: z.enum(["explicitly_allowed", "default_preserve", "conflicts_with_requirement"]),
    reason: z.string().trim().min(1).max(2_000)
  })
  .strict();

export const subjectDifferenceSchema = subjectDifferenceInputSchema.transform((difference) => {
  const feature = normalizeFeatureKey(difference.feature);
  return {
    ...difference,
    feature,
    featureGroup: normalizeFeatureGroup(difference.featureGroup, feature),
    featureLabel: difference.featureLabel ?? humanizeFeature(feature),
    changeKind: normalizeChangeKind(difference.changeKind, difference.type)
  };
});

const inspectionResultBaseSchema = z
  .object({
    schemaVersion: z.union([z.literal("1.0"), z.literal("2.0")]),
    summary: z.string().trim().min(1).max(4_000)
  })
  .strict();

export const passedSubjectInspectionResultSchema = inspectionResultBaseSchema.extend({
  verdict: z.literal("passed"),
  differences: z.array(subjectDifferenceSchema).max(32).default([])
});

export const failedSubjectInspectionResultSchema = inspectionResultBaseSchema.extend({
  verdict: z.literal("failed"),
  differences: z.array(subjectDifferenceSchema).min(1).max(32)
});

export const sourceUnusableSubjectInspectionResultSchema = inspectionResultBaseSchema.extend({
  verdict: z.literal("source_unusable"),
  reason: z.literal("insufficient_source_evidence")
});

export const subjectInspectionResultSchema = z.discriminatedUnion("verdict", [
  passedSubjectInspectionResultSchema,
  failedSubjectInspectionResultSchema,
  sourceUnusableSubjectInspectionResultSchema
]);

export const constrainedRequirementPatchSchema = z
  .object({
    addMustKeep: z.array(z.string().trim().min(1).max(1_000)).max(32).default([]),
    addMustAvoid: z.array(z.string().trim().min(1).max(1_000)).max(32).default([])
  })
  .strict();

export const constrainedRetryInspectionReconciliationSchema = z
  .object({
    schemaVersion: z.literal("2.0"),
    action: z.literal("retry_inspection"),
    repairType: z.literal("reinforce_preservation"),
    patch: constrainedRequirementPatchSchema,
    summary: z.string().trim().min(1).max(4_000)
  })
  .strict();

export const subjectRequirementReconciliationSchema =
  constrainedRetryInspectionReconciliationSchema;

export const subjectConsistencyAttemptSchema = z
  .object({
    round: z.union([z.literal(1), z.literal(2)]),
    result: subjectInspectionResultSchema,
    createdAt: z.iso.datetime()
  })
  .strict();

export const subjectConsistencyCheckSchema = z
  .object({
    checkId: z.uuid(),
    generationTaskId: z.uuid(),
    requirementRunId: z.uuid(),
    sourceProductAssetIds: z.array(z.uuid()).min(1).max(4),
    generatedAsset: mediaAssetResponseSchema,
    latestGeneratedAsset: mediaAssetResponseSchema.optional(),
    deliverableAsset: mediaAssetResponseSchema.optional(),
    repair: z
      .object({
        generationTaskId: z.uuid(),
        status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
        error: z
          .object({ code: z.string().min(1), message: z.string().min(1) })
          .strict()
          .nullable()
      })
      .strict()
      .optional(),
    status: subjectConsistencyStatusSchema,
    phase: subjectConsistencyPhaseSchema,
    verdict: subjectConsistencyVerdictSchema.nullable(),
    attempts: z.array(subjectConsistencyAttemptSchema).max(2),
    reconciliation: subjectRequirementReconciliationSchema.nullable(),
    userMessage: z.string().nullable(),
    error: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .strict()
      .nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export const subjectConsistencyWorkflowStatusSchema = z.enum([
  "queued",
  "running",
  "source_unusable",
  "passed",
  "partially_passed",
  "rejected",
  "execution_failed",
  "cancelled"
]);

export const subjectConsistencyWorkflowEventSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    generationTaskId: z.uuid(),
    status: subjectConsistencyWorkflowStatusSchema,
    updatedAt: z.iso.datetime()
  })
  .strict();

export const SUBJECT_CONSISTENCY_JOB_NAME = "subject.consistency.inspect.v1";

export const subjectConsistencyJobDataSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    checkId: z.uuid()
  })
  .strict();

export type SubjectConsistencyStatus = z.infer<typeof subjectConsistencyStatusSchema>;
export type SubjectConsistencyPhase = z.infer<typeof subjectConsistencyPhaseSchema>;
export type SubjectConsistencyVerdict = z.infer<typeof subjectConsistencyVerdictSchema>;
export type SubjectDifference = z.infer<typeof subjectDifferenceSchema>;
export type SubjectInspectionResult = z.infer<typeof subjectInspectionResultSchema>;
export type SubjectRequirementReconciliation = z.infer<
  typeof subjectRequirementReconciliationSchema
>;
export type SubjectConsistencyAttempt = z.infer<typeof subjectConsistencyAttemptSchema>;
export type SubjectConsistencyCheck = z.infer<typeof subjectConsistencyCheckSchema>;
export type SubjectConsistencyWorkflowStatus = z.infer<
  typeof subjectConsistencyWorkflowStatusSchema
>;
export type SubjectConsistencyWorkflowEvent = z.infer<typeof subjectConsistencyWorkflowEventSchema>;
export type SubjectConsistencyJobData = z.infer<typeof subjectConsistencyJobDataSchema>;
