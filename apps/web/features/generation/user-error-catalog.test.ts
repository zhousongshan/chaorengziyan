import { describe, expect, it } from "vitest";

import { presentUserError, presentUserErrorCode } from "./user-error-catalog";

describe("user error catalog", () => {
  it("distinguishes the user's network from the image service availability", () => {
    expect(presentUserError(new TypeError("Failed to fetch")).title).toBe("网络连接异常");
    expect(presentUserErrorCode("IMAGE_PROVIDER_UNAVAILABLE").title).toBe("生图服务暂时不可用");
  });

  it("gives actionable copy for invalid source and invalid generated images", () => {
    expect(presentUserErrorCode("INVALID_SOURCE_PRODUCT_IMAGE").action).toBe("replace_image");
    expect(presentUserErrorCode("INVALID_GENERATED_IMAGE_CONTENT").action).toBe("retry");
  });

  it("does not expose unknown backend errors", () => {
    expect(presentUserErrorCode("SOME_PROVIDER_INTERNAL_502")).toEqual({
      title: "任务处理失败",
      message: "暂时无法完成本次创作，请稍后重试。",
      action: "retry",
      actionLabel: "重新尝试",
      retryable: true
    });
  });

  it("explains regeneration source and idempotency conflicts without exposing internals", () => {
    expect(presentUserErrorCode("IMAGE_GENERATION_OUTPUT_CHANGED")).toMatchObject({
      title: "所选结果已经更新",
      action: "refresh",
      retryable: true
    });
    expect(presentUserErrorCode("IMAGE_GENERATION_OUTPUT_NOT_READY")).toMatchObject({
      title: "所选结果尚未完成",
      retryable: true
    });
    expect(presentUserErrorCode("IMAGE_GENERATION_IDEMPOTENCY_CONFLICT")).toMatchObject({
      title: "再次生成请求已发生变化",
      retryable: false
    });
  });
});
