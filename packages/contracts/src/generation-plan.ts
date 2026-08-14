import { z } from "zod";

import { subjectPolicySchema } from "./requirement.js";

export const generationSourceUsageSchema = z.enum([
  "edit_target",
  "subject_fact",
  "composition_member",
  "style_reference",
  "layout_cell",
  "brand_mark"
]);

export const generationOutputLayoutSchema = z.enum([
  "separate_image",
  "single_canvas",
  "collage_canvas"
]);

export const generationPlanSourceRoleSchema = z.enum([
  "product_source",
  "user_reference",
  "edit_base",
  "generated_result",
  "selected_result",
  "rejected_result",
  "brand_logo"
]);

export const subjectEntityKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*$/, "商品实体键必须为小写英文、数字或下划线");

const subjectEntityBase = {
  entityKey: subjectEntityKeySchema,
  label: z.string().trim().min(1).max(200).nullable().default(null)
};

const newDraftSubjectEntitySchema = z
  .object({
    ...subjectEntityBase,
    lineageKind: z.literal("new_product_source"),
    sourceImageKeys: z.array(z.string().trim().min(1).max(100)).min(1).max(4)
  })
  .strict();

const inheritedDraftSubjectEntitySchema = z
  .object({
    ...subjectEntityBase,
    lineageKind: z.literal("inherited_product_entity"),
    productEntityId: z.uuid(),
    sourceImageKey: z.string().trim().min(1).max(100)
  })
  .strict();

export const draftSubjectEntitySchema = z.discriminatedUnion("lineageKind", [
  newDraftSubjectEntitySchema,
  inheritedDraftSubjectEntitySchema
]);

const resolvedSubjectEntitySchema = z
  .object({
    entityKey: subjectEntityKeySchema,
    label: z.string().trim().min(1).max(200).nullable(),
    productEntityId: z.uuid().nullable().default(null),
    lineageKind: z
      .enum(["new_product_source", "inherited_product_entity", "legacy_unverified"])
      .default("legacy_unverified"),
    inheritedFromAssetId: z.uuid().nullable().default(null),
    sourceAssetIds: z.array(z.uuid()).min(1).max(4)
  })
  .strict();

export const referenceDesignAnalysisSchema = z
  .object({
    sellingPointPresentation: z.string().trim().min(1).max(1_000),
    composition: z.string().trim().min(1).max(1_000),
    informationHierarchy: z.string().trim().min(1).max(1_000),
    typography: z.string().trim().min(1).max(1_000),
    colorAndLighting: z.string().trim().min(1).max(1_000),
    spacingAndRhythm: z.string().trim().min(1).max(1_000),
    propsAndScene: z.string().trim().min(1).max(1_000)
  })
  .strict();

export const referenceTransferPlanSchema = z
  .object({
    adopt: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    adapt: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    avoid: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    userPriority: z.array(z.string().trim().min(1).max(1_000)).max(8).default([])
  })
  .strict();

export const referenceUnderstandingSchema = z
  .object({
    designIntent: z.string().trim().min(1).max(1_000),
    strengths: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    weaknesses: z.array(z.string().trim().min(1).max(1_000)).max(12).default([]),
    readingOrder: z.array(z.string().trim().min(1).max(300)).min(1).max(8)
  })
  .strict();

export const referenceLayoutZoneSchema = z
  .object({
    zone: z.string().trim().min(1).max(100),
    purpose: z.string().trim().min(1).max(500),
    placement: z.string().trim().min(1).max(500),
    relativeSize: z.string().trim().min(1).max(300),
    hierarchy: z.string().trim().min(1).max(300)
  })
  .strict();

export const referenceLayoutBlueprintSchema = z
  .object({
    canvas: z.string().trim().min(1).max(300),
    subjectPlacement: z.string().trim().min(1).max(500),
    whitespace: z.string().trim().min(1).max(500),
    zones: z.array(referenceLayoutZoneSchema).min(1).max(8)
  })
  .strict();

export const referenceProductAdaptationSchema = z
  .object({
    subjectReplacement: z.string().trim().min(1).max(1_000),
    preserve: z.array(z.string().trim().min(1).max(1_000)).min(1).max(16),
    adapt: z.array(z.string().trim().min(1).max(1_000)).min(1).max(16),
    avoid: z.array(z.string().trim().min(1).max(1_000)).min(1).max(16)
  })
  .strict();

export const copyBlockSourceSchema = z.enum(["user_provided", "confirmed_fact", "ai_creative"]);

