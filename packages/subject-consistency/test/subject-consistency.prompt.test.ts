import { describe, expect, it } from "vitest";

import { subjectInspectionResultSchema } from "@chaoren/contracts";

import {
  buildSubjectInspectionOutputRepairPrompt,
  buildSubjectInspectionSystemPrompt,
  buildSubjectReconciliationSystemPrompt
} from "../src/subject-consistency.prompt.js";

describe("subject consistency prompts", () => {
  it("keeps the product preserved unless a subject change is explicit", () => {
    const prompt = buildSubjectInspectionSystemPrompt();
    expect(prompt).toContain("商品主体默认保持不变");
    expect(prompt).toContain("不检查主体完整性");
    expect(prompt).toContain("用户没有明确要求主体变化时");
    expect(prompt).toContain("SOURCE_ENTITIES");
    expect(prompt).toContain("不同实体不得互相替代或合并比较");
  });

  it("repairs formatting without changing the inspection judgment", () => {
    const prompt = buildSubjectInspectionOutputRepairPrompt();
    expect(prompt).toContain("不得改变 verdict");
    expect(prompt).toContain("不得改变");
    expect(prompt).toContain("只能修复");
  });

  it("accepts and normalizes product details outside the built-in taxonomy", () => {
    const result = subjectInspectionResultSchema.parse({
      schemaVersion: "2.0",
      verdict: "failed",
      summary: "拉链细节发生变化",
      differences: [
        {
          feature: "zipper_tooth_spacing",
          featureGroup: "future_group_from_model",
          featureLabel: "拉链齿间距",
          type: "ZIPPER_SPACING_CHANGED",
          changeKind: "future_change_kind",
          severity: "major",
          sourceObservation: "原图拉链齿紧密",
          generatedObservation: "生成图拉链齿明显变稀",
          authorization: "default_preserve",
          reason: "用户没有授权修改拉链结构"
        }
      ]
    });

    expect(result.verdict).toBe("failed");
    if (result.verdict !== "failed") throw new Error("应该是失败结果");
    expect(result.differences[0]).toMatchObject({
      feature: "zipper_tooth_spacing",
      featureGroup: "other",
      changeKind: "changed"
    });
  });

  it("normalizes common visual feature aliases", () => {
    const result = subjectInspectionResultSchema.parse({
      schemaVersion: "2.0",
      verdict: "failed",
      summary: "眼睛发生变化",
      differences: [
        {
          feature: "eyes",
          type: "EYE_STATE_CHANGED",
          severity: "major",
          sourceObservation: "原图眼睛张开",
          generatedObservation: "生成图眼睛闭合",
          authorization: "default_preserve",
          reason: "未授权"
        }
      ]
    });

    if (result.verdict !== "failed") throw new Error("应该是失败结果");
    expect(result.differences[0]).toMatchObject({
      feature: "eye_state",
      featureGroup: "appearance_detail",
      changeKind: "changed"
    });
  });

  it("does not let requirement reconciliation broaden the original intent", () => {
    const prompt = buildSubjectReconciliationSystemPrompt();
    expect(prompt).toContain("不得为了让生成图片通过而改变或放宽用户原意");
    expect(prompt).toContain("reinforce_preservation");
    expect(prompt).toContain("受限修订补丁");
    expect(prompt).toContain("patch.addMustKeep");
    expect(prompt).not.toContain("ask_user");
    expect(prompt).not.toContain("restore_explicit_permission");
    expect(prompt).not.toContain("revisedSubjectPolicy");
  });
});
