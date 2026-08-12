import { describe, expect, it } from "vitest";

import { extractClipboardImageFiles } from "./clipboard-image";
import {
  createLocalImageDraft,
  LocalImageFileError,
  maximumLocalImageBytes
} from "./local-image-file";

describe("local image input", () => {
  it("extracts image files without intercepting clipboard text", () => {
    const image = new File(["png"], "image.png", { type: "image/png" });
    const files = extractClipboardImageFiles({
      items: {
        0: { kind: "string", type: "text/plain", getAsFile: () => null },
        1: { kind: "file", type: "image/png", getAsFile: () => image },
        length: 2
      }
    });

    expect(files).toEqual([image]);
  });

  it("falls back to clipboard files when the browser does not expose items", () => {
    const image = new File(["webp"], "copied.webp", { type: "image/webp" });
    expect(extractClipboardImageFiles({ items: { length: 0 }, files: [image] })).toEqual([image]);
  });

  it("normalizes generic clipboard names and creates a preview draft", () => {
    const image = new File(["png"], "image.png", { type: "image/png" });
    const draft = createLocalImageDraft(image, {
      source: "clipboard",
      target: "product",
      now: new Date("2026-08-07T14:25:30"),
      createObjectUrl: () => "blob:preview"
    });

    expect(draft.name).toBe("clipboard-product-20260807-142530.png");
    expect(draft.previewUrl).toBe("blob:preview");
  });

  it("rejects unsupported formats and oversized images", () => {
    expect(() =>
      createLocalImageDraft(new File(["gif"], "demo.gif", { type: "image/gif" }), {
        source: "file-picker",
        target: "product",
        createObjectUrl: () => "blob:preview"
      })
    ).toThrowError(LocalImageFileError);

    const oversized = new File([new Uint8Array(maximumLocalImageBytes + 1)], "large.png", {
      type: "image/png"
    });
    expect(() =>
      createLocalImageDraft(oversized, {
        source: "drop",
        target: "reference",
        createObjectUrl: () => "blob:preview"
      })
    ).toThrow("图片不能超过20MB");
  });
});
