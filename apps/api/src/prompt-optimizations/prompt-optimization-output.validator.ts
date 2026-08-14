import { z } from "zod";

import {
  promptOptimizationImageDecisionStatusSchema,
  type CreatePromptOptimizationRequest
} from "@chaoren/contracts";

import { parseExplicitOutputQuantity } from "../requirements/output-quantity.parser.js";
import { PROMPT_OPTIMIZATION_CONTRACT_VERSION } from "./prompt-optimization.prompt.js";

const outputSchema = z
  .object({
    contractVersion: z.literal(PROMPT_OPTIMIZATION_CONTRACT_VERSION),
    imageDecision: z
      .object({
        status: promptOptimizationImageDecisionStatusSchema,
        selectedImageKeys: z.array(z.string().trim().min(1).max(100)).max(12)
      })
      .strict(),
    optimizedText: z.string().trim().min(1).max(12_000).nullable()
  })
  .strict();

const imageDecisionOutputSchema = outputSchema.pick({
  contractVersion: true,
  imageDecision: true
});

const optimizedTextOutputSchema = outputSchema.pick({
  contractVersion: true,
  optimizedText: true
});

export interface PromptOptimizationValidationContext {
  request: CreatePromptOptimizationRequest;
  maxImageCount: number;
  allowedAspectRatios: string[];
  availableImageKeys: string[];
  explicitImageKeys: string[];
  candidateImages: Array<{
    key: string;
    role:
      "product_source" | "user_reference" | "edit_base" | "generated_result" | "selected_result";
  }>;
}

export type PromptOptimizationValidationResult =
  | {
      success: true;
      optimizedText: string | null;
      imageDecisionStatus: "not_needed" | "resolved" | "missing" | "ambiguous";
      selectedImageKeys: string[];
    }
  | { success: false; issues: Array<{ field: string; message: string }> };

export type PromptOptimizationImageDecisionValidationResult =
  | {
      success: true;
      imageDecisionStatus: "not_needed" | "resolved" | "missing" | "ambiguous";
      selectedImageKeys: string[];
    }
  | { success: false; issues: Array<{ field: string; message: string }> };

export function validatePromptOptimizationImageDecision(
  rawOutput: unknown,
  context: PromptOptimizationValidationContext
): PromptOptimizationImageDecisionValidationResult {
  const parsed = imageDecisionOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "$",
        message: issue.message
      }))
    };
  }
  const issues = validateImageDecision(parsed.data.imageDecision, context);
  return issues.length > 0
    ? { success: false, issues }
    : {
        success: true,
        imageDecisionStatus: parsed.data.imageDecision.status,
        selectedImageKeys: parsed.data.imageDecision.selectedImageKeys
      };
}

export function validatePromptOptimizationText(
  rawOutput: unknown,
  context: PromptOptimizationValidationContext,
  decision: {
    imageDecisionStatus: "not_needed" | "resolved";
    selectedImageKeys: string[];
  }
): PromptOptimizationValidationResult {
  const parsed = optimizedTextOutputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "$",
        message: issue.message
      }))
    };
  }
  return validatePromptOptimizationOutput(
    {
      contractVersion: PROMPT_OPTIMIZATION_CONTRACT_VERSION,
      imageDecision: {
        status: decision.imageDecisionStatus,
        selectedImageKeys: decision.selectedImageKeys
      },
      optimizedText: parsed.data.optimizedText
    },
    context
  );
}

