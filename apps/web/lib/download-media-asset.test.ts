import { describe, expect, it } from "vitest";

import { mediaDownloadFileName } from "./download-media-asset";

describe("mediaDownloadFileName", () => {
  it("adds the extension that matches the image mime type", () => {
    expect(mediaDownloadFileName("商品主图", "image/webp")).toBe("商品主图.webp");
  });

  it("keeps an existing supported image extension", () => {
    expect(mediaDownloadFileName("商品主图.JPEG", "image/png")).toBe("商品主图.JPEG");
  });

  it("replaces characters that are invalid in file names", () => {
    expect(mediaDownloadFileName('商品/主图:"01"', "image/jpeg")).toBe("商品_主图__01_.jpg");
  });
});
