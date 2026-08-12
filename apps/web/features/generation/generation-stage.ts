import type { SubjectConsistencyPhase } from "@chaoren/contracts";

export const generationStages = [
  "draft",
  "requirement_resolving",
  "generation_queued",
  "generation_running",
  "quality_initial",
  "quality_reconciling",
  "quality_final",
  "succeeded",
  "failed"
] as const;

export type GenerationStage = (typeof generationStages)[number];

export const generationStageLabel: Record<GenerationStage, string> = {
  draft: "准备开始创作",
  requirement_resolving: "正在理解你的需求",
  generation_queued: "正在准备生成图片",
  generation_running: "正在生成图片",
  quality_initial: "正在优化生成结果",
  quality_reconciling: "正在继续优化生成结果",
  quality_final: "正在确认最终效果",
  succeeded: "图片已生成",
  failed: "本次创作未能完成"
};

export function isTerminalGenerationStage(stage: GenerationStage) {
  return stage === "succeeded" || stage === "failed";
}

export function generationStageForQualityPhase(
  phase: SubjectConsistencyPhase | null
): Extract<GenerationStage, "quality_initial" | "quality_reconciling" | "quality_final"> {
  if (phase === "final_inspection") return "quality_final";
  if (phase === "requirement_reconciliation" || phase === "repair_generation") {
    return "quality_reconciling";
  }
  return "quality_initial";
}