export function validatePromptOptimizationOutput(
  rawOutput: unknown,
  context: PromptOptimizationValidationContext
): PromptOptimizationValidationResult {
  const parsed = outputSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "$",
        message: issue.message
      }))
    };
  }

  const issues = validateImageDecision(parsed.data.imageDecision, context);
  const selectedImageKeys = parsed.data.imageDecision.selectedImageKeys;
  const decisionStatus = parsed.data.imageDecision.status;
  if (decisionStatus === "resolved" && parsed.data.optimizedText === null) {
    issues.push({ field: "optimizedText", message: "resolved 必须返回完整优化稿" });
  }
  if (decisionStatus === "not_needed" && parsed.data.optimizedText === null) {
    issues.push({ field: "optimizedText", message: "not_needed 必须返回完整优化稿" });
  }
  if (["missing", "ambiguous"].includes(decisionStatus) && parsed.data.optimizedText !== null) {
    issues.push({ field: "optimizedText", message: "图片缺失或指代不明确时不能返回优化稿" });
  }
  const candidatesByKey = new Map(
    context.candidateImages.map((candidate) => [candidate.key, candidate])
  );
  const selectedCandidates = selectedImageKeys.flatMap((key) => {
    const candidate = candidatesByKey.get(key);
    return candidate ? [candidate] : [];
  });
  if (selectedCandidates.filter((candidate) => candidate.role === "product_source").length > 4) {
    issues.push({ field: "imageDecision.selectedImageKeys", message: "最多只能选择四张商品原图" });
  }
  if (selectedCandidates.filter((candidate) => candidate.role === "user_reference").length > 1) {
    issues.push({ field: "imageDecision.selectedImageKeys", message: "最多只能选择一张参考图" });
  }
  if (
    selectedCandidates.filter((candidate) =>
      ["edit_base", "generated_result", "selected_result"].includes(candidate.role)
    ).length > 1
  ) {
    issues.push({ field: "imageDecision.selectedImageKeys", message: "每次只能选择一个编辑目标" });
  }
  if (parsed.data.optimizedText === null) {
    return issues.length > 0
      ? { success: false, issues }
      : {
          success: true,
          optimizedText: null,
          imageDecisionStatus: decisionStatus,
          selectedImageKeys
        };
  }

  const sourceImageCount = selectedCandidates.filter(
    (candidate) => candidate.role === "product_source"
  ).length;
  const expectedQuantity = resolveExpectedQuantity(context.request, sourceImageCount);
  const outputQuantity = parseExplicitOutputQuantity(parsed.data.optimizedText, sourceImageCount);
  if (outputQuantity.status === "conflict") {
    issues.push({ field: "optimizedText", message: "优化稿包含相互冲突的明确输出数量" });
  } else if (
    outputQuantity.status === "exact" &&
    (outputQuantity.value < 1 || outputQuantity.value > context.maxImageCount)
  ) {
    issues.push({ field: "optimizedText", message: "优化稿中的输出数量超出当前允许范围" });
  } else if (expectedQuantity.status === "exact") {
    if (outputQuantity.status !== "exact" || outputQuantity.value !== expectedQuantity.value) {
      issues.push({ field: "optimizedText", message: "优化稿改变或遗漏了用户的明确输出数量" });
    }
  } else if (outputQuantity.status !== "none") {
    issues.push({ field: "optimizedText", message: "优化稿新增了输入中不存在的明确输出数量" });
  }

  const expectedRatio = resolveExpectedAspectRatio(context.request);
  const outputRatios = findAspectRatios(parsed.data.optimizedText);
  if (expectedRatio.status === "conflict") {
    issues.push({ field: "optimizedText", message: "输入包含相互冲突的图片比例" });
  } else if (
    expectedRatio.status === "exact" &&
    expectedRatio.explicit &&
    !outputRatios.includes(expectedRatio.value)
  ) {
    issues.push({ field: "optimizedText", message: "优化稿遗漏了用户明确指定的图片比例" });
  }
  if (
    outputRatios.some(
      (ratio) =>
        expectedRatio.status !== "exact" ||
        ratio !== expectedRatio.value ||
        !context.allowedAspectRatios.includes(ratio)
    )
  ) {
    issues.push({ field: "optimizedText", message: "优化稿新增或改变了图片比例" });
  }

  return issues.length > 0
    ? { success: false, issues }
    : {
        success: true,
        optimizedText: parsed.data.optimizedText,
        imageDecisionStatus: decisionStatus,
        selectedImageKeys
      };
}

function validateImageDecision(
  decision: {
    status: "not_needed" | "resolved" | "missing" | "ambiguous";
    selectedImageKeys: string[];
  },
  context: PromptOptimizationValidationContext
): Array<{ field: string; message: string }> {
  const issues: Array<{ field: string; message: string }> = [];
  const selectedSet = new Set(decision.selectedImageKeys);
  if (selectedSet.size !== decision.selectedImageKeys.length) {
    issues.push({ field: "imageDecision.selectedImageKeys", message: "图片句柄不能重复" });
  }
  if (decision.selectedImageKeys.some((key) => !context.availableImageKeys.includes(key))) {
    issues.push({
      field: "imageDecision.selectedImageKeys",
      message: "图片句柄必须来自程序提供的合法候选"
    });
  }
  if (decision.status === "resolved" && decision.selectedImageKeys.length === 0) {
    issues.push({ field: "imageDecision", message: "resolved 必须选择至少一张合法图片" });
  }
  if (decision.status !== "resolved" && decision.selectedImageKeys.length > 0) {
    issues.push({ field: "imageDecision", message: "只有 resolved 可以选择图片" });
  }
  if (
    context.explicitImageKeys.length > 0 &&
    (decision.status !== "resolved" ||
      !startsWithSequence(decision.selectedImageKeys, context.explicitImageKeys))
  ) {
    issues.push({
      field: "imageDecision.selectedImageKeys",
      message: "用户本轮明确附带的图片必须全部按原顺序使用"
    });
  }
  return issues;
}

