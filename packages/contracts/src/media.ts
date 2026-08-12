import { z } from "zod";

export const mediaKindSchema = z.enum(["image", "video"]);
export const aspectRatioSchema = z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]);

export const mediaAssetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  kind: mediaKindSchema,
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  createdAt: z.iso.datetime()
});

export const mediaAssetResponseSchema = mediaAssetSchema.omit({ storageKey: true });

export const mediaAssetSourceSchema = z.enum(["uploaded", "generated"]);
export const mediaAssetSortSchema = z.enum(["newest", "oldest"]);
export const mediaAssetScopeSchema = z.enum(["all", "favorites"]);

const mediaAssetFilterShape = {
  keyword: z.string().trim().max(200).default(""),
  scope: mediaAssetScopeSchema.default("all"),
  folderId: z.union([z.uuid(), z.literal("default")]).optional(),
  projectId: z.uuid().optional(),
  source: z.enum(["all", ...mediaAssetSourceSchema.options]).default("all")
};

export const mediaAssetListQuerySchema = z
  .object({
    ...mediaAssetFilterShape,
    // Kept temporarily for callers that still send the former single-day filter.
    date: z.iso.date().optional(),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    sort: mediaAssetSortSchema.default("newest"),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict()
  .superRefine((query, context) => {
    if (query.date && (query.dateFrom || query.dateTo)) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message: "date 不能与 dateFrom 或 dateTo 同时使用"
      });
    }
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      context.addIssue({
        code: "custom",
        path: ["dateTo"],
        message: "dateTo 不能早于 dateFrom"
      });
    }
  });

export const mediaAssetCalendarQuerySchema = z
  .object({
    ...mediaAssetFilterShape,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month 必须使用 YYYY-MM 格式")
  })
  .strict();

export const mediaAssetCalendarResponseSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    days: z.array(
      z
        .object({
          date: z.iso.date(),
          count: z.number().int().positive()
        })
        .strict()
    ),
    minDate: z.iso.date().nullable(),
    maxDate: z.iso.date().nullable()
  })
  .strict();

export const mediaAssetListItemSchema = mediaAssetResponseSchema
  .extend({
    name: z.string().min(1),
    source: mediaAssetSourceSchema,
    favorite: z.boolean(),
    folderId: z.uuid().nullable()
  })
  .strict();

export const renameMediaAssetRequestSchema = z
  .object({ name: z.string().trim().min(1, "请填写素材名称").max(200) })
  .strict();

export const favoriteMediaAssetRequestSchema = z
  .object({ folderId: z.uuid().nullable().default(null) })
  .strict();

export const assetFolderIdSchema = z.union([z.uuid(), z.literal("default")]);
export const assetFolderSchema = z
  .object({
    id: assetFolderIdSchema,
    name: z.string().trim().min(1).max(40),
    system: z.boolean(),
    assetCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export const assetFolderListResponseSchema = z
  .object({ items: z.array(assetFolderSchema) })
  .strict();

export const createAssetFolderRequestSchema = z
  .object({ name: z.string().trim().min(1, "请填写文件夹名称").max(40) })
  .strict();

export const renameAssetFolderRequestSchema = createAssetFolderRequestSchema;

export const mediaAssetListResponseSchema = z
  .object({
    items: z.array(mediaAssetListItemSchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        pageSize: z.number().int().positive(),
        total: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type MediaAssetResponse = z.infer<typeof mediaAssetResponseSchema>;
export type MediaAssetSource = z.infer<typeof mediaAssetSourceSchema>;
export type MediaAssetSort = z.infer<typeof mediaAssetSortSchema>;
export type MediaAssetScope = z.infer<typeof mediaAssetScopeSchema>;
export type MediaAssetListQuery = z.infer<typeof mediaAssetListQuerySchema>;
export type MediaAssetCalendarQuery = z.infer<typeof mediaAssetCalendarQuerySchema>;
export type MediaAssetCalendarResponse = z.infer<typeof mediaAssetCalendarResponseSchema>;
export type MediaAssetListItem = z.infer<typeof mediaAssetListItemSchema>;
export type MediaAssetListResponse = z.infer<typeof mediaAssetListResponseSchema>;
export type RenameMediaAssetRequest = z.infer<typeof renameMediaAssetRequestSchema>;
export type FavoriteMediaAssetRequest = z.infer<typeof favoriteMediaAssetRequestSchema>;
export type AssetFolder = z.infer<typeof assetFolderSchema>;
export type AssetFolderListResponse = z.infer<typeof assetFolderListResponseSchema>;
export type CreateAssetFolderRequest = z.infer<typeof createAssetFolderRequestSchema>;
export type RenameAssetFolderRequest = z.infer<typeof renameAssetFolderRequestSchema>;
