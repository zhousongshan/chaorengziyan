import { z } from "zod";

import { createConversationMessageAttachmentSchema } from "./conversation.js";
import { requirementImageSettingsSchema } from "./requirement.js";

export const promptOptimizationOperationSchema = z.enum(["optimize", "alternative", "revise"]);

export const promptOptimizationStatusSchema = z.enum(["processing", "succeeded", "failed"]);

export const promptOptimizationInputRevisionSchema = z
  .object({
    text: z.string().max(12_000),
    attachments: z.array(createConversationMessageAttachmentSchema).max(6),
    imageSettings: requirementImageSettingsSchema,
    modelId: z.string().trim().min(1).max(100),
    stateSnapshotId: z.uuid().optional(),
    stateSnapshotVersion: z.number().int().nonnegative().optional()
  })
  .strict();

export const createPromptOptimizationRequestSchema = z
  .object({
    idempotencyKey: z.uuid(),
    operation: promptOptimizationOperationSchema.default("optimize"),
    text: z.string().trim().min(1).max(12_000),
    attachments: z.array(createConversationMessageAttachmentSchema).max(6).default([]),
    imageSettings: requirementImageSettingsSchema.default({}),
    modelId: z.string().trim().min(1).max(100),
    parentOptimizationId: z.uuid().nullable().default(null),
    revisionInstruction: z.string().trim().min(1).max(2_000).nullable().default(null)
  })
  .strict()
  .superRefine((request, context) => {
    const attachmentKeys = request.attachments.map(
      (attachment) => `${attachment.assetId}:${attachment.role}`
    );
    if (new Set(attachmentKeys).size !== attachmentKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["attachments"],
        message: "同一图片不能以相同角色重复加入优化输入"
      });
    }
    if (
      request.attachments.filter((attachment) => attachment.role === "product_source").length > 4
    ) {
      context.addIssue({
        code: "custom",
        path: ["attachments"],
        message: "普通模式最多只能设置四张商品原图"
      });
    }
    if (
      request.attachments.filter((attachment) => attachment.role === "user_reference").length > 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["attachments"],
        message: "普通模式最多只能设置一张参考图"
      });
    }
    if (request.attachments.filter((attachment) => attachment.role === "edit_base").length > 1) {
      context.addIssue({
        code: "custom",
        path: ["attachments"],
        message: "每次优化最多只能设置一张编辑基图"
      });
    }
    if (request.operation === "optimize" && request.parentOptimizationId !== null) {
      context.addIssue({
        code: "custom",
        path: ["parentOptimizationId"],
        message: "首次优化不能指定父优化记录"
      });
    }
    if (request.operation !== "optimize" && request.parentOptimizationId === null) {
      context.addIssue({
        code: "custom",
        path: ["parentOptimizationId"],
        message: "换一种表达或按指令修改必须指定父优化记录"
      });
    }
    if (request.operation === "revise" && request.revisionInstruction === null) {
      context.addIssue({
        code: "custom",
        path: ["revisionInstruction"],
        message: "按指令修改必须提供修改要求"
      });
    }
    if (request.operation !== "revise" && request.revisionInstruction !== null) {
      context.addIssue({
        code: "custom",
        path: ["revisionInstruction"],
        message: "只有按指令修改可以提供修改要求"
      });
    }
  });

export const promptOptimizationSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    operation: promptOptimizationOperationSchema,
    status: promptOptimizationStatusSchema,
    parentOptimizationId: z.uuid().nullable(),
    originalText: z.string().max(12_000),
    optimizedText: z.string().max(12_000).nullable(),
    revisionInstruction: z.string().max(2_000).nullable(),
    inputRevision: promptOptimizationInputRevisionSchema,
    adoptedMessageId: z.uuid().nullable(),
    errorCode: z.string().nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable()
  })
  .strict();

export type PromptOptimizationOperation = z.infer<typeof promptOptimizationOperationSchema>;
export type PromptOptimizationStatus = z.infer<typeof promptOptimizationStatusSchema>;
export type PromptOptimizationInputRevision = z.infer<typeof promptOptimizationInputRevisionSchema>;
export type CreatePromptOptimizationRequest = z.infer<typeof createPromptOptimizationRequestSchema>;
export type PromptOptimization = z.infer<typeof promptOptimizationSchema>;
