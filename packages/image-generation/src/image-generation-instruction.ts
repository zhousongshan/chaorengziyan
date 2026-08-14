import type {
  CopyPlan,
  FinalRequirement,
  ImageDeliverySettings,
  ReferenceImageGuidance,
  ReferenceDesignPlan,
  ResolvedReferenceAnalysis
} from "@chaoren/contracts";

export const IMAGE_GENERATION_INSTRUCTION_VERSION = "image-instruction-v7";

export interface ImageGenerationReferenceAnalysis extends ResolvedReferenceAnalysis {
  sourceImageNumber: number;
}

export interface ImageGenerationExecutionSettings {
  generationGoal?: string | undefined;
  referenceGuidance?: ReferenceImageGuidance[] | undefined;
  referenceAnalyses?: ImageGenerationReferenceAnalysis[] | undefined;
  referenceDesignPlan?: ReferenceDesignPlan | null | undefined;
  copyPlan?: CopyPlan | undefined;
  orderedSourceRoles?: Array<"edit_base" | "product" | "reference" | "brand_logo"> | undefined;
  brandLogoPosition?: ImageDeliverySettings["watermark"]["position"] | undefined;
}

const brandLogoPositionLabels: Record<ImageDeliverySettings["watermark"]["position"], string> = {
  top_left: "左上角",
  top_right: "右上角",
  bottom_left: "左下角",
  bottom_right: "右下角",
  center: "画面中央"
};

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
  lines.push(`最终输出画布必须为 ${requirement.aspectRatio}，不得沿用任何输入图片的原始画布比例。`);
  if ((counts.editBase ?? 0) > 0) {
    lines.push(
      `如果编辑基图不是 ${requirement.aspectRatio}，必须通过重新构图并自然扩展背景来适配 ${requirement.aspectRatio} 画布；不得拉伸画面，不得裁掉商品主体、文字或其他重要内容。`
    );
  }
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
      } else if (role === "brand_logo") {
        lines.push(buildBrandLogoInstruction(label, execution.brandLogoPosition ?? "bottom_right"));
      } else {
        lines.push(
          `输入图片${label}为设计语言参考图，不作为商品事实；必须按后续结构化分析迁移其可复用设计规则。`
        );
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
      lines.push(
        `输入图片${start}-${end}为设计语言参考图，不作为商品事实；必须按后续结构化分析迁移其可复用设计规则。`
      );
    }
  }
  if (counts.reference > 0) {
    for (const [index, guidance] of (execution.referenceGuidance ?? []).entries()) {
      lines.push(`参考图${index + 1}的用途说明：${guidance.instruction}`);
    }
    for (const analysis of execution.referenceAnalyses ?? []) {
      appendReferenceAnalysis(lines, analysis);
    }
    if (execution.referenceDesignPlan) {
      appendReferenceDesignPlan(lines, execution.referenceDesignPlan);
    }
  }
  appendCopyPlan(lines, execution.copyPlan);
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

function appendReferenceAnalysis(
  lines: string[],
  analysis: ImageGenerationReferenceAnalysis
): void {
  const observed = analysis.observedDesign;
  const transfer = analysis.transferPlan;
  lines.push(`输入图片${analysis.sourceImageNumber}的结构化参考分析：`);
  lines.push(`- 卖点表达：${observed.sellingPointPresentation}`);
  lines.push(`- 构图布局：${observed.composition}`);
  lines.push(`- 信息层级：${observed.informationHierarchy}`);
  lines.push(`- 文字与字体：${observed.typography}`);
  lines.push(`- 色彩与光线：${observed.colorAndLighting}`);
  lines.push(`- 留白与节奏：${observed.spacingAndRhythm}`);
  lines.push(`- 道具与场景：${observed.propsAndScene}`);
  lines.push(`必须采用：${transfer.adopt.join("；")}`);
  lines.push(`按当前商品适配：${transfer.adapt.join("；")}`);
  lines.push(`禁止照搬：${transfer.avoid.join("；")}`);
  if (transfer.userPriority.length > 0) {
    lines.push(`用户指定的优先参考项：${transfer.userPriority.join("；")}`);
  }
  lines.push(
    "参考图的具体商品、品牌和原文案默认不直接复制；用户明确授权的内容可以使用。不得编造当前商品的材质、规格、功效或承诺。"
  );
}

function appendReferenceDesignPlan(lines: string[], plan: ReferenceDesignPlan): void {
  lines.push("参考图理解与当前商品适配方案（优先执行）：");
  lines.push(`- 设计目标：${plan.understanding.designIntent}`);
  lines.push(`- 参考图有效设计：${plan.understanding.strengths.join("；")}`);
  if (plan.understanding.weaknesses.length > 0) {
    lines.push(`- 参考图需要规避的问题：${plan.understanding.weaknesses.join("；")}`);
  }
  lines.push(`- 阅读顺序：${plan.understanding.readingOrder.join(" -> ")}`);
  lines.push(`- 画布：${plan.layoutBlueprint.canvas}`);
  lines.push(`- 商品位置：${plan.layoutBlueprint.subjectPlacement}`);
  lines.push(`- 留白：${plan.layoutBlueprint.whitespace}`);
  for (const zone of plan.layoutBlueprint.zones) {
    lines.push(
      `- 版式区 ${zone.zone}：用途=${zone.purpose}；位置=${zone.placement}；占比=${zone.relativeSize}；层级=${zone.hierarchy}`
    );
  }
  lines.push(`- 商品替换：${plan.productAdaptation.subjectReplacement}`);
  lines.push(`- 必须保留：${plan.productAdaptation.preserve.join("；")}`);
  lines.push(`- 当前商品适配：${plan.productAdaptation.adapt.join("；")}`);
  lines.push(`- 默认避免：${plan.productAdaptation.avoid.join("；")}`);
}

function appendCopyPlan(lines: string[], copyPlan?: CopyPlan): void {
  if (!copyPlan || copyPlan.blocks.length === 0) return;
  lines.push("文字规划（用户提供内容优先；AI 可生成非事实型创意文字）：");
  for (const block of copyPlan.blocks) {
    lines.push(
      `- ${block.role}：${block.text}；来源=${block.source}；位置=${block.placement}；层级=${block.hierarchy}`
    );
  }
  if (copyPlan.forbiddenFacts.length > 0) {
    lines.push(`- 禁止编造的事实内容：${copyPlan.forbiddenFacts.join("；")}`);
  }
}

export function buildBrandLogoInstruction(
  sourceImageNumber: number,
  position: ImageDeliverySettings["watermark"]["position"]
): string {
  return [
    `输入图片${sourceImageNumber}为品牌 Logo，只用于在最终画面的${brandLogoPositionLabels[position]}进行品牌露出。`,
    "请在构图阶段为 Logo 预留自然、清晰且不遮挡商品主体和重要文字的位置。",
    "尽量保持 Logo 原有的文字、图形、颜色、比例和整体识别特征；不得将其当作商品、场景或风格参考，也不得主动重新设计。"
  ].join("\n");
}

function appendField(lines: string[], name: string, value: string | null): void {
  if (value) lines.push(`${name}：${value}`);
}
