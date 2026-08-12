import { z } from "zod";

export const createProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_000).nullable().default(null)
  })
  .strict();

export const projectSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    description: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime()
  })
  .strict();

export const projectListResponseSchema = z
  .object({
    projects: z.array(projectSchema)
  })
  .strict();

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
