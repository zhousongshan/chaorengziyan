import { z } from "zod";

import {
  conversationRequirementAiOutputSchema,
  generationPlanDraftSchema,
  generationPlanOutputCount,
  quantityDecisionSchema,
  type ConversationRequirementAiOutput,
  type FinalRequirement,
  type QuantityDecision
} from "@chaoren/contracts";

import {
  normalizeConflictDecisions,
  normalizeImageObservations,
  normalizeRequirementUpdate
} from "./requirement-ai-output.normalizer.js";
import { parseExplicitOutputQuantity } from "./output-quantity.parser.js";
import type { RequirementValidationIssue } from "./requirement-ai.port.js";

export const CONVERSATION_REQUIREMENT_CONTRACT_VERSION = "4.0";

const openRequirementRecordSchema = z.record(z.string(), z.unknown());

const requirementAiCommandEnvelopeSchema = z
  .object({
    contractVersion: z.string().trim().min(1).max(20).optional(),
    action: z.enum(["respond_only", "ask_user", "update_requirement", "generate"]),
    responseType: z.enum(["normal", "unsupported_capability"]).optional(),
    assistantReply: z.string().trim().min(1).max(4_000).optional(),
    targetImageKey: z.unknown().optional(),
    requirements: openRequirementRecordSchema.optional(),
    // V2.0 compatibility. V2.1 asks the model to use `requirements`.
    updates: openRequirementRecordSchema.optional(),
    questions: z.unknown().optional(),
    conflictDecisions: z.unknown().optional(),
    imageObservations: z.unknown().optional(),
    assetMemories: z.unknown().optional(),
    generationPlan: z.unknown().optional(),
    quantityDecision: z.unknown().optional()
  })
  .passthrough();

export interface ConversationRequirementNormalizationDefaults {
  userText: string;
  imageCount: number;
  aspectRatio: string;
  uiImageCount?: number | undefined;
  sourceImageCount?: number;
}

export type ConversationRequirementContractResult =
  | { success: true; data: ConversationRequirementAiOutput; protocol: "v3" }
  | { success: false; issues: RequirementValidationIssue[] };

