import { describe, expect, it } from "vitest";

import { parseEnvironmentFile, updateModelEnvironmentFile } from "./env-file";

describe("model settings env file", () => {
  it("preserves existing keys when the form leaves key fields blank", () => {
    const current = [
      "REQUIREMENT_AI_API_KEY=deep-secret",
      "OPENAI_IMAGE_API_KEY=image-secret",
      "SUBJECT_INSPECTION_AI_API_KEY=vision-secret",
      "ENABLED_IMAGE_MODELS=bytedance-image,openai-image",
      ""
    ].join("\n");

    const updated = updateModelEnvironmentFile(current, {
      requirementBaseUrl: "https://jennyapi.site/v1",
      requirementModel: "gpt-5.6-sol",
      imageBaseUrl: "https://api.openai.com/v1",
      inspectionBaseUrl: "https://api.openai.com/v1"
    });
    const values = parseEnvironmentFile(updated);

    expect(values.REQUIREMENT_AI_API_KEY).toBe("deep-secret");
    expect(values.OPENAI_IMAGE_API_KEY).toBe("image-secret");
    expect(values.SUBJECT_INSPECTION_AI_API_KEY).toBe("vision-secret");
    expect(values.REQUIREMENT_AI_MODEL).toBe("gpt-5.6-sol");
    expect(values.OPENAI_IMAGE_MODEL).toBe("gpt-image-2");
    expect(values.OPENAI_IMAGE_API_MODE).toBe("async-relay");
    expect(values.SUBJECT_INSPECTION_AI_MODEL).toBe("gpt-5.6-sol");
    expect(values.ENABLED_IMAGE_MODELS).toBe("openai-image");
  });

  it("replaces only an explicitly supplied key", () => {
    const updated = updateModelEnvironmentFile("OPENAI_IMAGE_API_KEY=old\n", {
      requirementBaseUrl: "https://jennyapi.site/v1",
      requirementModel: "gpt-5.6-sol",
      imageBaseUrl: "https://api.openai.com/v1",
      imageApiKey: "new image key",
      inspectionBaseUrl: "https://api.openai.com/v1"
    });

    expect(parseEnvironmentFile(updated).OPENAI_IMAGE_API_KEY).toBe("new image key");
    expect(updated).not.toContain("old");
  });
});