function startsWithSequence(values: string[], required: string[]): boolean {
  return required.every((value, index) => values[index] === value);
}

export function validatePromptOptimizationInput(
  request: CreatePromptOptimizationRequest,
  maxImageCount: number,
  allowedAspectRatios: string[]
): Array<{ field: string; message: string }> {
  const issues: Array<{ field: string; message: string }> = [];
  const sourceImageCount = request.attachments.filter(
    (attachment) => attachment.role === "product_source"
  ).length;
  const quantity = resolveExpectedQuantity(request, sourceImageCount);
  if (quantity.status === "conflict") {
    issues.push({ field: "text", message: "输入包含多个相互冲突的明确输出数量" });
  } else if (
    quantity.status === "exact" &&
    (quantity.value < 1 || quantity.value > maxImageCount)
  ) {
    issues.push({
      field: request.operation === "revise" ? "revisionInstruction" : "text",
      message:
        quantity.value < 1
          ? "图片数量必须至少为 1 张"
          : `要求生成 ${quantity.value} 张，但当前单次最多支持 ${maxImageCount} 张`
    });
  }
  if (request.imageSettings.imageCount && request.imageSettings.imageCount > maxImageCount) {
    issues.push({
      field: "imageSettings.imageCount",
      message: `页面图片数量不能超过当前上限 ${maxImageCount}`
    });
  }
  const expectedRatio = resolveExpectedAspectRatio(request);
  if (expectedRatio.status === "conflict") {
    issues.push({
      field: request.operation === "revise" ? "revisionInstruction" : "text",
      message: "输入包含多个相互冲突的图片比例"
    });
  } else if (
    expectedRatio.status === "exact" &&
    !allowedAspectRatios.includes(expectedRatio.value)
  ) {
    issues.push({
      field: expectedRatio.explicit ? "text" : "imageSettings.aspectRatio",
      message: `图片比例必须是 ${allowedAspectRatios.join("、")} 之一`
    });
  }
  return issues;
}

function resolveExpectedQuantity(
  request: CreatePromptOptimizationRequest,
  sourceImageCount: number
) {
  const revisionQuantity = request.revisionInstruction
    ? parseExplicitOutputQuantity(request.revisionInstruction, sourceImageCount)
    : { status: "none" as const, matches: [] as [] };
  if (revisionQuantity.status !== "none") return revisionQuantity;
  const textQuantity = parseExplicitOutputQuantity(request.text, sourceImageCount);
  if (textQuantity.status !== "none") return textQuantity;
  return request.imageSettings.imageCount
    ? { status: "exact" as const, value: request.imageSettings.imageCount, matches: [] }
    : { status: "none" as const, matches: [] as [] };
}

type ExpectedAspectRatio =
  | { status: "none" }
  | { status: "exact"; value: string; explicit: boolean }
  | { status: "conflict"; values: string[]; explicit: true };

function resolveExpectedAspectRatio(request: CreatePromptOptimizationRequest): ExpectedAspectRatio {
  const revisionRatios = request.revisionInstruction
    ? findAspectRatios(request.revisionInstruction)
    : [];
  if (revisionRatios.length > 1) {
    return { status: "conflict", values: revisionRatios, explicit: true };
  }
  if (revisionRatios[0]) {
    return { status: "exact", value: revisionRatios[0], explicit: true };
  }
  const textRatios = findAspectRatios(request.text);
  if (textRatios.length > 1) {
    return { status: "conflict", values: textRatios, explicit: true };
  }
  if (textRatios[0]) return { status: "exact", value: textRatios[0], explicit: true };
  return request.imageSettings.aspectRatio
    ? { status: "exact", value: request.imageSettings.aspectRatio, explicit: false }
    : { status: "none" };
}

function findAspectRatios(text: string): string[] {
  const ratios: string[] = [];
  for (const match of text.matchAll(
    /(?:^|[^0-9])([0-9]{1,3})\s*[:：比]\s*([0-9]{1,3})(?![0-9])/g
  )) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    if (left > 0 && right > 0) ratios.push(`${left}:${right}`);
  }
  return [...new Set(ratios)];
}