export function normalizeConversationRequirementAiOutput(input: {
  rawOutput: unknown;
  currentRequirement: FinalRequirement | null;
  defaults: ConversationRequirementNormalizationDefaults;
  availableImageKeys: string[];
  availableTargetImageKeys: string[];
  availableProductSourceImageKeys?: string[];
  availableReferenceImageKeys?: string[];
  availableProductEntityIdsByImageKey?: Record<string, string[]>;
  hasCurrentProductAttachments?: boolean;
  maxOutputCount: number;
}): ConversationRequirementContractResult {
  const command = requirementAiCommandEnvelopeSchema.safeParse(input.rawOutput);
  if (command.success) {
    if (command.data.action === "respond_only") {
      return parsePublicOutput({
        action: "respond_only",
        responseType: command.data.responseType ?? "normal",
        assistantReply: command.data.assistantReply ?? "当前普通模式暂不支持这项操作。",
        targetImageKey: null,
        changedFields: [],
        assetMemories: normalizeImageObservations(
          command.data.imageObservations ?? command.data.assetMemories
        ),
        generationPlan: null,
        quantityDecision: null,
        result: null
      });
    }
    const explicitQuantity = parseExplicitOutputQuantity(
      input.defaults.userText,
      input.defaults.sourceImageCount ?? 0
    );
    if (explicitQuantity.status === "conflict") {
      const question = `你当前的需求中包含多个不同的生成数量（${explicitQuantity.values.join(
        "、"
      )} 张），请确认本次一共需要生成几张，当前模型单次最多支持 ${input.maxOutputCount} 张。`;
      return clarificationForQuantity(command.data, question);
    }
    if (
      explicitQuantity.status === "exact" &&
      (explicitQuantity.value < 1 || explicitQuantity.value > input.maxOutputCount)
    ) {
      const question =
        explicitQuantity.value < 1
          ? `生成数量至少为 1 张，请确认本次需要生成几张，当前模型单次最多支持 ${input.maxOutputCount} 张。`
          : `你要求生成 ${explicitQuantity.value} 张，但当前模型单次最多支持 ${input.maxOutputCount} 张，请调整本次生成数量。`;
      return clarificationForQuantity(command.data, question);
    }
    if (command.data.action === "ask_user") {
      const questions = normalizeQuestions(command.data.questions);
      if (questions.length === 0) {
        return {
          success: false,
          issues: [{ field: "questions", message: "ask_user 必须包含至少一个可用问题" }]
        };
      }
      return parsePublicOutput({
        action: "ask_user",
        responseType: "normal",
        assistantReply: command.data.assistantReply ?? "还需要你确认一些信息。",
        targetImageKey: null,
        changedFields: [],
        assetMemories: normalizeImageObservations(
          command.data.imageObservations ?? command.data.assetMemories
        ),
        generationPlan: null,
        quantityDecision: null,
        result: {
          schemaVersion: "1.0",
          status: "needs_clarification",
          questions,
          conflictDecisions: normalizeConflictDecisions(command.data.conflictDecisions)
        }
      });
    }

    const requirements =
      command.data.requirements ??
      command.data.updates ??
      (command.data.action === "generate" ? {} : undefined);
    if (!requirements) {
      return {
        success: false,
        issues: [{ field: "requirements", message: "update_requirement 必须包含需求对象" }]
      };
    }
    let normalized = normalizeRequirementUpdate({
      requirements,
      currentRequirement: input.currentRequirement,
      defaults: input.defaults
    });
    if (!normalized.success) return normalized;
    const generationPlan = normalizeGenerationPlan({
      value: command.data.generationPlan,
      required: command.data.action === "generate",
      availableImageKeys: input.availableImageKeys,
      availableProductSourceImageKeys: input.availableProductSourceImageKeys ?? [],
      availableReferenceImageKeys: input.availableReferenceImageKeys ?? [],
      availableProductEntityIdsByImageKey: input.availableProductEntityIdsByImageKey ?? {},
      maxOutputCount: input.maxOutputCount
    });
    if (!generationPlan.success) return generationPlan;
    const plannedEntities =
      generationPlan.data?.groups.flatMap((group) => group.subjectEntities) ?? [];
    if (
      input.currentRequirement &&
      input.hasCurrentProductAttachments &&
      plannedEntities.length > 0 &&
      plannedEntities.every((entity) => entity.lineageKind === "new_product_source")
    ) {
      normalized = normalizeRequirementUpdate({
        requirements,
        currentRequirement: null,
        defaults: input.defaults
      });
      if (!normalized.success) return normalized;
    }
    if (generationPlan.data) {
      normalized = {
        ...normalized,
        finalRequirement: {
          ...normalized.finalRequirement,
          subjectPolicy: mergeGenerationPlanSubjectPolicies(generationPlan.data.groups)
        },
        changedFields: [...new Set([...normalized.changedFields, "subjectPolicy" as const])]
      };
    }
    const quantityDecision = normalizeQuantityDecision({
      value: command.data.quantityDecision,
      required: command.data.action === "generate",
      userText: input.defaults.userText,
      uiImageCount: input.defaults.uiImageCount,
      previousImageCount: input.currentRequirement?.imageCount,
      sourceImageCount: input.defaults.sourceImageCount ?? 0,
      maxOutputCount: input.maxOutputCount
    });
    if (!quantityDecision.success) return quantityDecision;
    const plannedOutputCount = generationPlan.data
      ? generationPlanOutputCount(generationPlan.data)
      : null;
    const declaredOutputCount = normalized.changedFields.includes("imageCount")
      ? normalized.finalRequirement.imageCount
      : null;
    if (
      command.data.action === "generate" &&
      plannedOutputCount !== null &&
      quantityDecision.data !== null &&
      plannedOutputCount !== quantityDecision.data.value
    ) {
      return {
        success: false,
        issues: [
          {
            field: "generationPlan.groups.outputCount",
            message: `执行计划输出总数必须等于数量决策 ${quantityDecision.data.value}`
          }
        ]
      };
    }
    if (
      command.data.action === "generate" &&
      declaredOutputCount !== null &&
      quantityDecision.data !== null &&
      declaredOutputCount !== quantityDecision.data.value
    ) {
      return {
        success: false,
        issues: [
          {
            field: "requirements.imageCount",
            message: `需求图片数量必须等于数量决策 ${quantityDecision.data.value}`
          }
        ]
      };
    }
    const targetImageKey = normalizeTargetImageKey(command.data.targetImageKey);
    if (targetImageKey === undefined) {
      return {
        success: false,
        issues: [{ field: "targetImageKey", message: "targetImageKey 必须是图片句柄或 null" }]
      };
    }
    if (targetImageKey && !input.availableTargetImageKeys.includes(targetImageKey)) {
      return {
        success: false,
        issues: [{ field: "targetImageKey", message: "targetImageKey 不属于可编辑的会话图片" }]
      };
    }

    return parsePublicOutput({
      action: command.data.action,
      responseType: "normal",
      assistantReply: command.data.assistantReply ?? "已收到，需求已更新。",
      targetImageKey: command.data.action === "generate" ? targetImageKey : null,
      changedFields: generationPlan.data
        ? [...new Set([...normalized.changedFields, "imageCount" as const])]
        : normalized.changedFields,
      assetMemories: normalizeImageObservations(
        command.data.imageObservations ?? command.data.assetMemories
      ),
      generationPlan: generationPlan.data,
      quantityDecision: quantityDecision.data,
      result: {
        schemaVersion: "1.0",
        status: "ready",
        finalRequirement: generationPlan.data
          ? {
              ...normalized.finalRequirement,
              imageCount: plannedOutputCount!
            }
          : normalized.finalRequirement,
        conflictDecisions: normalizeConflictDecisions(command.data.conflictDecisions)
      }
    });
  }

  return {
    success: false,
    issues: command.error.issues.map((issue) => ({
      field: issue.path.join(".") || "$",
      message: issue.message
    }))
  };
}

