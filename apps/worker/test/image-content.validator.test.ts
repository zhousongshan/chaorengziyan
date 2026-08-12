import { describe, expect, it } from "vitest";

import { validateImageContent } from "../src/image-content.validator.js";

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("image content validator", () => {
  it("decodes a valid PNG and returns canonical metadata", async () => {
    await expect(
      validateImageContent({ content: validPng, declaredMimeType: "image/png" })
    ).resolves.toEqual({ mimeType: "image/png", width: 1, height: 1 });
  });

  it("rejects HTML before it reaches storage or a vision model", async () => {
    await expect(
      validateImageContent({
        content: Buffer.from("<!doctype html><title>New API</title>"),
        declaredMimeType: "image/png"
      })
    ).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
  });

  it("rejects a declared MIME that does not match the decoded image", async () => {
    await expect(
      validateImageContent({ content: validPng, declaredMimeType: "image/jpeg" })
    ).rejects.toMatchObject({ code: "IMAGE_MIME_TYPE_MISMATCH" });
  });
});