export const copyBlockSchema = z
  .object({
    role: z.string().trim().min(1).max(100),
    text: z.string().trim().min(1).max(500),
    source: copyBlockSourceSchema,
    placement: z.string().trim().min(1).max(500),
    hierarchy: z.string().trim().min(1).max(300)
  })
  .strict();

export const copyPlanSchema = z
  .object({
    blocks: z.array(copyBlockSchema).max(16).default([]),
    forbiddenFacts: z.array(z.string().trim().min(1).max(500)).max(16).default([])
  })
  .strict();

export const referenceDesignPlanSchema = z
  .object({
    understanding: referenceUnderstandingSchema,
    layoutBlueprint: referenceLayoutBlueprintSchema,
    productAdaptation: referenceProductAdaptationSchema,
    // Compatibility only: early v3 drafts nested a second copy plan here.
    // The group-level copyPlan is the sole execution source of truth.
    copyPlan: copyPlanSchema.optional()
  })
  .strict()
  .transform(({ copyPlan: _legacyCopyPlan, ...plan }) => plan);

const referenceAnalysisFields = {
  observedDesign: referenceDesignAnalysisSchema,
  transferPlan: referenceTransferPlanSchema
};

export const draftReferenceAnalysisSchema = z
  .object({
    imageKey: z.string().trim().min(1).max(100),
    ...referenceAnalysisFields
  })
  .strict();

export const resolvedReferenceAnalysisSchema = z
  .object({
    assetId: z.uuid(),
    ...referenceAnalysisFields
  })
  .strict();

const draftGenerationGroupSchema = z
  .object({
    sourceImages: z
      .array(
        z
          .object({
            imageKey: z.string().trim().min(1).max(100),
            usage: generationSourceUsageSchema
          })
          .strict()
      )
      .max(8),
    subjectEntities: z.array(draftSubjectEntitySchema).max(8).default([]),
    subjectPolicy: subjectPolicySchema,
    referenceAnalyses: z.array(draftReferenceAnalysisSchema).max(8),
    referenceDesignPlan: referenceDesignPlanSchema.nullable(),
    copyPlan: copyPlanSchema,
    outputCount: z.number().int().min(1).max(4),
    outputLayout: generationOutputLayoutSchema,
    instruction: z.string().trim().min(1).max(4_000)
  })
  .strict()
  .superRefine((group, context) => {
    validateReferenceAnalysisBindings(
      group.sourceImages
        .filter((source) => isReferenceUsage(source.usage))
        .map((source) => source.imageKey),
      group.referenceAnalyses.map((analysis) => analysis.imageKey),
      context
    );
    if (
      group.sourceImages.some((source) => isReferenceUsage(source.usage)) &&
      !group.referenceDesignPlan
    ) {
      context.addIssue({
        code: "custom",
        path: ["referenceDesignPlan"],
        message: "采用参考图时必须先完成参考图理解、版式蓝图和当前商品适配方案"
      });
    }
    if (
      !group.sourceImages.some((source) => isReferenceUsage(source.usage)) &&
      group.referenceDesignPlan
    ) {
      context.addIssue({
        code: "custom",
        path: ["referenceDesignPlan"],
        message: "未采用参考图时不能携带参考图设计方案"
      });
    }
  });

export const generationPlanDraftSchema = z
  .object({
    schemaVersion: z.literal("3.0"),
    summary: z.string().trim().min(1).max(2_000),
    groups: z.array(draftGenerationGroupSchema).min(1).max(4)
  })
  .strict();

const resolvedGenerationSourceSchema = z
  .object({
    assetId: z.uuid(),
    sourceRole: generationPlanSourceRoleSchema,
    usage: generationSourceUsageSchema,
    position: z.number().int().nonnegative()
  })
  .strict();

const legacyResolvedGenerationPlanSchema = z
  .object({
    schemaVersion: z.enum(["1.0", "2.0"]),
    summary: z.string().trim().min(1).max(2_000),
    groups: z
      .array(
        z
          .object({
            sourceImages: z.array(resolvedGenerationSourceSchema).max(9),
            subjectEntities: z.array(resolvedSubjectEntitySchema).max(8).default([]),
            outputCount: z.number().int().min(1).max(4),
            outputLayout: generationOutputLayoutSchema,
            instruction: z.string().trim().max(4_000).nullable()
          })
          .strict()
      )
      .min(1)
      .max(4)
  })
  .strict();

