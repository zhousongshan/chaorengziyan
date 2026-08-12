import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  timestamp: z.iso.datetime()
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z
  .object({
    status: z.enum(["ready", "not_ready"]),
    service: z.string(),
    timestamp: z.iso.datetime(),
    nodeVersion: z.string(),
    checks: z
      .object({
        database: z.boolean(),
        redis: z.boolean(),
        imageWorker: z.boolean()
      })
      .strict()
  })
  .strict();

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