function normalizeGenerationPlan(input: {
  value: unknown;
  required: boolean;
  availableImageKeys: string[];
  availableProductSourceImageKeys: string[];
  availableReferenceImageKeys: string[];
  availableProductEntityIdsByImageKey: Record<string, string[]>;
  maxOutputCount: number;
}):
  | { success: true; data: ConversationRequirementAiOutput["generationPlan"] }
  | { success: false; issues: RequirementValidationIssue[] } {
  if (input.value === undefined || input.value === null) {
    return input.required
      ? {
          success: false,
          issues: [{ field: "generationPlan", message: "generate 必须包含生图执行计划" }]
        }
      : { success: true, data: null };
  }
  const parsed = generationPlanDraftSchema.safeParse(input.value);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        field: ["generationPlan", ...issue.path].join("."),
        message: issue.message
      }))
    };
  }
  const normalizedGroups = parsed.data.groups;
  const missingEntityGroups = normalizedGroups.flatMap((group, index) => {
    const hasQualityCandidate = group.sourceImages.some(
      (source) =>
        source.usage !== "style_reference" &&
        source.usage !== "layout_cell" &&
        (input.availableProductSourceImageKeys.includes(source.imageKey) ||
          (input.availableProductEntityIdsByImageKey[source.imageKey]?.length ?? 0) > 0)
    );
    return hasQualityCandidate && group.subjectEntities.length === 0 ? [index] : [];
  });
  if (missingEntityGroups.length > 0) {
    return {
      success: false,
      issues: [
        {
          field: "generationPlan.groups.subjectEntities",
          message: "包含商品事实来源的输出组必须声明商品实体及其稳定血缘"
        }
      ]
    };
  }
  const unknownKeys = normalizedGroups
    .flatMap((group) => [
      ...group.sourceImages.map((source) => source.imageKey),
      ...group.subjectEntities.flatMap((entity) =>
        entity.lineageKind === "new_product_source"
          ? entity.sourceImageKeys
          : [entity.sourceImageKey]
      )
    ])
    .filter((key) => !input.availableImageKeys.includes(key));
  if (unknownKeys.length > 0) {
    return {
      success: false,
      issues: [
        {
          field: "generationPlan.groups.sourceImages.imageKey",
          message: `生图计划引用了不存在的图片句柄: ${[...new Set(unknownKeys)].join(", ")}`
        }
      ]
    };
  }
  const invalidReferenceBindings = normalizedGroups.flatMap((group, groupIndex) => {
    const invalid = group.sourceImages.some((source) => {
      const isReferenceUsage = source.usage === "style_reference" || source.usage === "layout_cell";
      const isReferenceImage = input.availableReferenceImageKeys.includes(source.imageKey);
      return isReferenceUsage !== isReferenceImage;
    });
    const missingReference = input.availableReferenceImageKeys.some(
      (key) => !group.sourceImages.some((source) => source.imageKey === key)
    );
    return invalid || missingReference ? [groupIndex] : [];
  });
  if (invalidReferenceBindings.length > 0) {
    return {
      success: false,
      issues: [
        {
          field: "generationPlan.groups.sourceImages",
          message:
            "每个输出组都必须采用当前参考图；参考图只能使用 style_reference 或 layout_cell，其他图片不能使用参考图用途"
        }
      ]
    };
  }
  const usedProductKeys = new Set(
    normalizedGroups.flatMap((group) =>
      group.sourceImages
        .filter((source) => input.availableProductSourceImageKeys.includes(source.imageKey))
        .map((source) => source.imageKey)
    )
  );
  const missingProductKeys = input.availableProductSourceImageKeys.filter(
    (key) => !usedProductKeys.has(key)
  );
  if (missingProductKeys.length > 0) {
    return {
      success: false,
      issues: [
        {
          field: "generationPlan.groups.sourceImages",
          message: `生图计划遗漏了本轮商品图: ${missingProductKeys.join(", ")}`
        }
      ]
    };
  }
  const invalidEntityReferences = normalizedGroups.flatMap((group, groupIndex) => {
    const duplicateEntityKeys = group.subjectEntities
      .map((entity) => entity.entityKey)
      .filter((key, index, all) => all.indexOf(key) !== index);
    const invalidLineage = group.subjectEntities.some((entity) => {
      if (entity.lineageKind === "new_product_source") {
        return entity.sourceImageKeys.some((key) => {
          const source = group.sourceImages.find((candidate) => candidate.imageKey === key);
          return (
            !source ||
            source.usage === "style_reference" ||
            source.usage === "layout_cell" ||
            !input.availableProductSourceImageKeys.includes(key)
          );
        });
      }
      const source = group.sourceImages.find(
        (candidate) => candidate.imageKey === entity.sourceImageKey
      );
      return (
        !source ||
        source.usage === "style_reference" ||
        source.usage === "layout_cell" ||
        !(input.availableProductEntityIdsByImageKey[entity.sourceImageKey] ?? []).includes(
          entity.productEntityId
        )
      );
    });
    return duplicateEntityKeys.length > 0 || invalidLineage ? [groupIndex] : [];
  });
  if (invalidEntityReferences.length > 0) {
    return {
      success: false,
      issues: [
        {
          field: "generationPlan.groups.subjectEntities",
          message:
            "商品实体键必须在组内唯一；新实体只能引用商品原图，历史实体只能从对应可交付图片的候选中选择"
        }
      ]
    };
  }
  const normalizedPlan = { ...parsed.data, groups: normalizedGroups };
  const outputCount = generationPlanOutputCount(normalizedPlan);
  if (outputCount > input.maxOutputCount) {
    return {
      success: false,
      issues: [
        {
          field: "generationPlan.groups.outputCount",
          message: `普通模式本次最多生成 ${input.maxOutputCount} 张独立输出`
        }
      ]
    };
  }
  return { success: true, data: normalizedPlan };
}

