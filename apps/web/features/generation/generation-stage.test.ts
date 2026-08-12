import { describe, expect, it } from "vitest";

import {
  generationStageForQualityPhase,
  generationStageLabel,
  isTerminalGenerationStage
} from "./generation-stage";

describe("generation stage", () => {
  it("only treats completed outcomes as terminal", () => {
    expect(isTerminalGenerationStage("succeeded")).toBe(true);
    expect(isTerminalGenerationStage("failed")).toBe(true);
    expect(isTerminalGenerationStage("quality_initial")).toBe(false);
  });

  it("keeps internal quality workflow details hidden from users", () => {
    expect(generationStageLabel.quality_final).toBe("正在确认最终效果");
    expect(Object.values(generationStageLabel).join(" ")).not.toMatch(/需求AI|质检|第二次/);
  });

  it("maps each stored quality phase to the corresponding progress stage", () => {
    expect(generationStageForQualityPhase("initial_inspection")).toBe("quality_initial");
    expect(generationStageForQualityPhase("requirement_reconciliation")).toBe(
      "quality_reconciling"
    );
    expect(generationStageForQualityPhase("repair_generation")).toBe("quality_reconciling");
    expect(generationStageForQualityPhase("final_inspection")).toBe("quality_final");
  });
});
