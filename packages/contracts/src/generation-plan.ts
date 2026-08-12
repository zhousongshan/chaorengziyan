import { z } from "zod";

export const generationSourceUsageSchema = z.enum([
  "edit_target",
  "subject_fact",
  "composition_member",
  "style_reference",
  "layout_cell"
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
  "rejected_result"
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

export const generationPlanDraftSchema = z
  .object({
    schemaVersion: z.literal("2.0").default("2.0"),
    summary: z.string().trim().min(1).max(2_000),
    groups: z
      .array(
        z
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
            outputCount: z.number().int().min(1).max(4),
            outputLayout: generationOutputLayoutSchema,
            instruction: z.string().trim().max(4_000).nullable().default(null)
          })
          .strict()
      )
      .min(1)
      .max(4)
  })
  .strict();

export const resolvedGenerationPlanSchema = z
  .object({
    schemaVersion: z.enum(["1.0", "2.0"]),
    summary: z.string().trim().min(1).max(2_000),
    groups: z
      .array(
        z
          .object({
            sourceImages: z
              .array(
                z
                  .object({
                    assetId: z.uuid(),
                    sourceRole: generationPlanSourceRoleSchema,
                    usage: generationSourceUsageSchema,
                    position: z.number().int().nonnegative()
                  })
                  .strict()
              )
              .max(8),
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

export function generationPlanOutputCount(plan: {
  groups: Array<{ outputCount: number }>;
}): number {
  return plan.groups.reduce((total, group) => total + group.outputCount, 0);
}

export type GenerationSourceUsage = z.infer<typeof generationSourceUsageSchema>;
export type GenerationOutputLayout = z.infer<typeof generationOutputLayoutSchema>;
export type GenerationPlanDraft = z.infer<typeof generationPlanDraftSchema>;
export type ResolvedGenerationPlan = z.infer<typeof resolvedGenerationPlanSchema>;
