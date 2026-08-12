import { describe, expect, it } from "vitest";

import { validateImageUpload } from "../src/media-assets/image-upload.validator.js";

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("image upload validation", () => {
  it("fully decodes a valid image and returns its canonical type", async () => {
    await expect(
      validateImageUpload({
        content: validPng,
        declaredMimeType: "image/png",
        maxBytes: 1_000_000,
        maxPixels: 1_000_000
      })
    ).resolves.toMatchObject({ mimeType: "image/png", extension: "png", width: 1, height: 1 });
  });

  it("rejects a spoofed multipart MIME before storage", async () => {
    await expect(
      validateImageUpload({
        content: Buffer.from("<!doctype html>"),
        declaredMimeType: "image/png",
        maxBytes: 1_000_000,
        maxPixels: 1_000_000
      })
    ).rejects.toMatchObject({ response: { code: "INVALID_IMAGE_SIGNATURE" } });
  });

  it("rejects a declared MIME that disagrees with the signature", async () => {
    await expect(
      validateImageUpload({
        content: validPng,
        declaredMimeType: "image/jpeg",
        maxBytes: 1_000_000,
        maxPixels: 1_000_000
      })
    ).rejects.toMatchObject({ response: { code: "IMAGE_MIME_TYPE_MISMATCH" } });
  });

  it("rejects a truncated image that only has a valid signature", async () => {
    await expect(
      validateImageUpload({
        content: validPng.subarray(0, 20),
        declaredMimeType: "image/png",
        maxBytes: 1_000_000,
        maxPixels: 1_000_000
      })
    ).rejects.toMatchObject({ response: { code: "IMAGE_DECODE_FAILED" } });
  });
});
