import { z } from "zod";

import {
  finalRequirementSchema,
  imageDeliverySettingsSchema,
  imageRenderSettingsSchema,
  referenceImageGuidanceSchema,
  requirementImageSettingsSchema,
  requirementResultSchema
} from "./requirement.js";
import { generationPlanDraftSchema, resolvedGenerationPlanSchema } from "./generation-plan.js";

export const conversationStatusSchema = z.enum(["active", "archived"]);
export const conversationMessageRoleSchema = z.enum(["user", "assistant"]);
export const conversationMessageStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed"
]);
export const conversationAssetRoleSchema = z.enum([
  "product_source",
  "user_reference",
  "edit_base",
  "generated_result",
  "selected_result",
  "rejected_result"
]);
export const conversationMemoryStatusSchema = z.enum([
  "active",
  "superseded",
  "rejected",
  "historical"
]);

export const CONVERSATION_TURN_JOB_NAME = "process-conversation-turn" as const;

export const conversationTurnJobDataSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    messageId: z.uuid()
  })
  .strict();

export const conversationSessionSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    agentId: z.uuid().nullable(),
    title: z.string().trim().min(1).max(200),
    mode: z.literal("image"),
    status: conversationStatusSchema,
    version: z.number().int().nonnegative(),
    processingMessageId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export const createConversationRequestSchema = z
  .object({
    projectId: z.uuid(),
    agentId: z.uuid(),
    title: z.string().trim().min(1).max(200).default("新建生图会话")
  })
  .strict();

export const conversationAgentQuerySchema = z
  .object({
    agentId: z.uuid()
  })
  .strict();

export const conversationHistoryQuerySchema = z
  .object({
    agentId: z.uuid(),
    beforeTurn: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
  .strict();

export const conversationMessageAssetSchema = z
  .object({
    assetId: z.uuid(),
    role: conversationAssetRoleSchema,
    position: z.number().int().nonnegative(),
    relation: z.string().trim().min(1).max(1_000).nullable().default(null)
  })
  .strict();

export const conversationMessageSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    turnNumber: z.number().int().positive(),
    role: conversationMessageRoleSchema,
    content: z.string().max(20_000),
    status: conversationMessageStatusSchema,
    assets: z.array(conversationMessageAssetSchema),
    errorCode: z.string().nullable(),
    errorMessage: z.string().nullable(),
    createdAt: z.iso.datetime()
  })
  .strict();

export const conversationFieldSourceSchema = z
  .object({
    messageId: z.uuid(),
    turnNumber: z.number().int().positive()
  })
  .strict();

export const conversationStateSchema = z
  .object({
    activeProductAssetIds: z.array(z.uuid()).max(4),
    editBaseAssetId: z.uuid().nullable(),
    referenceAssetIds: z.array(z.uuid()).max(4),
    referenceGuidance: z.array(referenceImageGuidanceSchema).max(4).default([]),
    selectedResultAssetIds: z.array(z.uuid()),
    rejectedResultAssetIds: z.array(z.uuid()),
    agentInstruction: z.string().trim().max(1_000).default(""),
    renderSettings: imageRenderSettingsSchema.default({
      resolutionPreset: "2k",
      providerQuality: "high"
    }),
    deliverySettings: imageDeliverySettingsSchema.default({
      outputFormat: "png",
      watermark: { enabled: false, assetId: null, position: "bottom_right" }
    }),
    currentGenerationPlan: resolvedGenerationPlanSchema.nullable().default(null),
    currentRequirement: finalRequirementSchema.nullable(),
    unresolvedQuestions: z.array(z.string().trim().min(1).max(1_000)).max(10),
    fieldSources: z.record(z.string(), conversationFieldSourceSchema)
  })
  .strict();

export const emptyConversationState = {
  activeProductAssetIds: [],
  editBaseAssetId: null,
  referenceAssetIds: [],
  referenceGuidance: [],
  selectedResultAssetIds: [],
  rejectedResultAssetIds: [],
  agentInstruction: "",
  renderSettings: { resolutionPreset: "2k", providerQuality: "high" },
  deliverySettings: {
    outputFormat: "png",
    watermark: { enabled: false, assetId: null, position: "bottom_right" }
  },
  currentGenerationPlan: null,
  currentRequirement: null,
  unresolvedQuestions: [],
  fieldSources: {}
} satisfies z.infer<typeof conversationStateSchema>;

export const conversationStateSnapshotSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    throughTurn: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
    state: conversationStateSchema,
    createdAt: z.iso.datetime()
  })
  .strict();

export const createConversationMessageAttachmentSchema = z
  .object({
    assetId: z.uuid(),
    role: z.enum(["product_source", "user_reference", "edit_base"]),
    relation: z.string().trim().min(1).max(1_000).nullable().default(null)
  })
  .strict();

export const createConversationMessageRequestSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: z.uuid(),
    promptOptimizationId: z.uuid().nullable().optional(),
    modelId: z.string().trim().min(1).max(100),
    text: z.string().trim().max(12_000).default(""),
    imageSettings: requirementImageSettingsSchema.default({}),
    renderSettings: imageRenderSettingsSchema.optional(),
    deliverySettings: imageDeliverySettingsSchema.optional(),
    agentInstruction: z.string().trim().max(1_000).optional(),
    clearProductImage: z.boolean().default(false),
    clearReferenceImages: z.boolean().default(false),
    attachments: z.array(createConversationMessageAttachmentSchema).max(6).default([])
  })
  .strict()
  .refine((request) => request.text.length > 0 || Object.keys(request.imageSettings).length > 0, {
    message: "用户文字和页面设置不能同时为空"
  })
  .refine(
    (request) =>
      request.attachments.filter((attachment) => attachment.role === "product_source").length <= 4,
    { message: "普通模式最多只能设置四张商品原图" }
  )
  .refine(
    (request) =>
      request.attachments.filter((attachment) => attachment.role === "user_reference").length <= 1,
    { message: "普通模式最多只能设置一张参考图" }
  )
  .refine(
    (request) =>
      request.attachments.filter((attachment) => attachment.role === "edit_base").length <= 1,
    { message: "每轮最多只能设置一张编辑基图" }
  );

