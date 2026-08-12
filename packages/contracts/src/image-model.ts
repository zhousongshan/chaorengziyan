import { z } from "zod";

export const imageProviderSchema = z.enum(["bytedance", "openai", "google"]);

export const imageModelDefinitionSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    provider: imageProviderSchema,
    enabled: z.boolean(),
    maxImageCount: z.number().int().positive(),
    supportedAspectRatios: z.array(z.string().min(1)).min(1)
  })
  .strict();

export const imageModelListResponseSchema = z.object({
  models: z.array(imageModelDefinitionSchema)
});

export type ImageProvider = z.infer<typeof imageProviderSchema>;
export type ImageModelDefinition = z.infer<typeof imageModelDefinitionSchema>;
export type ImageModelListResponse = z.infer<typeof imageModelListResponseSchema>;