function normalizeQuantityDecision(input: {
  value: unknown;
  required: boolean;
  userText: string;
  uiImageCount?: number | undefined;
  previousImageCount?: number | undefined;
  sourceImageCount: number;
  maxOutputCount: number;
}):
  | { success: true; data: QuantityDecision | null }
  | { success: false; issues: RequirementValidationIssue[] } {
  if (!input.required) return { success: true, data: null };
  const expected = deriveExpectedQuantity(input);
  if (!expected.success) return expected;
  const parsed = quantityDecisionSchema.safeParse(input.value);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        field: ["quantityDecision", ...issue.path].join("."),
        message: issue.message
      }))
    };
  }
  const decision = parsed.data;
  if (decision.source !== expected.data.source || decision.value !== expected.data.value) {
    return {
      success: false,
      issues: [
        {
          field: "quantityDecision",
          message: `数量决策必须使用 ${expected.data.source} 并取值 ${expected.data.value}`
        }
      ]
    };
  }
  if (decision.source !== "explicit_user_text") return { success: true, data: decision };
  const { evidenceQuote, evidenceStart, evidenceEnd } = decision;
  if (
    evidenceQuote === undefined ||
    evidenceStart === undefined ||
    evidenceEnd === undefined ||
    evidenceEnd <= evidenceStart ||
    input.userText.slice(evidenceStart, evidenceEnd) !== evidenceQuote
  ) {
    return {
      success: false,
      issues: [
        {
          field: "quantityDecision.evidenceQuote",
          message: "文字数量决策必须附带与当前用户原文区间完全一致的证据"
        }
      ]
    };
  }
  const explicit = parseExplicitOutputQuantity(input.userText, input.sourceImageCount);
  const evidenceOverlapsValidatedQuantity =
    explicit.status === "exact" &&
    explicit.value === decision.value &&
    explicit.matches.some(
      (match) =>
        match.value === decision.value && evidenceStart < match.end && evidenceEnd > match.start
    );
  if (!evidenceOverlapsValidatedQuantity) {
    return {
      success: false,
      issues: [
        {
          field: "quantityDecision.evidenceQuote",
          message: "原文证据不能由程序确定为声明的独立输出数量"
        }
      ]
    };
  }
  return { success: true, data: decision };
}