export const conversationRequirementFieldSchema = z.enum([
  "imageCount",
  "aspectRatio",
  "intent",
  "scene",
  "background",
  "composition",
  "lighting",
  "style",
  "mustKeep",
  "mustAvoid",
  "additionalRequirements",
  "subjectPolicy"
]);

export const conversationActionSchema = z.enum([
  "respond_only",
  "ask_user",
  "update_requirement",
  "generate"
]);

export const conversationResponseTypeSchema = z.enum(["normal", "unsupported_capability"]);

export const quantityDecisionSchema = z
  .object({
    source: z.enum(["explicit_user_text", "ui_control", "previous_requirement", "system_default"]),
    value: z.number().int().min(1).max(4),
    evidenceQuote: z.string().min(1).max(200).optional(),
    evidenceStart: z.number().int().nonnegative().optional(),
    evidenceEnd: z.number().int().positive().optional(),
    rule: z.string().trim().min(1).max(500).optional()
  })
  .strict();

export const conversationRequirementAiOutputSchema = z
  .object({
    action: conversationActionSchema,
    responseType: conversationResponseTypeSchema.default("normal"),
    assistantReply: z.string().trim().min(1).max(4_000),
    targetImageKey: z.string().trim().min(1).max(100).nullable().default(null),
    changedFields: z.array(conversationRequirementFieldSchema).max(16),
    assetMemories: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(100),
            caption: z.string().trim().min(1).max(2_000),
            ocrText: z.string().trim().max(4_000).nullable(),
            productFacts: z.record(z.string(), z.unknown()),
            creativeFacts: z.record(z.string(), z.unknown())
          })
          .strict()
      )
      .max(24)
      .default([]),
    generationPlan: generationPlanDraftSchema.nullable().default(null),
    quantityDecision: quantityDecisionSchema.nullable().default(null),
    result: requirementResultSchema.nullable()
  })
  .strict();

export const conversationRequirementRunSchema = z
  .object({
    sourceMessageId: z.uuid(),
    requirementRunId: z.uuid(),
    result: requirementResultSchema
  })
  .strict();

export const conversationMessagePageInfoSchema = z
  .object({
    limit: z.number().int().min(1).max(50),
    oldestTurn: z.number().int().positive().nullable(),
    newestTurn: z.number().int().positive().nullable(),
    hasMore: z.boolean(),
    nextBeforeTurn: z.number().int().positive().nullable()
  })
  .strict();

export const conversationMessagesPageResponseSchema = z
  .object({
    messages: z.array(conversationMessageSchema),
    requirementRuns: z.array(conversationRequirementRunSchema),
    messagePage: conversationMessagePageInfoSchema
  })
  .strict();

export const conversationHistoryResponseSchema = z
  .object({
    session: conversationSessionSchema,
    messages: z.array(conversationMessageSchema),
    latestSnapshot: conversationStateSnapshotSchema,
    requirementRuns: z.array(conversationRequirementRunSchema),
    latestRequirementRun: conversationRequirementRunSchema.nullable(),
    messagePage: conversationMessagePageInfoSchema
  })
  .strict();

export const currentConversationResponseSchema = z
  .object({
    session: conversationSessionSchema.nullable()
  })
  .strict();

export const createConversationMessageResponseSchema = z
  .object({
    session: conversationSessionSchema,
    userMessage: conversationMessageSchema,
    status: z.enum(["processing", "completed"])
  })
  .strict();

export type ConversationSession = z.infer<typeof conversationSessionSchema>;
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;
export type ConversationAgentQuery = z.infer<typeof conversationAgentQuerySchema>;
export type ConversationHistoryQuery = z.infer<typeof conversationHistoryQuerySchema>;
export type ConversationMessageAsset = z.infer<typeof conversationMessageAssetSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationState = z.infer<typeof conversationStateSchema>;
export type ConversationStateSnapshot = z.infer<typeof conversationStateSnapshotSchema>;
export type CreateConversationMessageRequest = z.infer<
  typeof createConversationMessageRequestSchema
>;
export type ConversationRequirementField = z.infer<typeof conversationRequirementFieldSchema>;
export type ConversationAction = z.infer<typeof conversationActionSchema>;
export type ConversationResponseType = z.infer<typeof conversationResponseTypeSchema>;
export type QuantityDecision = z.infer<typeof quantityDecisionSchema>;
export type ConversationRequirementAiOutput = z.infer<typeof conversationRequirementAiOutputSchema>;
export type ConversationRequirementRun = z.infer<typeof conversationRequirementRunSchema>;
export type ConversationMessagePageInfo = z.infer<typeof conversationMessagePageInfoSchema>;
export type ConversationMessagesPageResponse = z.infer<
  typeof conversationMessagesPageResponseSchema
>;
export type ConversationTurnJobData = z.infer<typeof conversationTurnJobDataSchema>;
export type ConversationHistoryResponse = z.infer<typeof conversationHistoryResponseSchema>;
export type CurrentConversationResponse = z.infer<typeof currentConversationResponseSchema>;
export type CreateConversationMessageResponse = z.infer<
  typeof createConversationMessageResponseSchema
>;
