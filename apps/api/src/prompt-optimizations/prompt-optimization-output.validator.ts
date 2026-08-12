import { z } from "zod";

import type { CreatePromptOptimizationRequest } from "@chaoren/contracts";

import { parseExplicitOutputQuantity } from "../requirements/output-quantity.parser.js";
import { PROMPT_OPTIMIZATION_CONTRACT_VERSION } from "./prompt-optimization.prompt.js";

const outputSchema = z
  .object({
    contractVersion: z.literal(PROMPT_OPTIMIZATION_CONTRACT_VERSION),
    optimizedText: z.string().trim().min(1).max(12_000),
    usedImageKeys: z.array(z.string().trim().min(1).max(100)).max(6)
  })
  .strict();

export interface PromptOptimizationValidationContext {
  request: CreatePromptOptimizationRequest;
  maxImageCount: number;
  allowedAspectRatios: string[];
  availableImageKeys: string[];
}

export type PromptOptimizationValidationResult =
  | { success: true; optimizedText: string }
  | { success: false; issues: Array<{ field: string; message: string }> };

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

  const issues: Array<{ field: string; message: string }> = [];
  if (JSON.stringify(parsed.data.usedImageKeys) !== JSON.stringify(context.availableImageKeys)) {
    issues.push({
      field: "usedImageKeys",
      message: "图片句柄必须与程序提供的图片保持相同顺序且不能遗漏或新增"
    });
  }

  const sourceImageCount = context.request.attachments.filter(
    (attachment) => attachment.role === "product_source"
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
    : { success: true, optimizedText: parsed.data.optimizedText };
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