function deriveExpectedQuantity(input: {
  userText: string;
  uiImageCount?: number | undefined;
  previousImageCount?: number | undefined;
  sourceImageCount: number;
  maxOutputCount: number;
}):
  | { success: true; data: { source: QuantityDecision["source"]; value: number } }
  | { success: false; issues: RequirementValidationIssue[] } {
  const explicit = parseExplicitOutputQuantity(input.userText, input.sourceImageCount);
  if (explicit.status === "conflict") {
    return {
      success: false,
      issues: [{ field: "quantityDecision", message: "用户文字中存在互相冲突的明确输出数量" }]
    };
  }
  if (explicit.status === "exact") {
    if (explicit.value < 1 || explicit.value > input.maxOutputCount) {
      return {
        success: false,
        issues: [
          {
            field: "quantityDecision",
            message: `用户文字确定的输出数量必须在 1 至 ${input.maxOutputCount} 之间`
          }
        ]
      };
    }
    return {
      success: true,
      data: { source: "explicit_user_text", value: explicit.value }
    };
  }
  if (input.uiImageCount !== undefined) {
    return { success: true, data: { source: "ui_control", value: input.uiImageCount } };
  }
  if (input.previousImageCount !== undefined) {
    return {
      success: true,
      data: { source: "previous_requirement", value: input.previousImageCount }
    };
  }
  return { success: true, data: { source: "system_default", value: 1 } };
}

function clarificationForQuantity(
  command: z.infer<typeof requirementAiCommandEnvelopeSchema>,
  question: string
): ConversationRequirementContractResult {
  return parsePublicOutput({
    action: "ask_user",
    responseType: "normal",
    assistantReply: question,
    targetImageKey: null,
    changedFields: [],
    assetMemories: normalizeImageObservations(command.imageObservations ?? command.assetMemories),
    generationPlan: null,
    quantityDecision: null,
    result: {
      schemaVersion: "1.0",
      status: "needs_clarification",
      questions: [question],
      conflictDecisions: normalizeConflictDecisions(command.conflictDecisions)
    }
  });
}

function normalizeTargetImageKey(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" ? value.trim().slice(0, 100) : undefined;
}

function parsePublicOutput(output: unknown): ConversationRequirementContractResult {
  const parsed = conversationRequirementAiOutputSchema.safeParse(output);
  if (parsed.success) return { success: true, protocol: "v3", data: parsed.data };
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "$",
      message: issue.message
    }))
  };
}

function normalizeQuestions(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return source
    .flatMap((item) => {
      if (typeof item === "string") return [item.trim().slice(0, 1_000)];
      const record = asRecord(item);
      const text = record?.question ?? record?.text ?? record?.content;
      return typeof text === "string" ? [text.trim().slice(0, 1_000)] : [];
    })
    .filter(Boolean)
    .slice(0, 5);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function mergeGenerationPlanSubjectPolicies(
  groups: Array<{
    subjectPolicy: {
      defaultAction: "preserve";
      allowedChanges: Array<{ feature: string; instruction: string }>;
    };
  }>
) {
  const changes = new Map<string, { feature: string; instruction: string }>();
  for (const group of groups) {
    for (const change of group.subjectPolicy.allowedChanges) {
      changes.set(`${change.feature}\u0000${change.instruction}`, change);
    }
  }
  return { defaultAction: "preserve" as const, allowedChanges: [...changes.values()] };
}
