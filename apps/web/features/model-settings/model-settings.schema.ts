import { z } from "zod";

const apiBaseUrlSchema = z
  .url("请输入完整的 API 地址")
  .refine((value) => value.startsWith("https://") || value.startsWith("http://127.0.0.1"), {
    message: "API 地址必须使用 HTTPS；仅本机 127.0.0.1 可使用 HTTP"
  });

export const modelSettingsFormSchema = z
  .object({
    requirementBaseUrl: apiBaseUrlSchema,
    requirementApiKey: z.string().trim().max(1_000),
    requirementModel: z.string().trim().min(1, "请输入模型 ID").max(200),
    promptOptimizationBaseUrl: apiBaseUrlSchema,
    promptOptimizationApiKey: z.string().trim().max(1_000),
    promptOptimizationModel: z.string().trim().min(1, "请输入模型 ID").max(200),
    imageBaseUrl: apiBaseUrlSchema,
    imageApiKey: z.string().trim().max(1_000),
    inspectionBaseUrl: apiBaseUrlSchema,
    inspectionApiKey: z.string().trim().max(1_000)
  })
  .strict();

const configuredModelSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
    baseUrl: z.string(),
    apiKeyConfigured: z.boolean()
  })
  .strict();

const promptOptimizationModelSchema = configuredModelSchema
  .extend({ configurationMode: z.enum(["inherited", "dedicated"]) })
  .strict();

export const modelSettingsResponseSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    models: z
      .object({
        promptOptimization: promptOptimizationModelSchema,
        requirement: configuredModelSchema,
        image: configuredModelSchema,
        inspection: configuredModelSchema
      })
      .strict(),
    restartRequired: z.boolean()
  })
  .strict();

export type ModelSettingsFormValues = z.infer<typeof modelSettingsFormSchema>;
export type ModelSettingsResponse = z.infer<typeof modelSettingsResponseSchema>;
