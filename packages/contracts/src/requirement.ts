import { z } from "zod";

export const requirementImageSettingsSchema = z
  .object({
    imageCount: z.number().int().positive().optional(),
    aspectRatio: z.string().trim().min(1).max(20).optional(),
    generationGoal: z.enum(["商品主图", "场景展示", "营销海报", "详情页配图"]).optional(),
    visualStyle: z.enum(["真实摄影", "清新简约", "高级质感", "创意视觉"]).optional()
  })
  .strict();

export const imageResolutionPresetSchema = z.enum(["1k", "2k", "3k", "4k"]);
export const imageProviderQualitySchema = z.enum(["low", "medium", "high", "auto"]);

export const imageRenderSettingsSchema = z
  .object({
    resolutionPreset: imageResolutionPresetSchema.default("2k"),
    providerQuality: imageProviderQualitySchema.default("high")
  })
  .strict();

export const imageOutputFormatSchema = z.enum(["png", "jpeg", "webp"]);
export const watermarkPositionSchema = z.enum([
  "bottom_right",
  "top_left",
  "top_right",
  "bottom_left",
  "center"
]);

export const imageWatermarkSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    assetId: z.uuid().nullable().default(null),
    position: watermarkPositionSchema.default("bottom_right")
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enabled && !value.assetId) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: "开启水印时必须提供水印 Logo 图片"
      });
    }
  });

export const imageDeliverySettingsSchema = z
  .object({
    outputFormat: imageOutputFormatSchema.default("png"),
    watermark: imageWatermarkSettingsSchema.default({
      enabled: false,
      assetId: null,
      position: "bottom_right"
    })
  })
  .strict();

export const referenceImageGuidanceSchema = z
  .object({
    assetId: z.uuid(),
    instruction: z.string().trim().min(1).max(1_000)
  })
  .strict();

export const resolveRequirementRequestSchema = z
  .object({
    projectId: z.uuid(),
    modelId: z.string().trim().min(1).max(100),
    userText: z.string().trim().max(12_000).default(""),
    imageSettings: requirementImageSettingsSchema.default({}),
    renderSettings: imageRenderSettingsSchema.default({
      resolutionPreset: "2k",
      providerQuality: "high"
    }),
    deliverySettings: imageDeliverySettingsSchema.default({
      outputFormat: "png",
      watermark: { enabled: false, assetId: null, position: "bottom_right" }
    }),
    agentInstruction: z.string().trim().max(1_000).default(""),
    productImageIds: z.array(z.uuid()).max(4).default([]),
    referenceImageIds: z.array(z.uuid()).max(1).default([]),
    editBaseImageId: z.uuid().nullable().default(null),
    referenceGuidance: z.array(referenceImageGuidanceSchema).max(1).default([])
  })
  .strict()
  .refine(
    (request) => request.userText.length > 0 || Object.keys(request.imageSettings).length > 0,
    { message: "用户文字和页面设置不能同时为空" }
  )
  .superRefine((request, context) => {
    if (request.productImageIds.length + request.referenceImageIds.length > 5) {
      context.addIssue({
        code: "custom",
        path: ["referenceImageIds"],
        message: "普通模式每轮最多使用4张商品图和1张参考图"
      });
    }
    const references = new Set(request.referenceImageIds);
    for (const [index, guidance] of request.referenceGuidance.entries()) {
      if (!references.has(guidance.assetId)) {
        context.addIssue({
          code: "custom",
          path: ["referenceGuidance", index, "assetId"],
          message: "参考图说明必须对应已提交的参考图"
        });
      }
    }
  });

export const conflictDecisionSchema = z
  .object({
    field: z.string().min(1),
    decision: z.string().min(1),
    reason: z.string().min(1)
  })
  .strict();

// Subject details are an open set: different products can expose eyes, zippers,
// switches, seams, seals, and many other features. Keep the AI-facing key open
// and normalize it at the quality boundary instead of rejecting a whole result
// whenever a new visible detail appears.
export const subjectFeatureSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*$/, "主体特征键必须为小写英文、数字或下划线");

