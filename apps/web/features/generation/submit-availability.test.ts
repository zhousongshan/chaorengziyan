import { describe, expect, it } from "vitest";

import { deriveSubmitAvailability, hasComposerInput } from "./submit-availability";

const readyInput = {
  conversationProcessing: false,
  generationProcessing: false,
  cancellationPending: false,
  readinessLoading: false,
  generationServiceReady: true,
  projectLoading: false,
  projectReady: true,
  modelsLoading: false,
  hasModels: true,
  hasInput: true
};

describe("composer submit availability", () => {
  it("allows a ready request", () => {
    expect(deriveSubmitAvailability(readyInput)).toEqual({
      disabled: false,
      busy: false,
      label: "发送",
      reason: null
    });
  });

  it("shows the active workflow instead of a generic disabled state", () => {
    expect(deriveSubmitAvailability({ ...readyInput, conversationProcessing: true })).toMatchObject(
      { busy: true, label: "理解需求中", reason: "正在理解当前需求" }
    );
    expect(deriveSubmitAvailability({ ...readyInput, generationProcessing: true })).toMatchObject({
      busy: true,
      label: "生成中",
      reason: "正在生成或检查图片"
    });
  });

  it("distinguishes infrastructure and missing input reasons", () => {
    expect(
      deriveSubmitAvailability({
        ...readyInput,
        readinessLoading: true,
        generationServiceReady: false
      }).reason
    ).toBe("正在检查创作服务");
    expect(deriveSubmitAvailability({ ...readyInput, hasInput: false }).reason).toBe(
      "请输入内容或添加图片"
    );
  });

  it("allows image-only requests to submit and retry", () => {
    expect(hasComposerInput({ text: "", productImageCount: 1, referenceImageCount: 0 })).toBe(true);
    expect(hasComposerInput({ text: "  ", productImageCount: 0, referenceImageCount: 0 })).toBe(
      false
    );
  });
});
