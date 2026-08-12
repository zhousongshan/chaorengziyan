import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  deliveryRequiresDerivedAsset,
  renderDeliveryImage
} from "../src/image-delivery.renderer.js";

describe("image delivery renderer", () => {
  it("keeps the accepted asset when neither format conversion nor watermark is required", () => {
    expect(
      deliveryRequiresDerivedAsset("image/png", {
        outputFormat: "png",
        watermark: { enabled: false, assetId: null, position: "bottom_right" }
      })
    ).toBe(false);
  });

  it("converts the accepted image to the requested output format", async () => {
    const source = await sharp({
      create: { width: 100, height: 80, channels: 4, background: "#ff0000" }
    })
      .png()
      .toBuffer();
    const output = await renderDeliveryImage({
      source: { content: source, mimeType: "image/png" },
      settings: {
        outputFormat: "jpeg",
        watermark: { enabled: false, assetId: null, position: "bottom_right" }
      }
    });

    expect(output.mimeType).toBe("image/jpeg");
    expect(output.extension).toBe("jpg");
    await expect(sharp(output.content).metadata()).resolves.toMatchObject({ format: "jpeg" });
  });

  it("composites the configured watermark only during delivery processing", async () => {
    const source = await sharp({
      create: { width: 200, height: 160, channels: 4, background: "#ffffff" }
    })
      .png()
      .toBuffer();
    const watermark = await sharp({
      create: { width: 60, height: 24, channels: 4, background: "#0000ff" }
    })
      .png()
      .toBuffer();
    const output = await renderDeliveryImage({
      source: { content: source, mimeType: "image/png" },
      watermark: { content: watermark, mimeType: "image/png" },
      settings: {
        outputFormat: "png",
        watermark: {
          enabled: true,
          assetId: "00000000-0000-4000-8000-000000000099",
          position: "bottom_right"
        }
      }
    });

    expect(output.mimeType).toBe("image/png");
    expect(output.content.equals(source)).toBe(false);
    await expect(sharp(output.content).metadata()).resolves.toMatchObject({
      format: "png",
      width: 200,
      height: 160
    });
  });
});