export const allowedSubjectChangeSchema = z
  .object({
    feature: subjectFeatureSchema,
    instruction: z.string().trim().min(1).max(2_000)
  })
  .strict();

export const subjectPolicySchema = z
  .object({
    defaultAction: z.literal("preserve"),
    allowedChanges: z.array(allowedSubjectChangeSchema).max(32).default([])
  })
  .strict();

export const additionalRequirementSchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(200).optional(),
    instruction: z.string().trim().min(1).max(2_000),
    value: z.json().optional()
  })
  .strict();

export const finalRequirementSchema = z
  .object({
    imageCount: z.number().int().positive(),
    aspectRatio: z.string().trim().min(1).max(20),
    intent: z.string().trim().min(1).max(12_000),
    scene: z.string().trim().min(1).max(2_000).nullable().default(null),
    background: z.string().trim().min(1).max(2_000).nullable().default(null),
    composition: z.string().trim().min(1).max(2_000).nullable().default(null),
    lighting: z.string().trim().min(1).max(2_000).nullable().default(null),
    style: z.string().trim().min(1).max(2_000).nullable().default(null),
    mustKeep: z.array(z.string().trim().min(1).max(1_000)).max(32).default([]),
    mustAvoid: z.array(z.string().trim().min(1).max(1_000)).max(32).default([]),
    // Stable escape hatch for creative dimensions that are not yet first-class
    // domain fields. Keeping this explicit prevents unknown AI keys from either
    // being discarded or silently becoming program-controlled fields.
    additionalRequirements: z.array(additionalRequirementSchema).max(32).optional(),
    subjectPolicy: subjectPolicySchema.default({
      defaultAction: "preserve",
      allowedChanges: []
    })
  })
  .strict();

const requirementResultBaseSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    conflictDecisions: z.array(conflictDecisionSchema).max(32).default([])
  })
  .strict();

export const readyRequirementResultSchema = requirementResultBaseSchema.extend({
  status: z.literal("ready"),
  finalRequirement: finalRequirementSchema
});

export const clarificationRequirementResultSchema = requirementResultBaseSchema.extend({
  status: z.literal("needs_clarification"),
  questions: z.array(z.string().trim().min(1).max(1_000)).min(1).max(5)
});

export const requirementResultSchema = z.discriminatedUnion("status", [
  readyRequirementResultSchema,
  clarificationRequirementResultSchema
]);

export const resolveRequirementResponseSchema = z.object({
  requirementRunId: z.uuid(),
  result: requirementResultSchema
});

export type RequirementImageSettings = z.infer<typeof requirementImageSettingsSchema>;
export type ImageResolutionPreset = z.infer<typeof imageResolutionPresetSchema>;
export type ImageProviderQuality = z.infer<typeof imageProviderQualitySchema>;
export type ImageRenderSettings = z.infer<typeof imageRenderSettingsSchema>;
export type ImageOutputFormat = z.infer<typeof imageOutputFormatSchema>;
export type WatermarkPosition = z.infer<typeof watermarkPositionSchema>;
export type ImageWatermarkSettings = z.infer<typeof imageWatermarkSettingsSchema>;
export type ImageDeliverySettings = z.infer<typeof imageDeliverySettingsSchema>;
export type ReferenceImageGuidance = z.infer<typeof referenceImageGuidanceSchema>;
export type ResolveRequirementRequest = z.infer<typeof resolveRequirementRequestSchema>;
export type SubjectFeature = z.infer<typeof subjectFeatureSchema>;
export type AllowedSubjectChange = z.infer<typeof allowedSubjectChangeSchema>;
export type SubjectPolicy = z.infer<typeof subjectPolicySchema>;
export type AdditionalRequirement = z.infer<typeof additionalRequirementSchema>;
export type FinalRequirement = z.infer<typeof finalRequirementSchema>;
export type RequirementResult = z.infer<typeof requirementResultSchema>;
export type ResolveRequirementResponse = z.infer<typeof resolveRequirementResponseSchema>;
