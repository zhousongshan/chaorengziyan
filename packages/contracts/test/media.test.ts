import { describe, expect, it } from "vitest";

import {
  mediaAssetCalendarQuerySchema,
  mediaAssetCalendarResponseSchema,
  mediaAssetListQuerySchema,
  mediaAssetListResponseSchema
} from "../src/media.js";

describe("media asset list contract", () => {
  it("applies bounded pagination and filter defaults", () => {
    expect(mediaAssetListQuerySchema.parse({})).toEqual({
      keyword: "",
      scope: "all",
      source: "all",
      sort: "newest",
      page: 1,
      pageSize: 20
    });
    expect(mediaAssetListQuerySchema.parse({ page: "2", pageSize: "40" })).toMatchObject({
      page: 2,
      pageSize: 40
    });
    expect(
      mediaAssetListQuerySchema.parse({
        scope: "favorites",
        folderId: "default",
        projectId: "00000000-0000-4000-8000-000000000012",
        date: "2026-08-10"
      })
    ).toMatchObject({
      scope: "favorites",
      folderId: "default",
      projectId: "00000000-0000-4000-8000-000000000012",
      date: "2026-08-10"
    });
    expect(() => mediaAssetListQuerySchema.parse({ date: "2026-02-30" })).toThrow();
    expect(
      mediaAssetListQuerySchema.parse({ dateFrom: "2026-08-01", dateTo: "2026-08-10" })
    ).toMatchObject({ dateFrom: "2026-08-01", dateTo: "2026-08-10" });
    expect(() =>
      mediaAssetListQuerySchema.parse({ date: "2026-08-10", dateFrom: "2026-08-01" })
    ).toThrow();
    expect(() =>
      mediaAssetListQuerySchema.parse({ dateFrom: "2026-08-10", dateTo: "2026-08-01" })
    ).toThrow();
    expect(() => mediaAssetListQuerySchema.parse({ pageSize: 101 })).toThrow();
  });

  it("keeps source classification and pagination metadata explicit", () => {
    expect(
      mediaAssetListResponseSchema.parse({
        items: [
          {
            id: "00000000-0000-4000-8000-000000000011",
            projectId: "00000000-0000-4000-8000-000000000012",
            kind: "image",
            mimeType: "image/png",
            byteSize: 128,
            createdAt: "2026-08-08T08:00:00.000Z",
            name: "商品主图.png",
            source: "generated",
            favorite: false,
            folderId: null
          }
        ],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
      })
    ).toMatchObject({ items: [{ source: "generated" }], pagination: { total: 1 } });
  });

  it("validates monthly calendar statistics", () => {
    expect(mediaAssetCalendarQuerySchema.parse({ month: "2026-08" })).toEqual({
      month: "2026-08",
      keyword: "",
      scope: "all",
      source: "all"
    });
    expect(() => mediaAssetCalendarQuerySchema.parse({ month: "2026-13" })).toThrow();
    expect(
      mediaAssetCalendarResponseSchema.parse({
        month: "2026-08",
        days: [{ date: "2026-08-10", count: 3 }],
        minDate: "2026-07-01",
        maxDate: "2026-08-10"
      })
    ).toMatchObject({ days: [{ count: 3 }] });
  });
});
