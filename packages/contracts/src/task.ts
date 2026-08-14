import { z } from "zod";

import { aspectRatioSchema, mediaKindSchema } from "./media.js";

export const generationTaskSchema = z
  .object({
    taskId: z.uuid(),
    projectId: z.uuid(),
    mediaKind: mediaKindSchema,
    prompt: z.string().min(1).max(12_000),
    sourceAssetIds: z.array(z.uuid()).max(16).default([]),
    aspectRatio: aspectRatioSchema,
    quantity: z.number().int().min(1).max(8).default(1),
    durationSeconds: z.number().int().min(1).max(30).optional()
  })
  .superRefine((task, context) => {
    if (task.mediaKind === "video" && task.durationSeconds === undefined) {
      context.addIssue({
        code: "custom",
        path: ["durationSeconds"],
        message: "视频任务必须提供时长"
      });
    }
  });

export type GenerationTask = z.infer<typeof generationTaskSchema>;

export const IMAGE_GENERATION_UNIT_JOB_NAME = "image.generate.unit.v2";

export function imageGenerationUnitJobId(taskId: string, unitId: string): string {
  return `${taskId}-${unitId}`;
}

export const imageGenerationUnitJobDataSchema = z
  .object({
    schemaVersion: z.literal("2.0"),
    taskId: z.uuid(),
    unitId: z.uuid()
  })
  .strict();

export type ImageGenerationUnitJobData = z.infer<typeof imageGenerationUnitJobDataSchema>;
