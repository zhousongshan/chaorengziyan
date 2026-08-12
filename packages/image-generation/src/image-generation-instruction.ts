import type { FinalRequirement, ReferenceImageGuidance } from "@chaoren/contracts";

export const IMAGE_GENERATION_INSTRUCTION_VERSION = "image-instruction-v3";

export interface ImageGenerationExecutionSettings {
  generationGoal?: string | undefined;
  referenceGuidance?: ReferenceImageGuidance[] | undefined;
  orderedSourceRoles?: Array<"edit_base" | "product" | "reference"> | undefined;
}

const subjectFeatureLabels = {
  identity: "主体身份",
  shape: "形状",
  structure: "结构",
  parts: "部件",
  color: "颜色",
  material: "材质",
  pattern: "图案",
  logo: "Logo",
  packaging: "包装"
} as const;

function subjectFeatureLabel(feature: string): string {
  return subjectFeatureLabels[feature as keyof typeof subjectFeatureLabels] ?? feature;
}

export function buildImageGenerationInstruction(
  requirement: FinalRequirement,
  counts: { editBase?: number; product: number; reference: number },
  execution: ImageGenerationExecutionSettings = {}
): string {
  const lines = ["请严格按照以下已确认的电商图片需求生成图片。", `核心需求：${requirement.intent}`];
  appendField(lines, "生成目标", execution.generationGoal ?? null);
  appendField(lines, "场景", requirement.scene);
  appendField(lines, "背景", requirement.background);
  appendField(lines, "构图", requirement.composition);
  appendField(lines, "光线", requirement.lighting);
  appendField(lines, "风格", requirement.style);

  const editBaseCount = counts.editBase ?? 0;
  if (execution.orderedSourceRoles) {
    for (const [index, role] of execution.orderedSourceRoles.entries()) {
      const label = index + 1;
      if (role === "edit_base") {
        lines.push(`输入图片${label}为本执行单元的编辑目标，是本次需要直接修改的画面。`);
      } else if (role === "product") {
        lines.push(`输入图片${label}为本执行单元的商品事实图，用于保持对应商品的主体和可见细节。`);
      } else {
        lines.push(`输入图片${label}为参考图，仅用于参考其场景、构图或视觉风格。`);
      }
    }
  } else {
    if (editBaseCount > 0) {
      lines.push("输入图片1为编辑基图，是本次需要继续修改的画面。");
    }
    if (counts.product > 0) {
      const start = editBaseCount + 1;
      const end = editBaseCount + counts.product;
      lines.push(
        `输入图片${start}-${end}为同一商品的多角度或细节图，共同用于保持商品主体、外观和可见细节的一致性。`
      );
    }
    if (counts.reference > 0) {
      const start = editBaseCount + counts.product + 1;
      const end = editBaseCount + counts.product + counts.reference;
      lines.push(`输入图片${start}-${end}为参考图，仅用于参考其场景、构图或视觉风格。`);
    }
  }
  if (counts.reference > 0) {
    for (const [index, guidance] of (execution.referenceGuidance ?? []).entries()) {
      lines.push(`参考图${index + 1}的用途说明：${guidance.instruction}`);
    }
  }
  lines.push(
    "以输入商品图作为唯一商品事实来源。默认保持商品所有可见、已确认特征不变；仅修改用户明确要求改变的维度，以及完成该要求不可避免的最小必要范围。"
  );
  lines.push(
    "不得为了强化场景语义、审美效果、真实感或合理性，擅自修改用户未要求变化的商品特征。授权一个维度变化不代表授权关联维度变化。"
  );
  if (requirement.subjectPolicy.allowedChanges.length === 0) {
    lines.push("用户没有授权修改任何商品主体特征，不得自行改变商品主体。");
  } else {
    lines.push("仅允许以下用户明确授权的商品主体变化，未列出的主体特征仍必须保持不变：");
    for (const change of requirement.subjectPolicy.allowedChanges) {
      lines.push(`- ${subjectFeatureLabel(change.feature)}：${change.instruction}`);
    }
  }
  if (requirement.mustKeep.length > 0) {
    lines.push(`必须保留：${requirement.mustKeep.join("；")}`);
  }
  if (requirement.mustAvoid.length > 0) {
    lines.push(`必须避免：${requirement.mustAvoid.join("；")}`);
  }
  if ((requirement.additionalRequirements ?? []).length > 0) {
    lines.push("补充创作要求（不得借此扩大商品主体修改权限）：");
    for (const item of requirement.additionalRequirements ?? []) {
      lines.push(`- ${item.label ?? item.key}：${item.instruction}`);
    }
  }
  return lines.join("\n");
}

function appendField(lines: string[], name: string, value: string | null): void {
  if (value) lines.push(`${name}：${value}`);
}
