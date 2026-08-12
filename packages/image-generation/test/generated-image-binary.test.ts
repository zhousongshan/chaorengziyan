import { describe, expect, it } from "vitest";

import { ImageProviderError } from "../src/image-generation.port.js";
import {
  detectGeneratedImageMimeType,
  sanitizeProviderUrl,
  validateGeneratedImageBinary
} from "../src/generated-image-binary.js";

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("generated image binary validation", () => {
  it("detects and accepts a real PNG", () => {
    expect(detectGeneratedImageMimeType(validPng)).toBe("image/png");
    expect(
      validateGeneratedImageBinary({
        content: validPng,
        maxBytes: 1_000_000,
        responseMimeType: "image/png"
      })
    ).toBe("image/png");
  });

  it("rejects a successful HTML response before it can be stored as PNG", () => {
    const error = captureProviderError(() =>
      validateGeneratedImageBinary({
        content: Buffer.from("<!doctype html><title>New API</title>"),
        maxBytes: 1_000_000,
        responseMimeType: "text/html",
        declaredMimeType: "image/png"
      })
    );
    expect(error.code).toBe("IMAGE_DOWNLOAD_RETURNED_NON_IMAGE");
  });

  it("rejects HTML bytes even when the server falsely declares image/png", () => {
    const error = captureProviderError(() =>
      validateGeneratedImageBinary({
        content: Buffer.from("<!doctype html><title>New API</title>"),
        maxBytes: 1_000_000,
        responseMimeType: "image/png",
        declaredMimeType: "image/png"
      })
    );
    expect(error.code).toBe("IMAGE_BINARY_SIGNATURE_INVALID");
  });

  it("removes signed query parameters from diagnostic URLs", () => {
    expect(sanitizeProviderUrl("https://cdn.example.com/file.png?token=secret")).toBe(
      "https://cdn.example.com/file.png"
    );
  });
});

function captureProviderError(operation: () => unknown): ImageProviderError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageProviderError);
    return error as ImageProviderError;
  }
  throw new Error("expected ImageProviderError");
}