const resolvedGenerationGroupSchema = z
  .object({
    sourceImages: z.array(resolvedGenerationSourceSchema).max(9),
    subjectEntities: z.array(resolvedSubjectEntitySchema).max(8).default([]),
    subjectPolicy: subjectPolicySchema,
    referenceAnalyses: z.array(resolvedReferenceAnalysisSchema).max(8),
    referenceDesignPlan: referenceDesignPlanSchema.nullable(),
    copyPlan: copyPlanSchema,
    outputCount: z.number().int().min(1).max(4),
    outputLayout: generationOutputLayoutSchema,
    instruction: z.string().trim().min(1).max(4_000)
  })
  .strict()
  .superRefine((group, context) => {
    validateReferenceAnalysisBindings(
      group.sourceImages
        .filter(
          (source) => source.sourceRole === "user_reference" || isReferenceUsage(source.usage)
        )
        .map((source) => source.assetId),
      group.referenceAnalyses.map((analysis) => analysis.assetId),
      context
    );
    const usesReference = group.sourceImages.some(
      (source) => source.sourceRole === "user_reference" || isReferenceUsage(source.usage)
    );
    if (usesReference && !group.referenceDesignPlan) {
      context.addIssue({
        code: "custom",
        path: ["referenceDesignPlan"],
        message: "采用参考图时必须冻结参考图理解、版式蓝图和当前商品适配方案"
      });
    }
    if (!usesReference && group.referenceDesignPlan) {
      context.addIssue({
        code: "custom",
        path: ["referenceDesignPlan"],
        message: "未采用参考图时不能携带参考图设计方案"
      });
    }
  });

export const resolvedGenerationPlanSchema = z.union([
  legacyResolvedGenerationPlanSchema,
  z
    .object({
      schemaVersion: z.literal("3.0"),
      summary: z.string().trim().min(1).max(2_000),
      groups: z.array(resolvedGenerationGroupSchema).min(1).max(4)
    })
    .strict()
]);

function isReferenceUsage(usage: z.infer<typeof generationSourceUsageSchema>): boolean {
  return usage === "style_reference" || usage === "layout_cell";
}

function validateReferenceAnalysisBindings(
  referenceIds: string[],
  analysisIds: string[],
  context: z.core.$RefinementCtx
): void {
  const uniqueReferences = new Set(referenceIds);
  const uniqueAnalyses = new Set(analysisIds);
  if (uniqueReferences.size !== referenceIds.length || uniqueAnalyses.size !== analysisIds.length) {
    context.addIssue({
      code: "custom",
      path: ["referenceAnalyses"],
      message: "参考图和参考分析都不能重复"
    });
    return;
  }
  if (
    uniqueReferences.size !== uniqueAnalyses.size ||
    [...uniqueReferences].some((id) => !uniqueAnalyses.has(id))
  ) {
    context.addIssue({
      code: "custom",
      path: ["referenceAnalyses"],
      message: "每张被采用的参考图必须恰好对应一份结构化参考分析"
    });
  }
}

export function generationPlanOutputCount(plan: {
  groups: Array<{ outputCount: number }>;
}): number {
  return plan.groups.reduce((total, group) => total + group.outputCount, 0);
}

export type GenerationSourceUsage = z.infer<typeof generationSourceUsageSchema>;
export type GenerationOutputLayout = z.infer<typeof generationOutputLayoutSchema>;
export type ReferenceDesignAnalysis = z.infer<typeof referenceDesignAnalysisSchema>;
export type ReferenceTransferPlan = z.infer<typeof referenceTransferPlanSchema>;
export type ReferenceUnderstanding = z.infer<typeof referenceUnderstandingSchema>;
export type ReferenceLayoutBlueprint = z.infer<typeof referenceLayoutBlueprintSchema>;
export type ReferenceProductAdaptation = z.infer<typeof referenceProductAdaptationSchema>;
export type CopyPlan = z.infer<typeof copyPlanSchema>;
export type ReferenceDesignPlan = z.infer<typeof referenceDesignPlanSchema>;
export type DraftReferenceAnalysis = z.infer<typeof draftReferenceAnalysisSchema>;
export type ResolvedReferenceAnalysis = z.infer<typeof resolvedReferenceAnalysisSchema>;
export type GenerationPlanDraft = z.infer<typeof generationPlanDraftSchema>;
export type ResolvedGenerationPlan = z.infer<typeof resolvedGenerationPlanSchema>;
